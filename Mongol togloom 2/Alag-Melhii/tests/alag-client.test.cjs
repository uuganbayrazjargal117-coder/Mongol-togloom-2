const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket {
  connected = true; auth = {}; listeners = new Map(); requests = [];
  on(name, handler) { this.listeners.set(name, handler); }
  receive(name, value) { this.listeners.get(name)?.(value); }
  timeout() { return this; }
  emit(name, payload, ack) { this.requests.push({ name, payload, ack }); }
}
const initial = () => ({
  id: 'game-1', players: [{ id: 'a', score: 0, eliminated: false }, { id: 'b', score: 0, eliminated: false }],
  currentPlayerId: 'a', turnNumber: 1, rollSequence: 0, rolled: 0, mode: 'take', finished: false,
  eligibleGroupIds: [], groups: [{ id: 'head', present: true }, { id: 'neck', present: true }]
});
async function controller({ id = 'a', applyState = async () => {} } = {}) {
  const { createAlagMultiplayer } = await import('../alag-multiplayer.mjs');
  const socket = new Socket(), statuses = [], values = new Map([['lan-session-token', 'saved-token']]);
  let controls;
  const client = createAlagMultiplayer({ applyState, renderControls: value => { controls = value; }, onStatus: value => statuses.push(value) }, {
    ioFactory: options => { assert.equal(options.auth.sessionToken, 'saved-token'); return socket; },
    storage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  });
  socket.receive('session', { playerId: id, token: 'restored-token' });
  return { client, socket, statuses, values, controls: () => controls };
}

test('Alag client restores identity and gates rolls/selections to authoritative eligibility and turn', async () => {
  const { client, socket, values, controls } = await controller();
  socket.receive('game:state', initial()); assert.equal(client.canRoll(), false);
  client.ready(); await tick(); assert.equal(client.canRoll(), true);
  assert.equal(values.get('lan-session-token'), 'restored-token'); assert.equal(socket.auth.sessionToken, 'restored-token');
  assert.equal(controls().playerId, 'a');
  assert.equal(client.requestSelect('head'), false);
  assert.equal(client.requestRoll(), true); assert.equal(client.requestRoll(), false);
  assert.equal(socket.requests[0].name, 'game:roll');
  assert.deepEqual(socket.requests[0].payload, { gameId: 'game-1', turnNumber: 1, rollSequence: 0 });
  const rolled = { ...initial(), rolled: 3, rollSequence: 1, eligibleGroupIds: ['head'], lastRoll: { sequence: 1, value: 3 } };
  socket.receive('game:state', rolled); socket.requests[0].ack(null, { ok: true }); await tick();
  assert.equal(client.canRoll(), false); assert.equal(client.canSelect('head'), true); assert.equal(client.canSelect('neck'), false);
  assert.equal(client.requestSelect('neck'), false); assert.equal(client.requestSelect('head'), true);
  assert.equal(client.requestSelect('head'), false);
  assert.deepEqual(socket.requests[1].payload, { gameId: 'game-1', turnNumber: 1, rollSequence: 1, groupId: 'head' });
  assert.equal('score' in socket.requests[1].payload, false);
  socket.requests[1].ack(null, { ok: false, error: 'Rejected' });
  socket.connected = false; socket.receive('disconnect');
  assert.equal(client.canSelect('head'), false); assert.equal(client.canRoll(), false);
});

test('non-current/eliminated players see the board but cannot request a selection', async () => {
  const { client, socket } = await controller({ id: 'b' });
  const state = { ...initial(), rolled: 3, eligibleGroupIds: ['head'] };
  socket.receive('game:state', state); client.ready(); await tick();
  assert.equal(client.requestSelect('head'), false); assert.equal(socket.requests.length, 0);
  socket.receive('game:state', { ...state, currentPlayerId: 'b', players: state.players.map(p => ({ ...p, eliminated: p.id === 'b' })) }); await tick();
  assert.equal(client.requestSelect('head'), false);
});

test('Alag client serializes dice and state updates; selection never optimistically removes a group', async () => {
  const { syncAlagBoard } = await import('../alag-multiplayer.mjs');
  const groups = initial().groups.map(g => ({ ...g, objects: [{ visible: true }] }));
  const applications = []; let finish;
  const animation = new Promise(resolve => { finish = resolve; });
  const { client, socket } = await controller({ applyState: async (state, options) => {
    applications.push(options);
    if (options.animate) await animation;
    syncAlagBoard(groups, state.groups);
  } });
  socket.receive('game:state', initial()); client.ready(); await tick();
  const rolled = { ...initial(), rolled: 3, rollSequence: 1, eligibleGroupIds: ['head'], lastRoll: { sequence: 1, value: 3 } };
  socket.receive('game:state', rolled); await tick();
  assert.equal(client.requestSelect('head'), false); finish(); await tick();
  assert.equal(client.requestSelect('head'), true); assert.equal(groups[0].objects[0].visible, true);
  assert.equal(groups[0].present, true);
  const taken = { ...rolled, rolled: 0, eligibleGroupIds: [], currentPlayerId: 'b', turnNumber: 2,
    groups: [{ id: 'head', present: false }, { id: 'neck', present: true }] };
  socket.receive('game:state', taken); socket.requests[0].ack(null, { ok: true }); await tick();
  assert.equal(groups[0].objects[0].visible, false); assert.equal(groups[1].objects[0].visible, true);
  assert.equal(client.requestSelect('head'), false); assert.equal(applications.filter(o => o.animate).length, 1);
  socket.receive('game:state', taken); await tick(); assert.equal(applications.filter(o => o.animate).length, 1);
  // Automatic restoration reuses the existing meshes, including after refresh.
  syncAlagBoard(groups, initial().groups); assert.equal(groups[0].objects[0].visible, true);
  assert.equal(groups[0].objects.length, 1);
  assert.throws(() => syncAlagBoard(groups, [{ id: 'forged', present: false }]), /IDs/);
});

test('refresh shows pending die/board without rerolling; finished games disable all controls', async () => {
  const applications = [];
  const { client, socket } = await controller({ applyState: async (_state, options) => applications.push(options) });
  const rolled = { ...initial(), rolled: 3, rollSequence: 10, eligibleGroupIds: ['head'], lastRoll: { value: 3 } };
  socket.receive('game:state', rolled); client.ready(); await tick();
  assert.equal(applications[0].animate, false); assert.equal(client.canSelect('head'), true);
  socket.receive('game:state', { ...rolled, finished: true }); await tick();
  assert.equal(client.canRoll(), false); assert.equal(client.canSelect('head'), false);
});

test('the existing raycast click routes the mesh group ID into the multiplayer request without local scoring/removal', async () => {
  const rules = await import('../alag-rules.mjs');
  const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
  const prefix = source.slice(0, source.indexOf("document.querySelectorAll('[data-count]')")).replace(/^import .*$/gm, '');
  const click = source.match(/renderer\.domElement\.addEventListener\('pointerup',e=>\{(.*?)\}\);const reduceMotion/s);
  assert.ok(click);
  const requested = [], element = { disabled: true, style: {} }, document = { getElementById: () => element };
  const context = { document, URLSearchParams, location: { search: '?lan=1' }, ...rules,
    requested, structuredClone, THREE: { Vector2: class {} } };
  vm.createContext(context);
  vm.runInContext(prefix + `
    multiplayer={requestSelect:id=>requested.push(id)};
    const target=groups.find(g=>g.id==='head');target.objects=[{visible:true}];
    meshes=[{visible:true,userData:{group:target}}];camera={};
    renderer={domElement:{getBoundingClientRect:()=>({left:0,top:0,width:400,height:600})}};
    const ray={setFromCamera(){},intersectObjects:objects=>[ {object:objects[0]} ]};
    const handler=e=>{${click[1]}};
    handler({clientX:100,clientY:100});
    globalThis.result=structuredClone({present:target.present,visible:target.objects[0].visible,scores});
  `, context);
  assert.deepEqual(requested, ['head']); assert.equal(context.result.present, true); assert.equal(context.result.visible, true);
  assert.deepEqual(context.result.scores, []);
});
