import { createSessionStore } from './session-storage.mjs';
// Shared session/readiness and generation handling; game rules remain on the server.
export function createMultiplayerSession(config, view, {
  ioFactory = globalThis.io, storage = createSessionStore(),
  navigate = page => globalThis.location.replace(page),
  confirmRestart = () => globalThis.confirm('Тоглолтыг эхнээс нь эхлүүлэх үү?')
} = {}) {
  let token;
  try { token = storage.getItem('lan-session-token'); }
  catch (error) { console.error('[multiplayer:session-storage]', error); }
  const socket = ioFactory({ auth: { sessionToken: token } });
  let state = null, playerId = null, hostId = null, threeReady = false, sessionReady = false;
  let applying = false, displayError = false, applied = null, queued = null, pending = null, restartPending = null;
  let seenGame = null, seenSequence = 0, activeAnimation = null, connectionRevision = 0;
  const retiredGames = new Set();
  let transitioning = false, switchPending = null, partyTrackLength = 18;
  const readiness = () => ({ threeReady, sessionReady, socketReady: socket.connected, gameStateReady: Boolean(state), stateApplied: applied === state });
  const canAct = () => Boolean(threeReady && sessionReady && socket.connected && state && applied === state &&
    !transitioning && !switchPending && !applying && !pending && !restartPending && !displayError && !state.finished && state.currentPlayerId === playerId &&
    (!state.players || state.players.some(p => p.id === playerId && !p.eliminated)));
  const canRestart = () => Boolean(!transitioning && !switchPending && sessionReady && socket.connected && state && playerId === (state.hostId ?? hostId) && !restartPending);
  const canSwitch = () => canRestart();
  function render() {
    try { view.renderControls({ state, playerId, canAct: canAct(), canRestart: canRestart(), canSwitch: canSwitch(), readiness: readiness() }); }
    catch (error) {
      displayError = true;
      console.error('[multiplayer:controls] Control rendering failed; this is not a WebGL/model failure.', error);
    }
  }
  function invalidate() {
    activeAnimation?.abort();
    view.cancelAnimations?.();
    pending = null;
    restartPending = null;
    switchPending = null;
    applied = null;
    queued = null;
    displayError = false;
  }
  async function drain() {
    if (!threeReady || applying || !queued) return;
    applying = true; render();
    try {
      while (queued) {
        const snapshot = queued; queued = null;
        const restoring = seenGame !== snapshot.id;
        if (restoring) { seenGame = snapshot.id; seenSequence = config.restoreSequence(snapshot); }
        const sequence = config.sequence(snapshot);
        const animate = config.animate(snapshot, restoring, sequence > seenSequence);
        seenSequence = Math.max(seenSequence, sequence);
        const animation = new AbortController(); activeAnimation = animation;
        // A reset can preempt a paused/background animation, without waiting for rAF.
        const completed = await new Promise((resolve, reject) => {
          const abort = () => resolve(false);
          animation.signal.addEventListener('abort', abort, { once: true });
          Promise.resolve().then(() => {
            if (animation.signal.aborted) return;
            return view.applyState(snapshot, { animate, signal: animation.signal });
          }).then(() => resolve(!animation.signal.aborted), reject)
            .finally(() => animation.signal.removeEventListener('abort', abort));
        });
        if (completed && state.id === snapshot.id) { applied = snapshot; displayError = false; }
      }
    } catch (error) {
      displayError = true;
      console.error('[multiplayer:state-application] Could not apply authoritative state.', error);
      view.onStatus('Could not display the game state. Refresh to restore it; see the console for details.');
    } finally { applying = false; render(); }
  }
  socket.on('session', session => {
    playerId = session.playerId; sessionReady = Boolean(playerId);
    socket.auth.sessionToken = session.token;
    try { storage.setItem('lan-session-token', session.token); }
    catch (error) { console.error('[multiplayer:session-storage] Session restored but could not be remembered.', error); }
    render();
  });
  socket.on('session:invalid', () => {
    storage.removeItem?.('lan-session-token');
    socket.auth.sessionToken = null; playerId = null; sessionReady = false;
    invalidate(); render();
    console.error('[multiplayer:session-restoration] Saved token is invalid or the server session expired.');
    view.onStatus('Saved session expired. Return to the multiplayer lobby to join.');
  });
  socket.on(config.stateEvent, snapshot => {
    if (transitioning) return;
    if (retiredGames.has(snapshot.id)) return;
    if (state && state.id !== snapshot.id) { retiredGames.add(state.id); invalidate(); }
    state = snapshot; queued = snapshot;
    storage.setItem('lan-current-game', JSON.stringify({ gameId: state.id, gameType: config.gameType }));
    render(); void drain();
  });
  function enterGame(targetGame, gameId) {
    const pages = { alag: 'turtle.html?lan=1', horse: 'race.html?lan=1' };
    if (transitioning || !sessionReady || !pages[targetGame] || targetGame === config.gameType) return;
    transitioning = true;
    if (state) retiredGames.add(state.id);
    invalidate(); render();
    storage.setItem('lan-current-game', JSON.stringify({ gameId, gameType: targetGame }));
    view.onStatus('Host тоглоомыг '+(targetGame === 'horse' ? 'Морь уралдуулах' : 'Алаг мэлхий')+' болгон сольж байна...');
    navigate(pages[targetGame]);
  }
  socket.on('game:switched', message => {
    if (state && message.previousGameId !== state.id) return;
    enterGame(message.targetGame, message.gameId);
  });
  socket.on('connect', () => { pending = null; restartPending = null; render(); });
  socket.on('disconnect', () => {
    connectionRevision++; sessionReady = false; invalidate();
    render(); view.onStatus('Disconnected. Reconnecting to your saved seat...');
  });
  socket.on('connect_error', error => {
    console.error('[multiplayer:socket-connection]', error);
    render(); view.onStatus('Cannot reach the multiplayer server. Reconnecting...');
  });
  socket.on('lobby:state', lobby => {
    partyTrackLength = lobby.trackLength ?? partyTrackLength;
    hostId = lobby.hostId; render();
    if (lobby.started && lobby.selectedGame !== config.gameType && sessionReady && lobby.players?.some(p => p.id === playerId)) {
      enterGame(lobby.selectedGame, lobby.currentGameId); return;
    }
    if (!lobby.started || lobby.selectedGame !== config.gameType) view.onStatus('No active game of this type. Return to the multiplayer lobby.');
    else if (!sessionReady) {
      console.error('[multiplayer:session-restoration] No server-issued player identity was restored.');
      view.onStatus('Player session could not be restored. Return to the multiplayer lobby.');
    }
  });
  function request(event, extra = {}, restarting = false) {
    const requestToken = { gameId: state.id, connectionRevision };
    if (restarting) restartPending = requestToken; else pending = requestToken;
    render();
    const payload = restarting ? { gameId: state.id } : { gameId: state.id, turnNumber: state.turnNumber, ...config.actionFields(state), ...extra };
    socket.timeout(5000).emit(event, payload, (error, response) => {
      if ((restarting ? restartPending : pending) !== requestToken || state.id !== requestToken.gameId || connectionRevision !== requestToken.connectionRevision) return;
      if (restarting) restartPending = null; else pending = null;
      render();
      if (error || !response?.ok) view.onStatus(response?.error || 'The server did not respond. Check your connection.');
    });
    return true;
  }
  return {
    canAct, canRestart, canSwitch, request, readiness,
    switchSettings: () => ({ gameType: config.gameType, trackLength: state?.trackLength ?? partyTrackLength }),
    requestSwitch(targetGame, trackLength) {
      if (!canSwitch() || !['alag', 'horse'].includes(targetGame) || targetGame === config.gameType || ![12,18,24].includes(trackLength)) return false;
      const requestToken = { gameId: state.id, connectionRevision };
      switchPending = requestToken; render();
      socket.timeout(5000).emit('game:switch', { gameId: state.id, targetGame, trackLength }, (error, response) => {
        if (transitioning || switchPending !== requestToken || state.id !== requestToken.gameId || connectionRevision !== requestToken.connectionRevision) return;
        switchPending = null; render();
        if (error || !response?.ok) view.onStatus(response?.error || 'The server did not respond. Check your connection.');
      });
      return true;
    },
    requestRestart() { return canRestart() && confirmRestart() ? request('game:restart', {}, true) : false; },
    ready() { threeReady = true; render(); void drain(); }
  };
}
