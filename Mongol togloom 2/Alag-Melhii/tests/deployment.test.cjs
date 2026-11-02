const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { io: connect } = require('socket.io-client');
const { createLobbyServer } = require('../server');
const root=path.join(__dirname,'..');
test('deployment serves runtime assets and health without exposing private files',async t=>{
  const {httpServer,io}=createLobbyServer();
  t.after(()=>new Promise(r=>io.close(r)));
  await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+httpServer.address().port;
  assert.deepEqual(await (await fetch(base+'/healthz')).json(),{ok:true});
  const assets=['/','/lobby.html','/turtle.html','/race.html','/style.css','/lobby.css','/lobby.js','/game.js','/race.js','/hand-throw.js','/dice-audio.js','/bone.json','/race-bone.json','/vendor/three.module.js','/vendor/three.core.js','/vendor/hand/vision_bundle.mjs','/vendor/hand/hand_landmarker.task','/vendor/hand/wasm/vision_wasm_internal.js','/vendor/hand/wasm/vision_wasm_internal.wasm','/vendor/hand/wasm/vision_wasm_nosimd_internal.js','/vendor/hand/wasm/vision_wasm_nosimd_internal.wasm','/shagai-throw.mp3','/olbog.png','/ger-room.png','/socket.io/socket.io.js'];
  for(const asset of assets){
    const response=await fetch(base+asset);assert.equal(response.status,200,asset);
    if(asset.endsWith('.wasm'))assert.match(response.headers.get('content-type'),/application\/wasm/);
    assert.ok((await response.arrayBuffer()).byteLength>0,asset);
  }
  for(const asset of ['/race-multiplayer.mjs','/race-logic.mjs','/shagai-audio.js']){
    const response=await fetch(base+asset);assert.equal(response.status,200,asset);
    assert.match(response.headers.get('content-type'),/javascript/);await response.arrayBuffer();
  }
  assert.equal((await fetch(base+'/horse-game.cjs')).status,404);
  for(const resource of ['/server.js','/package.json','/package-lock.json','/.env','/.git/config','/tests/deployment.test.cjs','/vendor/hand/package.json','/STAGE-2-LAN.md','/RENDER-DEPLOYMENT.md','/node_modules/express/package.json'])assert.equal((await fetch(base+resource)).status,404,resource);
  for(const transport of ['polling','websocket']){
    const socket=connect(base,{transports:[transport],reconnection:false,autoConnect:false});
    t.after(()=>socket.disconnect());
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect();});
    assert.equal((await socket.timeout(3000).emitWithAck('lobby:join',{name:transport})).ok,true);
    socket.disconnect();
  }
});
test('browser endpoints remain same-origin and MediaPipe stays local',()=>{
  for(const file of ['lobby.js','game.js']){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    assert.match(source,/io\(\{\s*auth:/);
    assert.doesNotMatch(source,/(?:https?|wss?):\/\/|192\.168\.|10\.\d+\.\d+\.\d+/);
  }
  const raceNetwork=fs.readFileSync(path.join(root,'race-multiplayer.mjs'),'utf8');
  assert.match(raceNetwork,/ioFactory\(\{\s*auth:/);
  assert.doesNotMatch(raceNetwork,/(?:https?|wss?):\/\/|192\.168\.|10\.\d+\.\d+\.\d+/);
  const hand=fs.readFileSync(path.join(root,'hand-throw.js'),'utf8');
  assert.match(hand,/navigator.mediaDevices.getUserMedia/);
  assert.match(hand,/new URL\('\.\/vendor\/hand\/hand_landmarker.task',import.meta.url\)/);
  assert.doesNotMatch(hand,/https?:\/\/|socket\.emit|fetch\(/);
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.scripts.start,'node server.js');assert.ok(pkg.dependencies.express);assert.ok(pkg.dependencies['socket.io']);
});
