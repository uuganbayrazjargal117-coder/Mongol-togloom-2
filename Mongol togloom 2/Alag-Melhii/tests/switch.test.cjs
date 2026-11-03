const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createLobbyServer } = require('../server');
const emit = (s, event, payload) => s.timeout(3000).emitWithAck(event, payload);
const action = s => ({ gameId: s.id, turnNumber: s.turnNumber, rollSequence: s.rollSequence });
const wait = ms => new Promise(r => setTimeout(r, ms));
function next(s, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.off(event, listener); reject(Error('Timed out ' + event)); }, 3000);
    function listener(value) { if (!predicate(value)) return; clearTimeout(timer); s.off(event, listener); resolve(value); }
    s.on(event, listener);
  });
}
const identities = s => s.players.map(({ id, name, seat }) => ({ id, name, seat }));
async function fixture(t, count = 3) {
  const { httpServer, io } = createLobbyServer({ horseOptions: { randomFace: () => 0, animationMs: 80, disconnectGraceMs: 80 }, alagOptions: { randomDie: () => 3, disconnectGraceMs: 80 } });
  const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(r => io.close(r)); });
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + httpServer.address().port;
  async function client(token) {
    const s = connect(base, { autoConnect: false, reconnection: false, forceNew: true, auth: { sessionToken: token } }); clients.push(s);
    s.on('session', value => { s.session = value; });
    s.on('game:state', value => { s.alag = value; }); s.on('horse:state', value => { s.horse = value; });
    s.on('lobby:state', value => { s.party = value; });
    const ready = next(s, 'lobby:state'); s.connect(); await ready; return s;
  }
  const party = [];
  for (let i = 0; i < count; i++) { const s = await client(); party.push(s); await emit(s, 'lobby:join', { name: ['Azaa', 'Bat', 'Dulguun'][i] }); }
  await party[0].timeout(3000).emitWithAck('lobby:start');
  return { host: party[0], guest: party[1], third: party[2], client };
}
test('party switches both directions with new generations, fresh state, preserved identity and host-only authority', async t => {
  const { host, guest, third, client } = await fixture(t);
  const roster = identities(host.alag), original = host.alag.id, tokens = [host, guest, third].map(s => s.session.token);
  for (const bad of [
    { gameId: original, targetGame: 'bogus', trackLength: 12 },
    { gameId: original, targetGame: 'horse', trackLength: 13 },
    { gameId: 'stale', targetGame: 'horse', trackLength: 12 },
    { gameId: original, targetGame: 'horse', trackLength: 12, players: [{ id: 'forged', seat: 0 }] },
    { gameId: original, targetGame: 'horse', trackLength: 12, hostId: guest.session.playerId },
    { gameId: original, targetGame: 'horse', trackLength: 12, seats: [99] },
    { gameId: original, targetGame: 'alag', trackLength: 12 }
  ]) assert.equal((await emit(host, 'game:switch', bad)).ok, false);
  assert.equal((await emit(guest, 'game:switch', { gameId: original, targetGame: 'horse', trackLength: 12 })).ok, false);
  // Dirty the old board before switching.
  await emit(host, 'game:roll', action(host.alag));
  const oldAction = { ...action(host.alag), groupId: 'head' };
  await emit(host, 'game:select', oldAction);
  assert.equal(host.alag.players[0].score, 3);
  const switched = [host, guest, third].map(s => next(s, 'game:switched'));
  assert.equal((await emit(host, 'game:switch', { gameId: original, targetGame: 'horse', trackLength: 12 })).ok, true);
  const messages = await Promise.all(switched); assert.deepEqual(messages[0], messages[1]); assert.deepEqual(messages[1], messages[2]);
  const horse = host.horse; assert.notEqual(horse.id, original); assert.deepEqual(identities(horse), roster);
  assert.equal(horse.hostId, roster[0].id); assert.equal(horse.trackLength, 12); assert.equal(horse.currentSeat, 0);
  assert.ok(horse.players.every(p => p.position === 0 && !p.finished)); assert.deepEqual(horse.ranking, []);
  assert.deepEqual(horse.faces, []); assert.equal(horse.lastThrow, null); assert.equal(horse.winnerId, null);
  assert.equal((await emit(host, 'game:select', oldAction)).ok, false);
  assert.equal((await emit(host, 'game:roll', action({ ...host.alag, id: original }))).ok, false);
  assert.equal((await emit(guest, 'game:switch', { gameId: horse.id, targetGame: 'alag' })).ok, false);
  assert.equal((await emit(host, 'game:restart', { gameId: horse.id })).ok, true);
  const restarted = host.horse; assert.notEqual(restarted.id, horse.id);
  await emit(host, 'horse:throw', action(restarted)); const pendingHorse = structuredClone(host.horse);
  // Switch while the previous server animation timer is running.
  const both = next(guest, 'game:state', s => s.id !== original);
  assert.equal((await emit(host, 'game:switch', { gameId: restarted.id, targetGame: 'alag' })).ok, true);
  const alag = await both; assert.deepEqual(identities(alag), roster); assert.notEqual(alag.id, original);
  assert.ok(alag.groups.length === 29 && alag.groups.every(g => g.present));
  assert.ok(alag.players.every(p => p.score === 0 && !p.eliminated)); assert.equal(alag.currentSeat, 0);
  assert.equal(alag.rolled, 0); assert.deepEqual(alag.eligibleGroupIds, []); assert.deepEqual(alag.winners, []); assert.equal(alag.mode, 'take');
  assert.equal((await emit(host, 'horse:throw', action(pendingHorse))).ok, false);
  await wait(130); assert.deepEqual(host.alag, alag);
  assert.equal((await emit(host, 'game:restart', { gameId: alag.id })).ok, true);
  assert.equal(host.alag.currentSeat, 0);
  for (let i = 0; i < tokens.length; i++) { const restored = await client(tokens[i]); assert.equal(restored.session.playerId, roster[i].id); assert.deepEqual(identities(restored.alag), roster); }
});

test('offline party member resumes the new game, same seat/token; old disconnect timer cannot alter it', async t => {
  const { host, third, client } = await fixture(t);
  const token = third.session.token, id = third.session.playerId, oldId = host.alag.id;
  third.disconnect(); await wait(10);
  await emit(host, 'game:switch', { gameId: oldId, targetGame: 'horse', trackLength: 24 });
  assert.equal(host.horse.players[2].connected, false); const fresh = structuredClone(host.horse);
  await wait(120); assert.deepEqual(host.horse, fresh);
  const resumed = await client(token); assert.equal(resumed.session.playerId, id); assert.equal(resumed.horse.id, fresh.id);
  assert.equal(resumed.horse.players[2].seat, 2); assert.equal(resumed.alag, undefined);
  assert.equal(resumed.party.selectedGame, 'horse'); assert.equal(resumed.party.currentGameId, fresh.id);
  assert.equal(resumed.horse.players.length, 3);
});

test('switch requires at least two joined party members', async t => {
  const { host } = await fixture(t, 1);
  assert.equal((await emit(host, 'game:switch', { gameId: host.alag.id, targetGame: 'horse', trackLength: 12 })).ok, false);
});
