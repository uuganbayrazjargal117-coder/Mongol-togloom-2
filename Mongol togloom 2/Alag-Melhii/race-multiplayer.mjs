// Transport/controller only. The existing race renderer owns every Three.js object.
export function createHorseMultiplayer({ applyState, renderControls, onStatus }, {
  ioFactory = globalThis.io, storage = globalThis.sessionStorage
} = {}) {
  let state = null, playerId = null, ready = false, applying = false, pending = false;
  let queued = null, seenGame = null, seenSequence = 0;
  const socket = ioFactory({ auth: { sessionToken: storage.getItem('lan-session-token') } });
  const canThrow = () => Boolean(ready && socket.connected && !applying && !pending &&
    state && state.phase === 'ready' && !state.finished && state.currentPlayerId === playerId);
  const render = () => renderControls({ state, playerId, canThrow: canThrow() });
  async function drain() {
    if (!ready || applying || !queued) return;
    applying = true;
    render();
    try {
      while (queued) {
        const snapshot = queued;
        queued = null;
        if (seenGame !== snapshot.id) { seenGame = snapshot.id; seenSequence = 0; }
        const roll = snapshot.lastThrow;
        // Use the server phase, not the device clock (players' clocks can differ).
        const animate = Boolean(roll && roll.sequence > seenSequence && snapshot.phase === 'animating');
        if (roll) seenSequence = Math.max(seenSequence, roll.sequence);
        await applyState(snapshot, { animate });
      }
    } catch (error) {
      onStatus('Could not display the race. Refresh this page to restore server state.');
      console.error(error);
    } finally {
      applying = false;
      render();
    }
  }
  socket.on('session', session => {
    playerId = session.playerId;
    storage.setItem('lan-session-token', session.token);
    socket.auth.sessionToken = session.token;
    render();
  });
  socket.on('horse:state', snapshot => { state = snapshot; queued = snapshot; render(); void drain(); });
  socket.on('connect', () => { pending = false; render(); });
  socket.on('disconnect', () => {
    pending = false;
    render();
    onStatus('Disconnected. Reconnecting to your race seat...');
  });
  socket.on('connect_error', () => { render(); onStatus('Cannot reach the multiplayer server. Reconnecting...'); });
  socket.on('lobby:state', lobby => {
    if (!lobby.started || lobby.selectedGame !== 'horse') onStatus('No active Horse Racing game. Return to the multiplayer lobby.');
  });
  function requestThrow() {
    if (!canThrow()) return false;
    pending = true;
    render();
    // Turn number prevents replay of an old request, even when this seat gets another turn.
    socket.timeout(5000).emit('horse:throw', { gameId: state.id, turnNumber: state.turnNumber }, (error, response) => {
      pending = false;
      render();
      if (error || !response?.ok) onStatus(response?.error || 'The server did not respond. Check your connection.');
    });
    return true;
  }
  return {
    canThrow, requestThrow,
    ready() { ready = true; render(); void drain(); }
  };
}
