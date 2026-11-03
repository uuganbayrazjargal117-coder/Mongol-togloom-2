const { randomUUID, randomInt } = require('node:crypto');
const rules = import('./race-logic.mjs');

// Matches the existing 2650ms shagai throw + 800ms horse movement, with margin.
const ANIMATION_MS = 4000;

function createHorseGame(roster, trackLength, publish, {
  randomFace = () => randomInt(0, 4),
  animationMs = ANIMATION_MS,
  disconnectGraceMs = 15000,
  hostId = roster[0].id
} = {}) {
  const initialState = () => ({
    id: randomUUID(), hostId, gameType: 'horse', started: true, finished: false,
    players: roster.map(p => ({ ...p, connected: true, position: 0, finished: false })),
    trackLength, currentPlayerId: roster[0].id, currentSeat: roster[0].seat,
    turnNumber: 1, phase: 'ready', faces: [], lastThrow: null,
    ranking: [], winnerId: null
  });
  let state = initialState();
  let animationTimer;
  const disconnectTimers = new Map();
  const snapshot = () => structuredClone(state);
  const broadcast = () => publish(snapshot());
  function next(afterId) {
    if (state.finished) return;
    const start = state.players.findIndex(p => p.id === afterId);
    let nextPlayer;
    for (let offset = 1; offset <= state.players.length; offset++) {
      const p = state.players[(start + offset) % state.players.length];
      if (p.connected && !p.finished) { nextPlayer = p; break; }
    }
    state.currentPlayerId = nextPlayer?.id ?? null;
    state.currentSeat = nextPlayer?.seat ?? null;
    state.phase = nextPlayer ? 'ready' : 'waiting';
    state.turnNumber++;
    broadcast();
  }
  function setConnected(id, connected) {
    const player = state.players.find(p => p.id === id);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    clearTimeout(disconnectTimers.get(id));
    disconnectTimers.delete(id);
    if (connected && !state.finished && state.phase === 'waiting') {
      next(id);
      return;
    }
    broadcast();
    if (!connected && !state.finished) {
      const timer = setTimeout(() => {
        disconnectTimers.delete(id);
        if (!player.connected && state.currentPlayerId === id && state.phase === 'ready') next(id);
      }, disconnectGraceMs);
      timer.unref();
      disconnectTimers.set(id, timer);
    }
  }
  async function throwFor(id, request, isConnected = () => true) {
    const { advance } = await rules;
    const player = state.players.find(p => p.id === id);
    if (!isConnected() || !player?.connected || state.finished || state.phase !== 'ready' ||
        state.currentPlayerId !== id || request?.gameId !== state.id ||
        request?.turnNumber !== state.turnNumber || player.finished) {
      return { ok: false, error: 'You cannot throw now. Wait for your current turn.' };
    }
    // No await between validation and locking the turn: concurrent requests cannot roll twice.
    state.phase = 'animating';
    const faces = Array.from({ length: 4 }, randomFace);
    const result = advance(player, faces, state.trackLength);
    const fromPosition = player.position;
    player.position = result.position;
    if (player.position === state.trackLength) {
      player.finished = true;
      state.ranking.push(id);
      state.winnerId ??= id;
    }
    state.faces = faces;
    state.lastThrow = {
      sequence: (state.lastThrow?.sequence ?? 0) + 1,
      playerId: id, faces, fromPosition, ...result,
      startedAt: Date.now(), animationEndsAt: Date.now() + animationMs
    };
    state.finished = state.ranking.length === state.players.length;
    broadcast();
    const generation = state.id;
    animationTimer = setTimeout(() => {
      if (state.id !== generation) return;
      if (state.finished) {
        state.phase = 'finished';
        state.currentPlayerId = null;
        state.currentSeat = null;
        broadcast();
      } else next(id);
    }, animationMs);
    animationTimer.unref();
    return { ok: true };
  }
  function close() {
    clearTimeout(animationTimer);
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    disconnectTimers.clear();
  }
  function restart() {
    const connections = new Map(state.players.map(p => [p.id, p.connected]));
    close();
    state = initialState();
    state.players.forEach(p => { p.connected = connections.get(p.id) === true; });
    const first = state.players.find(p => p.connected);
    state.currentPlayerId = first?.id ?? null;
    state.currentSeat = first?.seat ?? null;
    state.phase = first ? 'ready' : 'waiting';
    broadcast();
    return state.id;
  }
  return { snapshot, throwFor, setConnected, close, restart };
}

module.exports = { createHorseGame };
