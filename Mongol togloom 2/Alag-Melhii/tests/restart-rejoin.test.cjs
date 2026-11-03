const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createLobbyServer } = require('../server');
const wait = ms => new Promise(r => setTimeout(r, ms));
const emit = (s, event, payload) => s.timeout(3000).emitWithAck(event, payload);
const action = s => ({ gameId: s.id, turnNumber: s.turnNumber, rollSequence: s.rollSequence });
function next(s, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.off(event, listener); reject(Error('Timed out ' + event)); }, 3000);
    function listener(value) { if (!predicate(value)) return; clearTimeout(timer); s.off(event, listener); resolve(value); }
    s.on(event, listener);
  });
}
async function fixture(t, type, length = 18, options = {}) {
  const server = createLobbyServer({ horseOptions: { randomFace: () => 0, animationMs: 60, disconnectGraceMs: 60 }, alagOptions: { randomDie: () => 3, disconnectGraceMs: 60 }, ...options });
  const clients = []; const event = type === 'alag' ? 'game:state' : 'horse:state';
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(r => server.io.close(r)); });
  await new Promise(r => server.httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.httpServer.address().port;
  async function client(token, auth = {}) {
    const s = connect(base, { autoConnect: false, reconnection: false, forceNew: true, auth: { sessionToken: token, ...auth } }); clients.push(s);
    s.on('session', value => { s.session = value; }); s.on(event, value => { s.state = value; });
    s.on('session:invalid', () => { s.invalid = true; });
    const ready = next(s, 'lobby:state'); s.connect(); await ready; return s;
  }
  const host = await client(), guest = await client();
  await emit(host, 'lobby:join', { name: 'Host' }); await emit(guest, 'lobby:join', { name: 'Guest' });
  await emit(host, 'lobby:select', { game: type, trackLength: length });
  const both = next(guest, event); await host.timeout(3000).emitWithAck('lobby:start'); await both;
  return { host, guest, client, event };
}
const identities = state => state.players.map(({ id, name, seat }) => ({ id, name, seat }));

test('Alag host-only restart resets a completed game; old roll/selection/restart requests cannot change it', async t => {
  const { host, guest, event, client } = await fixture(t, 'alag', 18, { alagOptions: { randomDie: () => 2 } });
  const roster = identities(host.state), token = guest.session.token;
  for (const [actor, group] of [[host, 'eyes'], [guest, 'ears'], [host, 'kidneys'], [guest, null], [host, 'eyes'], [guest, null]]) {
    const peer = actor === host ? guest : host;
    const received = next(peer, event); await emit(actor, 'game:roll', action(actor.state)); await received;
    if (group) { const receivedTake = next(peer, event); await emit(actor, 'game:select', { ...action(actor.state), groupId: group }); await receivedTake; }
  }
  assert.equal(host.state.finished, true); assert.equal(host.state.players[1].eliminated, true);
  const old = structuredClone(host.state);
  assert.equal((await emit(guest, 'game:restart', { gameId: old.id, hostId: host.session.playerId })).ok, false);
  const both = next(guest, event, s => s.id !== old.id);
  assert.equal((await emit(host, 'game:restart', { gameId: old.id })).ok, true);
  const reset = await both; assert.deepEqual(reset, host.state);
  assert.deepEqual(identities(reset), roster); assert.equal(reset.hostId, host.session.playerId);
  assert.equal(reset.groups.length, 29); assert.ok(reset.groups.every(g => g.present));
  assert.ok(reset.players.every(p => p.score === 0 && !p.eliminated));
  assert.equal(reset.rolled, 0); assert.equal(reset.rollSequence, 0); assert.equal(reset.mode, 'take');
  assert.deepEqual(reset.eligibleGroupIds, []); assert.deepEqual(reset.winners, []);
  assert.equal(reset.finished, false); assert.equal(reset.lastRoll, null); assert.equal(reset.lastAction, null);
  assert.equal(reset.finishReason, null); assert.equal(reset.currentSeat, 0);
  for (const name of ['game:roll', 'game:select', 'game:restart']) assert.equal((await emit(host, name, { ...action(old), groupId: 'eyes' })).ok, false);
  const refreshed = await client(token); assert.equal(refreshed.session.playerId, guest.session.playerId); assert.deepEqual(refreshed.state, reset);
});

for (const length of [12, 18, 24]) test('Horse host restart during throw preserves track ' + length + ', identities and invalidates old timers', async t => {
  const { host, guest, event, client } = await fixture(t, 'horse', length);
  const roster = identities(host.state), token = guest.session.token, old = structuredClone(host.state);
  assert.equal((await emit(host, 'horse:throw', action(old))).ok, true); assert.equal(host.state.players[0].position, 4);
  assert.equal((await emit(guest, 'game:restart', { gameId: old.id })).ok, false);
  const received = next(guest, event, s => s.id !== old.id);
  assert.equal((await emit(host, 'game:restart', { gameId: old.id })).ok, true);
  const reset = await received; assert.deepEqual(identities(reset), roster); assert.equal(reset.trackLength, length);
  assert.ok(reset.players.every(p => p.position === 0 && !p.finished));
  assert.deepEqual(reset.ranking, []); assert.deepEqual(reset.faces, []); assert.equal(reset.lastThrow, null);
  assert.equal(reset.winnerId, null); assert.equal(reset.finished, false); assert.equal(reset.currentSeat, 0);
  assert.equal((await emit(host, 'horse:throw', action(old))).ok, false);
  await wait(100); assert.deepEqual(host.state, reset);
  const restored = await client(token); assert.deepEqual(identities(restored.state), roster);
  assert.equal(restored.session.playerId, guest.session.playerId);
});

test('Alag close/rejoin preserves seat and pending state; an offline current turn skips without elimination', async t => {
  const { host, guest, client, event } = await fixture(t, 'alag');
  const peerRoll = next(guest, event); await emit(host, 'game:roll', action(host.state)); await peerRoll;
  const peerTake = next(guest, event); await emit(host, 'game:select', { ...action(host.state), groupId: 'head' }); await peerTake;
  await emit(guest, 'game:roll', action(guest.state));
  const token = guest.session.token, id = guest.session.playerId, stale = structuredClone(guest.state);
  const skipped = next(host, event, s => s.lastAction?.kind === 'skip'); guest.disconnect(); await skipped;
  assert.equal(host.state.currentPlayerId, host.session.playerId); assert.equal(host.state.rolled, 0);
  assert.equal(host.state.players[1].eliminated, false); assert.equal(host.state.players[0].score, 3);
  const restored = await client(token); assert.equal(restored.session.playerId, id); assert.deepEqual(restored.state, host.state);
  assert.equal(restored.state.players.length, 2); assert.equal(restored.state.players[1].seat, 1);
  assert.equal((await emit(restored, 'game:select', { ...action(stale), groupId: 'tail' })).ok, false);
  const forged = await client('guessed-token', { playerId: id, seat: 1 }); assert.equal(forged.invalid, true); assert.equal(forged.session, undefined);
  for (const name of ['game:roll', 'game:select', 'game:restart']) assert.equal((await emit(forged, name, { ...action(host.state), groupId: 'tail', playerId: id })).ok, false);
});

test('Horse restart clears a nonempty final ranking and winner', async t => {
  const { host, guest, event } = await fixture(t, 'horse', 12);
  for (let i = 0; i < 6; i++) {
    const actor = i % 2 ? guest : host;
    if (actor.state.phase !== 'ready') await next(actor, event, s => s.phase === 'ready');
    const peer = next(actor === host ? guest : host, event, s => s.phase === 'animating');
    assert.equal((await emit(actor, 'horse:throw', action(actor.state))).ok, true); await peer;
  }
  assert.equal(host.state.finished, true); assert.equal(host.state.ranking.length, 2);
  assert.ok(host.state.winnerId);
  assert.equal((await emit(host, 'game:restart', { gameId: host.state.id })).ok, true);
  assert.deepEqual(host.state.ranking, []); assert.equal(host.state.winnerId, null);
  assert.equal(host.state.finished, false); assert.equal(host.state.currentSeat, 0);
});

test('restarting chooses the first connected seat while preserving the original host authority', async t => {
  const { host, guest, event, client } = await fixture(t, 'alag');
  const token = host.session.token, id = host.session.playerId;
  host.disconnect();
  await next(guest, event, s => s.currentPlayerId === guest.session.playerId);
  assert.equal((await emit(guest, 'game:restart', { gameId: guest.state.id })).ok, false);
  const restored = await client(token); assert.equal(restored.session.playerId, id);
  assert.equal((await emit(restored, 'game:restart', { gameId: restored.state.id })).ok, true);
  assert.equal(restored.state.currentPlayerId, id);
});
