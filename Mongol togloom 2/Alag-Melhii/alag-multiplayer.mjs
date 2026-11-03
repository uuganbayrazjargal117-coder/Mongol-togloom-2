// Apply logical presence to the existing meshes; never create/remove model instances.
export function syncAlagBoard(groups, board) {
  const byId = new Map(board.map(g => [g.id, g]));
  if (byId.size !== board.length || byId.size !== groups.length || groups.some(g => !byId.has(g.id))) {
    throw new Error('Alag Melkhii board IDs do not match the logical catalog.');
  }
  for (const group of groups) {
    group.present = byId.get(group.id).present;
    group.objects.forEach(mesh => { mesh.visible = group.present; });
  }
}

export function createAlagMultiplayer({ applyState, renderControls, onStatus }, {
  ioFactory = globalThis.io, storage = globalThis.sessionStorage
} = {}) {
  let state = null, playerId = null, ready = false, applying = false, pending = false, displayError = false;
  let queued = null, seenGame = null, seenSequence = 0;
  const socket = ioFactory({ auth: { sessionToken: storage.getItem('lan-session-token') } });
  const canAct = () => Boolean(ready && socket.connected && !applying && !pending && !displayError &&
    state && !state.finished && state.currentPlayerId === playerId &&
    state.players.some(p => p.id === playerId && !p.eliminated));
  const canRoll = () => canAct() && !state.rolled;
  const canSelect = id => Boolean(canAct() && state.rolled && state.mode === 'take' && state.eligibleGroupIds.includes(id));
  const render = () => renderControls({ state, playerId, canRoll: canRoll(), canSelect });
  async function drain() {
    if (!ready || applying || !queued) return;
    applying = true;
    render();
    try {
      while (queued) {
        const snapshot = queued; queued = null;
        // A restored snapshot shows the existing die pose without replaying historical rolls.
        const restoring = seenGame !== snapshot.id;
        if (restoring) { seenGame = snapshot.id; seenSequence = snapshot.rollSequence; }
        const animate = !restoring && snapshot.rollSequence > seenSequence;
        seenSequence = Math.max(seenSequence, snapshot.rollSequence);
        await applyState(snapshot, { animate });
        displayError = false;
      }
    } catch (error) {
      displayError = true;
      onStatus('Could not display the board. Refresh this page to restore server state.');
      console.error(error);
    } finally { applying = false; render(); }
  }
  socket.on('session', session => {
    playerId = session.playerId;
    storage.setItem('lan-session-token', session.token);
    socket.auth.sessionToken = session.token;
    render();
  });
  socket.on('game:state', snapshot => { state = snapshot; queued = snapshot; render(); void drain(); });
  socket.on('connect', () => { pending = false; render(); });
  socket.on('disconnect', () => { pending = false; render(); onStatus('Disconnected. Reconnecting to your Alag Melkhii seat...'); });
  socket.on('connect_error', () => { render(); onStatus('Cannot reach the multiplayer server. Reconnecting...'); });
  socket.on('lobby:state', lobby => {
    if (!lobby.started || lobby.selectedGame !== 'alag') onStatus('No active Alag Melkhii game. Return to the multiplayer lobby.');
  });
  function request(event, extra = {}) {
    pending = true;
    render();
    socket.timeout(5000).emit(event, {
      gameId: state.id, turnNumber: state.turnNumber, rollSequence: state.rollSequence, ...extra
    }, (error, response) => {
      pending = false; render();
      if (error || !response?.ok) onStatus(response?.error || 'The server did not respond. Check your connection.');
    });
    return true;
  }
  return {
    canRoll, canSelect,
    requestRoll() { return canRoll() ? request('game:roll') : false; },
    requestSelect(id) { return canSelect(id) ? request('game:select', { groupId: id }) : false; },
    ready() { ready = true; render(); void drain(); }
  };
}
