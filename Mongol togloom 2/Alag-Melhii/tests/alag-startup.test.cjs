const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(r => setImmediate(r));

async function rendererFixture({ playerId = 'a', failure } = {}) {
  const THREE = await import('../vendor/three.module.js');
  const rules = await import('../alag-rules.mjs');
  const network = await import('../alag-multiplayer.mjs');
  const { loadAlagModel } = await import('../alag-startup.mjs');
  const elements = new Map(), errors = [], handlers = new Map(), requests = [];
  class Element {
    children = []; style = {}; dataset = {}; classList = { toggle() {} }; value = 2;
    clientWidth = 900; clientHeight = 650;
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(key, value) { this[key] = value; }
    remove() { elements.delete('loading'); }
    addEventListener(name, handler) { this[name] = handler; }
    focus() {}
  }
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: () => new Element(), querySelectorAll: query => query.includes('#choices') ? document.getElementById('choices').children : [] };
  class Renderer {
    domElement = new Element(); shadowMap = {};
    constructor() { if (failure === 'webgl') throw Error('WebGL context unavailable'); }
    setPixelRatio() {} setSize() {} render() {}
    setAnimationLoop(callback) { callback(); }
  }
  const socket = { connected: true, auth: {}, on: (name, handler) => handlers.set(name, handler),
    timeout() { return this; }, emit: (...args) => requests.push(args) };
  let finishModel;
  const loading = new Promise(resolve => { finishModel = resolve; });
  const model = JSON.parse(fs.readFileSync(path.join(__dirname, '../bone.json'), 'utf8'));
  const context = {
    THREE: { ...THREE, WebGLRenderer: Renderer, Mesh: class extends THREE.Mesh {
      constructor(...args) { if (failure === 'mesh' && args[0]?.type === 'BufferGeometry') throw Error('Mesh construction failed'); super(...args); }
    } }, ...rules, ...network,
    createAlagMultiplayer: view => network.createAlagMultiplayer(view, { ioFactory: () => socket, storage: { getItem: () => 'token', setItem() {} } }),
    loadAlagModel: setStage => loadAlagModel(setStage, async url => {
      assert.ok(url.pathname.endsWith('/bone.json')); await loading;
      return { ok: failure !== 'fetch', status: 503, json: async () => {
        if (failure === 'json') throw new SyntaxError('Invalid model JSON');
        return model;
      } };
    }),
    document, io() {}, URLSearchParams, location: { search: '?lan=1' }, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }), ResizeObserver: class { observe() {} },
    setupHandThrow() {}, playDiceSound() {}, performance, structuredClone,
    console: { error: (...args) => errors.push(args), debug() {} }
  };
  const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8').replace(/^import .*$/gm, '');
  vm.createContext(context);
  vm.runInContext(source + `
    globalThis.inspect=()=>structuredClone({groups:groups.length,meshes:meshes.length,
      present:groups.filter(g=>g.present).length,visible:meshes.filter(m=>m.visible).length,scores,
      ready:multiplayer.readiness(),canRoll:multiplayer.canRoll()});
  `, context);
  const state = { id: 'race-start', hostId: 'a', started: true, finished: false,
    players: [{ id: 'a', name: 'Host', seat: 0, score: 0, eliminated: false }, { id: 'b', name: 'Guest', seat: 1, score: 0, eliminated: false }],
    currentPlayerId: 'a', currentSeat: 0, groups: rules.ALAG_GROUPS.map(g => ({ ...g, present: true })),
    turnNumber: 1, rolled: 0, rollSequence: 0, mode: 'take', eligibleGroupIds: [], winners: [], lastAction: null, lastRoll: null };
  return { state, errors, requests, document, inspect: context.inspect,
    async session() { handlers.get('session')({ playerId, token: 'token' }); await tick(); },
    async stateReceived(value = state) { handlers.get('game:state')(value); await tick(); },
    async model() { finishModel(); await tick(); await tick(); },
    async connect() { handlers.get('connect')(); await tick(); }
  };
}

for (const order of [['session', 'stateReceived', 'model'], ['model', 'stateReceived', 'session'],
  ['stateReceived', 'model', 'session'], ['model', 'session', 'stateReceived'],
  ['stateReceived', 'session', 'model'], ['session', 'model', 'stateReceived']]) {
  test('full Alag initializer: ' + order.join(' → '), async () => {
    const f = await rendererFixture();
    for (const event of order) await f[event]();
    const board = f.inspect();
    assert.deepEqual(f.errors, []); assert.equal(board.groups, 29); assert.equal(board.meshes, 108);
    assert.equal(board.present, 29); assert.equal(board.visible, 108);
    assert.deepEqual(board.scores, [0, 0]); assert.equal(board.canRoll, true);
    assert.equal(f.document.getElementById('roll').disabled, false);
    assert.equal(f.document.getElementById('restart').disabled, false);
    assert.equal(f.document.getElementById('restart').hidden, false);
    await f.stateReceived(); assert.equal(f.inspect().meshes, 108);
  });
}
test('full Alag initializer: guest sees all groups but cannot roll/restart; restore uses existing meshes', async () => {
  const f = await rendererFixture({ playerId: 'b' });
  f.state.groups.find(g => g.id === 'head').present = false; f.state.players[0].score = 3;
  await f.stateReceived(); await f.model(); await f.session();
  assert.equal(f.inspect().visible, 105); assert.deepEqual(f.inspect().scores, [3, 0]);
  assert.equal(f.document.getElementById('roll').disabled, true); assert.equal(f.document.getElementById('restart').hidden, true);
  const reset = structuredClone(f.state); reset.id = 'restarted'; reset.groups.forEach(g => { g.present = true; }); reset.players[0].score = 0;
  await f.stateReceived(reset); assert.equal(f.inspect().visible, 108); assert.equal(f.inspect().meshes, 108);
  assert.deepEqual(f.errors, []);
});
for (const [failure, stage] of [['webgl', 'webgl'], ['fetch', 'bone-fetch'], ['json', 'bone-json'], ['mesh', 'mesh-creation']]) {
  test('Alag startup reports the original ' + stage + ' failure without enabling controls', async () => {
    const f = await rendererFixture({ failure }); await f.session(); await f.stateReceived(); await f.model();
    assert.match(f.errors[0][0], new RegExp(stage)); assert.ok(f.errors[0][1] instanceof Error);
    assert.equal(f.inspect().canRoll, false); assert.equal(f.document.getElementById('roll').disabled, true);
  });
}
