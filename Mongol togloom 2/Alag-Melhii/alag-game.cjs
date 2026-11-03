const { randomUUID, randomInt } = require('node:crypto');
const alagRulesReady = import('./alag-rules.mjs');

function createAlagGame(roster, publish, { ALAG_GROUPS, eligibleGroups }, {
  randomDie = () => randomInt(1, 7)
} = {}) {
  const connected = new Set(roster.map(p => p.id));
  const state = {
    id: randomUUID(), gameType: 'alag', started: true, finished: false,
    players: roster.map(p => ({ ...p, score: 0, eliminated: false })),
    groups: ALAG_GROUPS.map(g => ({ ...g, present: true })),
    currentPlayerId: roster[0].id, currentSeat: roster[0].seat,
    turnNumber: 1, rolled: 0, rollSequence: 0, mode: 'take',
    eligibleGroupIds: [], winners: [], finishReason: null,
    lastRoll: null, lastAction: null
  };
  const snapshot = () => structuredClone(state);
  const broadcast = () => publish(snapshot());
  const current = () => state.players.find(p => p.id === state.currentPlayerId);
  function validAction(id, request) {
    return !state.finished && connected.has(id) && current()?.id === id && !current().eliminated &&
      request?.gameId === state.id && request?.turnNumber === state.turnNumber;
  }
  function finish(winners, reason) {
    state.finished = true;
    state.winners = winners.map(p => p.id);
    state.finishReason = reason;
    state.rolled = 0;
    state.eligibleGroupIds = [];
  }
  function next() {
    const from = state.players.findIndex(p => p.id === state.currentPlayerId);
    for (let offset = 1; offset <= state.players.length; offset++) {
      const p = state.players[(from + offset) % state.players.length];
      if (!p.eliminated) {
        state.currentPlayerId = p.id;
        state.currentSeat = p.seat;
        break;
      }
    }
    state.turnNumber++;
    state.rolled = 0;
    state.eligibleGroupIds = [];
  }
  function move(group, kind) {
    const player = current(), amount = state.rolled;
    group.present = kind === 'return';
    player.score += kind === 'take' ? group.n : -group.n;
    state.lastAction = { kind, playerId: player.id, groupId: group.id, amount, rollSequence: state.rollSequence };
    if (state.groups.every(g => !g.present)) {
      const remaining = state.players.filter(p => !p.eliminated);
      const max = Math.max(...remaining.map(p => p.score));
      finish(remaining.filter(p => p.score === max), 'board-cleared');
    } else next();
  }
  function roll(id, request) {
    if (!validAction(id, request) || state.rolled) return { ok: false, error: 'You cannot roll now.' };
    const value = randomDie();
    state.rolled = value;
    state.rollSequence++;
    state.mode = 'take';
    state.lastRoll = { sequence: state.rollSequence, value, playerId: id };
    state.lastAction = null;
    state.eligibleGroupIds = eligibleGroups(state.groups, value).map(g => g.id);
    if (!state.eligibleGroupIds.length) {
      state.mode = 'return';
      // The original game automatically returns the FIRST absent matching group.
      const returning = eligibleGroups(state.groups, value, 'return', current().score)[0];
      if (returning) move(returning, 'return');
      else {
        current().eliminated = true;
        state.lastAction = { kind: 'eliminate', playerId: id, amount: value, rollSequence: state.rollSequence };
        const remaining = state.players.filter(p => !p.eliminated);
        if (remaining.length <= 1) finish(remaining, 'last-player');
        else next();
      }
    }
    broadcast();
    return { ok: true };
  }
  function select(id, request) {
    if (!validAction(id, request) || !state.rolled || state.mode !== 'take' ||
        request?.rollSequence !== state.rollSequence || typeof request?.groupId !== 'string') {
      return { ok: false, error: 'You cannot select a group now.' };
    }
    const group = state.groups.find(g => g.id === request.groupId);
    if (!group?.present || group.n !== state.rolled || !state.eligibleGroupIds.includes(group.id)) {
      return { ok: false, error: 'That group is not available for this roll.' };
    }
    move(group, 'take');
    broadcast();
    return { ok: true };
  }
  function setConnected(id, value) {
    if (value) connected.add(id);
    else connected.delete(id);
  }
  return { snapshot, roll, select, setConnected };
}

module.exports = { createAlagGame, alagRulesReady };
