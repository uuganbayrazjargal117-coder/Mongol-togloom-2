import { mountGameSwitch } from './game-switch-ui.mjs';
import * as THREE from 'three';
import {playShagaiSound, THROW_DURATION} from './shagai-audio.js';
import {setupHandThrow} from './hand-throw.js';
import {advance} from './race-logic.mjs';
import {createHorseMultiplayer} from './race-multiplayer.mjs';
const $=id=>document.getElementById(id);
const palette=['#ef3836','#f3d029','#3d8dde','#eb97b2','#318439','#191e58','#e45433','#58c5c8','#25a8df','#68261d','#f2b653','#a2a9dc'];
const names=['Морь','Тэмээ','Хонь','Ямаа'];
// The two narrow sides are horse/camel; broad sides are sheep/goat.
const sideAngles=[Math.PI/2,-Math.PI/2,0,Math.PI];
let boneSurface,geometry,board,tray,racers=[],bones=[],track=new THREE.Group(),current=0,length=18,ranking=[],busy=false,active=false,throwMotion=null,moveMotion=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const multiplayerMode=new URLSearchParams(location.search).get('lan')==='1';
let multiplayer=null,raceReady=false,networkBoardGame=null;

function showNetworkFaces(faces){
 $('face-labels').replaceChildren(...faces.map(f=>{
  const label=document.createElement('span');label.textContent=names[f];
  if(f===0)label.style.color='#8a1726';return label;
 }));
}
function renderNetworkControls({state,playerId,canThrow,canRestart=false,canSwitch=false}){
 $('throw').disabled=!canThrow;
 if(state){$('switch-game').hidden=state.hostId!==playerId;$('switch-game').disabled=!canSwitch;}
 $('new-game').disabled=!canRestart;
 if(state)$('new-game').hidden=state.hostId!==playerId;
 if(!raceReady||!state)return;
 const currentPlayer=state.players.find(p=>p.id===state.currentPlayerId);
 $('turn').textContent=state.finished?'Race finished':currentPlayer?`${currentPlayer.name} · Seat ${currentPlayer.seat+1}`:'Waiting for players to reconnect';
 $('race-scores').replaceChildren(...state.players.map(p=>{
  const row=document.createElement('div');row.className='race-score'+(p.id===state.currentPlayerId&&!state.finished?' active':'');
  const label=document.createElement('span');label.className='player-name';
  const dot=document.createElement('i');dot.className='swatch';dot.style.background=palette[state.players.indexOf(p)];
  label.append(dot,document.createTextNode(`${p.name} · Seat ${p.seat+1}${p.id===playerId?' (You)':''}${p.connected?'':' · offline'}`));
  const score=document.createElement('strong');const rank=state.ranking.indexOf(p.id);
  score.textContent=rank>=0?`#${rank+1}`:`${p.position} / ${state.trackLength}`;
  row.append(label,score);return row;
 }));
 racers.forEach((r,i)=>{r.outline.visible=!state.finished&&state.players[i]?.id===state.currentPlayerId;});
}
async function applyHorseState(state,{animate,signal}){
 if(signal?.aborted)return;
 const reset=networkBoardGame!==state.id;
 length=state.trackLength;
 if(networkBoardGame===null||racers.length!==state.players.length||Number($('track-length').value)!==length){
  $('track-length').value=String(length);makeBoard(state.players.length,state.players.map(p=>p.seat+1));
 }
 networkBoardGame=state.id;
 if(reset){busy=false;bones.forEach((m,i)=>{m.position.set((1.5-i)*1.28,.5,0);m.rotation.set(0,0,sideAngles[i]);});showNetworkFaces([0,1,2,3]);}
 $('race-setup').hidden=true;$('track-length').disabled=true;$('race-players').disabled=true;$('begin').disabled=true;
 $('track-label').textContent=`${length} шагайн зам`;
 active=!state.finished;current=state.players.findIndex(p=>p.id===state.currentPlayerId);
 ranking=state.ranking.map(id=>state.players.findIndex(p=>p.id===id));
 const last=state.lastThrow;
 state.players.forEach((p,i)=>{
  racers[i].position=p.position;racers[i].finished=p.finished;
  racers[i].mesh.position.x=xAt(animate&&last?.playerId===p.id?last.fromPosition:p.position);
 });
 if(animate&&last){
  busy=true;$('result').textContent='Дөрвөн шагай хаяж байна…';
  $('face-labels').replaceChildren(...names.map(()=>{const el=document.createElement('span');el.textContent='…';return el;}));
  // Audio decoding never delays the network animation or holds up the server turn.
  void playShagaiSound();
  await animateThrow(last.faces);if(signal?.aborted)return;showNetworkFaces(last.faces);
  const actor=state.players.findIndex(p=>p.id===last.playerId);
  await animateHorse(racers[actor],{position:last.position});if(signal?.aborted)return;busy=false;
 }else if(state.faces.length){
  showNetworkFaces(state.faces);
  bones.forEach((m,i)=>{m.rotation.set(0,0,sideAngles[state.faces[i]]);});
 }
 state.players.forEach((p,i)=>{racers[i].mesh.position.x=xAt(p.position);racers[i].mesh.position.y=.43;});
 update();
 const actor=last&&state.players.find(p=>p.id===last.playerId);
 $('result').textContent=state.finished
  ? 'Final ranking: '+state.ranking.map((id,i)=>`${i+1}. ${state.players.find(p=>p.id===id).name}`).join(' · ')
  : last?`${actor.name}: ${last.different?'Дөрвөн бэрх!':last.horses+' морь'} · +${last.steps} · ${last.position} / ${length}`
  : 'Waiting for the current player to throw.';
}
function surface(id){
 const host=$(id),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-10,10,6,-6,.1,100);
 camera.up.set(0,0,-1);camera.position.set(0,30,0);camera.lookAt(0,0,0);
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;host.append(renderer.domElement);
 scene.add(new THREE.HemisphereLight(0xfff5e7,0x6d6254,.75));
 const key=new THREE.DirectionalLight(0xfff1da,3.6);key.position.set(-9,15,-6);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-16,right:16,top:16,bottom:-16,near:1,far:60});key.shadow.bias=-.0005;key.shadow.normalBias=.025;scene.add(key);
 const fill=new THREE.DirectionalLight(0xdceaff,.35);fill.position.set(8,10,5);scene.add(fill);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.ShadowMaterial({opacity:.23}));ground.rotation.x=-Math.PI/2;ground.position.y=.03;ground.receiveShadow=true;scene.add(ground);
 return {host,scene,camera,renderer};
}
function fit(view,width,height){const ratio=view.host.clientWidth/view.host.clientHeight;const w=Math.max(width,height*ratio),h=w/ratio;Object.assign(view.camera,{left:-w/2,right:w/2,top:h/2,bottom:-h/2});view.camera.updateProjectionMatrix();view.renderer.setSize(view.host.clientWidth,view.host.clientHeight);}
function resize(){if(!board)return;fit(board,length+4,Math.max(5,racers.length*.62+2));fit(tray,5.5,2.2);}
function bone(color,scale=1){const mesh=new THREE.Mesh(geometry,new THREE.MeshPhysicalMaterial({color,vertexColors:true,map:boneSurface.color,bumpMap:boneSurface.bump,bumpScale:.007,roughness:.5,metalness:0,clearcoat:.13,clearcoatRoughness:.42}));mesh.castShadow=true;mesh.receiveShadow=true;mesh.scale.setScalar(scale);return mesh;}
function textSprite(text,color='#503528'){const c=document.createElement('canvas');c.width=256;c.height=96;const cx=c.getContext('2d');cx.font='bold 44px sans-serif';cx.textAlign='center';cx.fillStyle=color;cx.fillText(text,128,62);const texture=new THREE.CanvasTexture(c),m=new THREE.SpriteMaterial({map:texture,transparent:true,toneMapped:false});const s=new THREE.Sprite(m);s.scale.set(1.45,.55,1);return s;}
function clearTrack(){track.traverse(o=>{if(o.isMesh&&o.geometry!==geometry)o.geometry.dispose();if(o.material){if(o.material.map && o.material.map!==boneSurface.color)o.material.map.dispose();o.material.dispose();}});track.clear();}
function xAt(p){return -length/2+p;}
function makeBoard(n,seats){clearTrack();racers=Array.from({length:n},(_,i)=>({position:0,finished:false,color:palette[i]}));const top=0;for(let j=1;j<=length;j++){const m=bone('#286c78',1.05);m.rotation.set(0,Math.PI/2,sideAngles[0]);m.position.set(xAt(j),.35,top);track.add(m);if(j%3===0||j===length){const s=textSprite(String(j));s.position.set(xAt(j),.05,-Math.ceil(n/2)*.62-.8);track.add(s);}}
 racers.forEach((r,i)=>{const z=(i%2===0?-1:1)*(.60+Math.floor(i/2)*.62);const points=[new THREE.Vector3(xAt(0),0,z),new THREE.Vector3(xAt(length),0,z)];const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#79543b',transparent:true,opacity:.13}));track.add(line);const group=new THREE.Group();const m=bone(r.color,1.15);m.rotation.z=sideAngles[0];group.add(m);
 const outline=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.BackSide,toneMapped:false}));outline.scale.setScalar(1.075);outline.renderOrder=1;outline.visible=false;m.add(outline);r.outline=outline;
 const halo=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.BackSide,transparent:true,opacity:.14,depthWrite:false,toneMapped:false}));halo.scale.setScalar(1.035);outline.add(halo);
 group.position.set(xAt(0),.43,z);group.rotation.y=Math.PI/2;track.add(group);r.mesh=group;const label=textSprite(String(seats?.[i]??i+1),r.color);label.position.set(xAt(0)-1.05,.05,z);track.add(label);});
 const finish=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(xAt(length)+.55,.01,-Math.ceil(n/2)*.62-.4),new THREE.Vector3(xAt(length)+.55,.01,Math.ceil(n/2)*.62+.4)]),new THREE.LineBasicMaterial({color:0x79543b}));track.add(finish);resize();}
function update(){ $('turn').textContent=active?`Тоглогч ${current+1}`:'Тоглоом дууслаа';$('race-scores').replaceChildren(...racers.map((r,i)=>{const row=document.createElement('div');row.className='race-score'+(active&&i===current?' active':'');const name=document.createElement('span');name.className='player-name';const dot=document.createElement('i');dot.className='swatch';dot.style.background=r.color;name.append(dot,document.createTextNode(`Тоглогч ${i+1}`));const score=document.createElement('strong');score.textContent=r.finished?`${ranking.indexOf(i)+1}-р байр`:`${r.position} / ${length}`;row.append(name,score);return row;}));racers.forEach((r,i)=>{r.mesh.children[0].material.emissive.setHex(0);r.outline.visible=i===current&&active;});}
function start(){if(multiplayerMode||busy)return;let n=Math.max(1,Math.min(12,Math.floor(Number($('race-players').value)||2)));$('race-players').value=n;length=Number($('track-length').value);ranking=[];current=0;active=true;makeBoard(n);bones.forEach((m,i)=>{m.position.set((1.5-i)*1.28,.5,0);m.rotation.set(0,0,sideAngles[i]);});$('face-labels').replaceChildren(...names.map(name=>{const label=document.createElement('span');label.textContent=name;return label;}));$('track-label').textContent=`${length} шагайн зам`;$('race-setup').hidden=true;$('throw').disabled=false;$('result').textContent='Дөрвөн шагай хаяж уралдаарай.';update();}
function next(){if(busy||!active)return;do{current=(current+1)%racers.length;}while(racers[current].finished);$('throw').disabled=false;update();$('throw').focus();}
function animateThrow(faces){return new Promise(resolve=>{throwMotion={start:performance.now(),duration:THROW_DURATION,faces,resolve};});}
function animateHorse(horse,target){return new Promise(resolve=>{moveMotion={start:performance.now(),duration:reduced?150:800,horse,from:horse.mesh.position.x,to:xAt(target.position),resolve};});}
async function roll(){if(multiplayerMode){multiplayer?.requestThrow();return;}if(!active||busy)return;busy=true;$('throw').disabled=true;$('new-game').disabled=true;$('result').textContent='Дөрвөн шагай хаяж байна…';$('face-labels').replaceChildren(...names.map(()=>{let s=document.createElement('span');s.textContent='…';return s;}));const faces=Array.from({length:4},()=>Math.floor(Math.random()*4));await playShagaiSound();await animateThrow(faces);$('face-labels').replaceChildren(...faces.map(f=>{const s=document.createElement('span');s.textContent=names[f];if(f===0)s.style.color='#8a1726';return s;}));const r=racers[current],result=advance(r,faces,length);await animateHorse(r,result);r.position=result.position;let message=`Тоглогч ${current+1}: `+(result.different?'Дөрвөн бэрх! 4 алхам.':`${result.horses} морь буулаа.`);if(result.steps===0)message+=' Байрандаа үлдэнэ.';else message+=` ${r.position} / ${length} шагай.`;
 if(r.position===length){r.finished=true;ranking.push(current);message=`Тоглогч ${current+1} ${ranking.length}-р байранд барианд орлоо!`;}if(ranking.length===racers.length){active=false;message+=` Тоглоом дууслаа. Түрүү: Тоглогч ${ranking[0]+1}.`;}busy=false;$('new-game').disabled=false;$('result').textContent=message;update();if(active)next();}
$('begin').onclick=start;$('throw').onclick=roll;$('new-game').onclick=()=>{if(multiplayerMode){multiplayer?.requestRestart();return;}if(!busy)$('race-setup').hidden=false;};$('rules').onclick=()=>$('race-help').showModal();$('close-help').onclick=()=>$('race-help').close();
function makeBoneSurface(){
  const size=128,color=new Uint8Array(size*size*4),bump=new Uint8Array(size*size*4);
  let seed=108;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,grain=random(),shade=245+Math.round(5*Math.sin(x*.14)*Math.sin(y*.11)+grain*5);
    color.set([shade,shade-2,shade-6,255],i);
    const pore=grain<.025?65:118+Math.round(grain*35);bump.set([pore,pore,pore,255],i);
  }
  const texture=bytes=>{const t=new THREE.DataTexture(bytes,size,size);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;};
  const surface=texture(color);surface.colorSpace=THREE.SRGBColorSpace;
  return {color:surface,bump:texture(bump)};
}

async function init(){try{const response=await fetch('./race-bone.json');if(!response.ok)throw Error('Шагайн загвар олдсонгүй');const data=await response.json();geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.vertices,3));geometry.setIndex(data.faces);geometry.computeVertexNormals();geometry.setAttribute('color',new THREE.Float32BufferAttribute(data.colors,3));const uv=[];for(let i=0;i<data.vertices.length;i+=3)uv.push((data.vertices[i]+.281)/.561,(data.vertices[i+2]+.44)/.88);geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));boneSurface=makeBoneSurface();board=surface('race-scene');tray=surface('throw-scene');tray.camera.up.set(0,0,1);tray.camera.lookAt(0,0,0);board.scene.add(track);for(let i=0;i<4;i++){const m=bone('#f4e4c7',1.45);m.position.set((1.5-i)*1.28,.5,0);m.rotation.z=sideAngles[i];tray.scene.add(m);bones.push(m);}makeBoard(2);$('loading').remove();$('begin').disabled=false;$('begin').textContent='Уралдаж эхлэх';$('result').textContent='Тоглогчдын тоогоо сонгоорой.';new ResizeObserver(resize).observe(board.host);new ResizeObserver(resize).observe(tray.host);
 function frame(now){if(throwMotion){const a=throwMotion,t=Math.min(1,(now-a.start)/a.duration),ease=1-Math.pow(1-t,3);bones.forEach((m,i)=>{m.position.x=(1.5-i)*1.28+Math.sin(t*Math.PI*4+i)*.18*(1-t);m.position.z=Math.sin(t*Math.PI*3+i)*.45*(1-t);const flight=.64;const bounce=t<flight?Math.sin(t/flight*Math.PI)*1.5:Math.abs(Math.sin((t-flight)/(1-flight)*Math.PI*3))*.38*(1-t)/(1-flight);m.position.y=.5+(reduced?0:bounce);m.rotation.set(reduced?0:(1-ease)*(Math.PI*4+i),0,sideAngles[a.faces[i]]+(reduced?0:(1-ease)*Math.PI*6));});if(t===1){throwMotion=null;a.resolve();}}
 if(moveMotion){const a=moveMotion,t=Math.min(1,(now-a.start)/a.duration),e=t*t*(3-2*t);a.horse.mesh.position.x=a.from+(a.to-a.from)*e;a.horse.mesh.position.y=.43+(reduced?0:Math.sin(t*Math.PI)*.5);if(t===1){moveMotion=null;a.resolve();}}
 board.renderer.render(board.scene,board.camera);tray.renderer.render(tray.scene,tray.camera);requestAnimationFrame(frame);}requestAnimationFrame(frame);return true;
 }catch(e){console.error(e);$('loading').textContent='3D дүрслэл ачаалсангүй. Хуудсыг дахин нээнэ үү.';$('begin').textContent='Ачаалж чадсангүй';}}
if(multiplayerMode){
 $('race-setup').hidden=true;$('new-game').disabled=true;
 $('result').textContent='Connecting to Horse Racing...';
 if(typeof io==='function'){multiplayer=createHorseMultiplayer({applyState:applyHorseState,renderControls:renderNetworkControls,cancelAnimations:()=>{const oldThrow=throwMotion,oldMove=moveMotion;throwMotion=null;moveMotion=null;oldThrow?.resolve();oldMove?.resolve();busy=false;},onStatus:text=>{$('result').textContent=text;}});mountGameSwitch(multiplayer);}
 else $('result').textContent='Server unavailable. Open the race through the multiplayer lobby.';
}
setupHandThrow({noun:'шагай',canThrow:()=>multiplayerMode?Boolean(multiplayer?.canThrow()):active&&!busy&&$('race-setup').hidden,throwDice:roll});
init().then(loaded=>{if(loaded){raceReady=true;multiplayer?.ready();}});
