const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createLobbyServer } = require('../server');
function event(socket, name, predicate = () => true) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off(name,listener);reject(Error('Timed out: '+name));},3000);
    function listener(value){if(!predicate(value))return;clearTimeout(timer);socket.off(name,listener);resolve(value);}
    socket.on(name,listener);
  });
}
test('LAN lobby and authoritative Alag Melkhii roll/session regression', async t => {
  const { httpServer, io } = createLobbyServer();
  const clients=[];
  t.after(async()=>{clients.forEach(s=>s.disconnect());await new Promise(r=>io.close(r));});
  await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+httpServer.address().port;
  async function client(token){
    const s=connect(base,{autoConnect:false,reconnection:false,forceNew:true,auth:{sessionToken:token}});
    clients.push(s);s.on('session',session=>s.session=session);
    const ready=event(s,'lobby:state');s.connect();await ready;return s;
  }
  const emit=(s,name,...args)=>s.timeout(3000).emitWithAck(name,...args);
  await t.test('serves existing assets without exposing server files',async()=>{
    for(const path of ['/','/turtle.html','/race.html','/lobby.html','/game.js','/socket.io/socket.io.js','/bone.json']){
      const res=await fetch(base+path);assert.equal(res.status,200,path);await res.arrayBuffer();
    }
    for(const path of ['/server.js','/package.json','/tests/lobby.test.cjs','/node_modules/express/package.json'])assert.equal((await fetch(base+path)).status,404);
  });
  const host=await client(),guest=await client(),spectator=await client();
  await t.test('validates joins and assigns identical seats to everyone',async()=>{
    assert.equal((await emit(host,'lobby:join',{name:' '})).ok,false);
    assert.equal((await emit(host,'lobby:join',{name:'a'.repeat(31)})).ok,false);
    await emit(host,'lobby:join',{name:'Host'});
    const a=event(host,'lobby:state',s=>s.players.length===2),b=event(guest,'lobby:state',s=>s.players.length===2);
    await emit(guest,'lobby:join',{name:'Guest'});
    assert.deepEqual(await a,await b);assert.ok(host.session.token);
  });
  await t.test('only host can start; everyone receives the same game; Seat 1 starts',async()=>{
    assert.equal((await emit(guest,'lobby:start')).ok,false);
    assert.equal((await emit(spectator,'lobby:start')).ok,false);
    const a=event(host,'game:state'),b=event(guest,'game:state');
    assert.equal((await emit(host,'lobby:start')).ok,true);
    const state=await a;assert.deepEqual(state,await b);
    assert.equal(state.currentSeat,0);assert.equal(state.currentPlayerId,host.session.playerId);
    assert.equal(state.players.length,2);assert.equal(state.started,true);assert.equal(state.finished,false);
    assert.ok(state.players.every(p=>p.score===0&&!p.eliminated));
    assert.equal((await emit(host,'lobby:start')).ok,false);
    assert.equal((await emit(spectator,'lobby:join',{name:'Late join'})).ok,false);
  });
  let restoredHost,restoredGuest,restoredGame;
  await t.test('page navigation restores both identities, seats and the same game without joining again',async()=>{
    const hostToken=host.session.token,guestToken=guest.session.token,hostId=host.session.playerId,guestId=guest.session.playerId;
    host.disconnect();guest.disconnect();
    // Register listeners before connect to catch the initial authoritative snapshot.
    async function resume(token){
      const s=connect(base,{autoConnect:false,reconnection:false,forceNew:true,auth:{sessionToken:token}});clients.push(s);
      s.on('session',value=>s.session=value);const state=event(s,'game:state');s.connect();return [s,await state];
    }
    const [a,sa]=await resume(hostToken),[b,sb]=await resume(guestToken);
    restoredHost=a;restoredGuest=b;
    restoredGame=sa;
    assert.deepEqual(sa,sb);assert.equal(a.session.playerId,hostId);assert.equal(b.session.playerId,guestId);
    assert.deepEqual(sa.players.map(p=>p.seat),[0,1]);
  });
  await t.test('rejects non-current, spectator and forged-seat rolls',async()=>{
    assert.equal((await emit(restoredGuest,'game:roll',{seat:0,playerId:restoredHost.session.playerId,result:6})).ok,false);
    assert.equal((await emit(spectator,'game:roll',{})).ok,false);
  });
  await t.test('server generates 1-6 and broadcasts the same result to all; repeated rolls rejected',async()=>{
    const a=event(restoredHost,'game:state'),b=event(restoredGuest,'game:state');
    assert.equal((await emit(restoredHost,'game:roll',{gameId:restoredGame.id,turnNumber:restoredGame.turnNumber,result:99,seat:11})).ok,true);
    const state=await a;assert.deepEqual(state,await b);assert.ok(Number.isInteger(state.rolled)&&state.rolled>=1&&state.rolled<=6);
    assert.equal(state.rollSequence,1);assert.equal(state.currentSeat,0);
    assert.equal((await emit(restoredHost,'game:roll',{})).ok,false);
    assert.equal((await emit(restoredGuest,'game:roll',{})).ok,false);
    const reconnect=connect(base,{autoConnect:false,reconnection:false,forceNew:true,auth:{sessionToken:restoredGuest.session.token}});
    clients.push(reconnect);const replay=event(reconnect,'game:state');reconnect.connect();assert.deepEqual(await replay,state);
  });
});

test('lobby retains 12-seat capacity, duplicate-join protection and invalid-session rejection',async t=>{
  const {httpServer,io}=createLobbyServer();const clients=[];
  t.after(async()=>{clients.forEach(s=>s.disconnect());await new Promise(r=>io.close(r));});
  await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+httpServer.address().port;
  for(let i=0;i<13;i++){
    const s=connect(base,{autoConnect:false,reconnection:false,forceNew:true,auth:{sessionToken:'forged-token'}});
    clients.push(s);const ready=event(s,'lobby:state');s.connect();await ready;
    const result=await s.timeout(3000).emitWithAck('lobby:join',{name:'Player '+i});
    assert.equal(result.ok,i<12);
    if(i===0)assert.equal((await s.timeout(3000).emitWithAck('lobby:join',{name:'Duplicate'})).ok,true);
  }
  const state=event(clients[1],'game:state');
  assert.equal((await clients[12].timeout(3000).emitWithAck('lobby:start')).ok,false);
  await clients[0].timeout(3000).emitWithAck('lobby:start');
  assert.deepEqual((await state).players.map(p=>p.seat),Array.from({length:12},(_,i)=>i));
});
