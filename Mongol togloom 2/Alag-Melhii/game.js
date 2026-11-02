import * as THREE from 'three';
import { playDiceSound } from './dice-audio.js';
const $=id=>document.getElementById(id), groups=[];let scene,camera,renderer,geometry,meshes=[],count=2,player=0,scores=[],eliminated=[],rolled=0,mode='take',finished=false,rolling=false,started=false;
const colors={back:0x68261d,leg:0xeb97b2,foot:0x318439,neck:0x191e58,head:0x58c5c8,eye:0xa2a9dc,ear:0x811c19,tail:0x382b25,heart:0xef3836,kidney:0xf3d029,bladder:0x3d8dde,fire:0xe45433,wood:0x25a8df,metal:0xf2b653,element:0x62b4f3};
function group(name,n,color,positions){groups.push({name,n,color,positions,present:true,objects:[]});}
// Positions traced from the supplied reference photograph (1200 × 1694).
const point=(x,y,height=0,rotation=0)=>[(x-600)/100,(y-1000)/100,height,rotation];
const points=(pairs,height=0,rotation=0)=>pairs.map(([x,y])=>point(x,y,height,rotation));
const backRows=[
 [[433,752,-.03],[498,763,.09],[565,747,.05],[631,751,.02],[695,767,.06],[764,746,-.04]],
 [[427,850,.06],[496,851,.03],[562,849,-.04],[630,851,.04],[699,854,.06],[766,847,-.04]],
 [[432,946,.03],[498,947,-.06],[565,941,.03],[632,943,-.03],[699,942,.01],[766,941,.02]],
 [[437,1037,-.03],[499,1039,.06],[566,1033,-.01],[634,1034,.04],[700,1036,.04],[767,1036,-.01]],
 [[438,1133,-.04],[501,1132,.03],[565,1131,-.02],[632,1131,.01],[701,1131,.03],[766,1133,-.03]],
 [[433,1223,-.02],[500,1222,.06],[563,1222,.04],[630,1222,-.03],[699,1222,.01],[765,1223,-.03]]
];
backRows.forEach((row,r)=>group(`Нуруу · ${r+1}-р эгнээ`,6,colors.back,row.map(([x,y,a])=>point(x,y,0,a))));
group('Хүзүү',6,colors.neck,points([[575,475],[635,475],[575,560],[635,560],[575,650],[635,650]]));
group('Толгой',3,colors.head,points([[600,220],[600,305],[600,390]]));
group('Нүд',2,colors.eye,[point(500,250,0,1.2),point(710,250,0,-.85)]);
group('Чих',2,0x16775c,[point(517,415,0,.75),point(700,410,0,-.75)]);
group('Сүүл',3,colors.tail,points([[600,1325],[600,1425],[600,1525]]));
const limbs=[
 {name:'Зүүн урд',leg:[[300,575],[355,550],[347,665],[401,641]],rotation:.55,foot:[[188,646,-1.1],[190,556,-1.4],[246,495,-.75],[321,466,-.2],[400,468,.05]],element:[332,618]},
 {name:'Баруун урд',leg:[[850,564],[909,590],[802,633],[861,669]],rotation:-.55,foot:[[836,488,-.1],[917,480,.25],[977,526,.75],[1011,600,1.35],[1002,679,1.1]],element:[854,620]},
 {name:'Зүүн хойд',leg:[[284,1357],[344,1300],[337,1410],[396,1354]],rotation:-.65,foot:[[177,1307,1.2],[182,1391,1.4],[215,1465,.8],[281,1512,.35],[356,1521,.05]],element:[329,1360]},
 {name:'Баруун хойд',leg:[[813,1300],[873,1346],[864,1362],[923,1414]],rotation:.65,foot:[[1048,1285,1.35],[1046,1368,1.4],[1005,1452,-.85],[940,1503,-.45],[868,1527,-.15]],element:[868,1350]}
];
limbs.forEach((l,i)=>{const [cx,cy]=l.element;const a=l.rotation;const leg=[[-1,-1],[1,-1],[-1,1],[1,1]].map(([u,v])=>point(cx+u*32*Math.cos(a)+v*43*Math.sin(a),cy-u*32*Math.sin(a)+v*43*Math.cos(a),0,a));group(l.name+' шилбэ',4,colors.leg,leg);group(l.name+' тавхай',5,colors.foot,l.foot.map(([x,y])=>point(cx+(x-cx)*1.06,cy+(y-cy)*1.06,0,Math.atan2(x-cx,y-cy)+Math.PI)));group(['Шороо','Огторгуй','Уул','Салхи'][i],1,i===2?colors.neck:colors.element,points([l.element],.55,l.rotation));});
group('Зүрх',1,colors.heart,[point(655,890,.55,.1)]);group('Давсаг',1,colors.bladder,[point(520,1186,.55,.08)]);group('Бөөр',2,colors.kidney,[point(545,1095,.55,.12),point(616,1095,.55,-.08)]);
group('Гал',4,colors.ear,[point(395,180,0,.95),point(360,250,0,1.3),point(819,158,0,-.85),point(855,227,0,-1.25)]);
group('Мод',5,colors.wood,[point(281,974,0,1.57),point(278,1035,0,1.57),point(275,1096,0,1.57),point(361,981),point(358,1082)]);
group('Төмөр',3,colors.metal,[point(880,1009,0,1.55+Math.PI),point(1006,1050,0,1.15+Math.PI),point(1105,1120,0,.85+Math.PI)]);
const dice=['','⚀','⚁','⚂','⚃','⚄','⚅'];
function reset(){count=Math.max(1,Math.min(12,Math.floor(Number($('players').value)||2)));$('players').value=count;player=0;scores=Array(count).fill(0);eliminated=Array(count).fill(false);rolled=0;finished=false;for(const g of groups){g.present=true;g.objects.forEach(m=>m.visible=true);}if(renderer)$('roll').disabled=!started;setDie(5);$('message').textContent='Шоо хаяад авах эрхтнээ сонгоорой.';update();}
function update(){let remaining=groups.filter(g=>g.present).reduce((a,g)=>a+g.n,0);$('remaining').textContent=remaining+' шагай үлдсэн';$('turn').textContent=finished?'Тоглоом дууслаа':`Тоглогч ${player+1}`;$('scores').replaceChildren(...scores.map((s,i)=>{let el=document.createElement('div');el.className='score'+(i===player&&!finished?' active':'')+(eliminated[i]?' eliminated':'');let label=document.createElement('span');label.textContent=`Тоглогч ${i+1}${eliminated[i]?' · хасагдсан':''}`;let num=document.createElement('strong');num.textContent=s+' шагай';el.append(label,num);return el;}));$('choices').replaceChildren();for(const g of groups){g.objects.forEach(m=>{const highlighted=Boolean(valid(g));m.material.emissive.setHex(0);m.material.emissiveIntensity=0;if(m.userData.outline)m.userData.outline.visible=highlighted;});}if(rolled){for(const g of eligible()){let b=document.createElement('button');b.className='eligible-choice';b.textContent=(mode==='return'?'Буцаах: ':'')+g.name+` · ${g.n}`;b.disabled=lan;b.onclick=()=>select(g);$('choices').append(b);}}}
function eligible(){return groups.filter(g=>g.n===rolled&&(mode==='take'?g.present:(!g.present&&scores[player]>=rolled)));}function valid(g){return rolled&&eligible().includes(g);}
function next(){rolled=0;do{player=(player+1)%count;}while(eliminated[player]);$('roll').disabled=false;update();}
function eliminateCurrent(){const removed=player+1,amount=rolled;eliminated[player]=true;rolled=0;const remaining=scores.map((_,i)=>i).filter(i=>!eliminated[i]);const text=`${amount} буулаа. Тоглогч ${removed} буцаах шагай хүрэлцэхгүй тул тоглоомоос хасагдлаа.`;if(remaining.length<=1){finished=true;$('roll').disabled=true;$('message').textContent=text+(remaining.length?` Тоглогч ${remaining[0]+1} хожлоо!`:' Тоглоом дууслаа.');update();}else{next();$('message').textContent=text+' Дараагийн ээлж.'}}
function select(g){if(lan)return;if(!valid(g)||finished)return;if(mode==='take'){g.present=false;scores[player]+=g.n;}else{g.present=true;scores[player]-=g.n;}g.objects.forEach(m=>m.visible=g.present);const text=`Тоглогч ${player+1} ${g.name.toLowerCase()}${mode==='take'?' авлаа':' буцааж өрлөө'}.`;if(groups.every(x=>!x.present)){finished=true;rolled=0;const max=Math.max(...scores.filter((_,i)=>!eliminated[i])),winners=scores.map((s,i)=>!eliminated[i]&&s===max?i+1:null).filter(Boolean);$('message').textContent=`${winners.map(i=>'Тоглогч '+i).join(', ')} ${max} шагайгаар хожлоо!`;$('roll').disabled=true;update();}else{next();$('message').textContent=text+' Дараагийн ээлж.'}}
$('roll').onclick=async()=>{if(lan){requestLanRoll();return;}if(!started||rolled||finished||rolling)return;rolling=true;$('roll').disabled=true;$('restart').disabled=true;$('message').textContent='Шоо өнхөрч байна…';const result=Math.floor(Math.random()*6)+1;await animateDie(result);rolling=false;$('restart').disabled=false;rolled=result;mode='take';$('roll').disabled=true;if(!eligible().length){mode='return';if(!eligible().length){eliminateCurrent();return;}const returningPlayer=player+1;const amount=rolled;select(eligible()[0]);$('message').textContent=`${amount} буулаа. Тоглогч ${returningPlayer} өөрийн ${amount} шагайг буцааж өрлөө.`;return;}else $('message').textContent=`${rolled} буулаа.`;update();};
$('restart').onclick=()=>{if(lan)return;if(!scores.some(Boolean)||confirm('Одоогийн тоглолтыг дуусгаж шинээр эхлэх үү?')){started=false;$('roll').disabled=true;$('start-screen').hidden=false;$('start').focus();}};
$('start').onclick=()=>{if(lan)return;started=true;reset();$('start-screen').hidden=true;positionCamera();$('roll').focus();};
document.querySelectorAll('[data-count]').forEach(b=>b.onclick=()=>{$('players').value=b.dataset.count;syncPlayerPicks();});
function syncPlayerPicks(){document.querySelectorAll('[data-count]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.count)===Number($('players').value)));}
$('players').oninput=syncPlayerPicks;$('rules').onclick=()=>$('help').showModal();$('close').onclick=()=>$('help').close();
function positionCamera(){const el=$('scene'),aspect=el.clientWidth/el.clientHeight;const halfH=8.1,halfW=Math.max(5.55,halfH*aspect);camera.left=-halfW;camera.right=halfW;camera.top=halfW/aspect;camera.bottom=-halfW/aspect;camera.position.set(0,36,-1.55);camera.lookAt(0,0,-1.55);camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight);}

// Fine pores and soft ivory variation on the existing bone model.
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

async function init(){try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));$('scene').append(renderer.domElement);scene=new THREE.Scene();camera=new THREE.OrthographicCamera(-8,8,10,-10,.1,100);scene.add(new THREE.HemisphereLight(0xfff5e7,0x6d6254,1.25));const light=new THREE.DirectionalLight(0xfff1da,3.6);light.position.set(-9,15,-6);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:1,far:60});light.shadow.bias=-.0005;light.shadow.normalBias=.025;scene.add(light);const fill=new THREE.DirectionalLight(0xdceaff,.85);fill.position.set(8,10,5);scene.add(fill);const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.ShadowMaterial({opacity:.23}));ground.rotation.x=-Math.PI/2;ground.position.y=.03;ground.receiveShadow=true;scene.add(ground);const data=await fetch('./bone.json').then(r=>{if(!r.ok)throw Error();return r.json();});geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.vertices,3));geometry.setIndex(data.faces);geometry.computeVertexNormals();const uv=[];for(let i=0;i<data.vertices.length;i+=3)uv.push((data.vertices[i]+.281)/.561,(data.vertices[i+2]+.44)/.88);geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));const boneSurface=makeBoneSurface();const outlinePath=new THREE.CatmullRomCurve3(data.outline.map(([x,z])=>new THREE.Vector3(x,data.outlineY,z)),true,'centripetal');const outlineGeometry=new THREE.TubeGeometry(outlinePath,data.outline.length,.022,6,true);const glowGeometries=[.04,.065,.09].map(radius=>new THREE.TubeGeometry(outlinePath,data.outline.length,radius,6,true));for(const g of groups){for(const [x,z,y,rotation=0]of g.positions){const m=new THREE.Mesh(geometry,new THREE.MeshPhysicalMaterial({color:g.color,map:boneSurface.color,bumpMap:boneSurface.bump,bumpScale:.007,roughness:.5,metalness:0,clearcoat:.13,clearcoatRoughness:.42}));m.castShadow=true;m.receiveShadow=true;m.position.set(x,y+.3,z);m.rotation.y=rotation;let width=1.28,length=1.13;
if(g.name.includes('тавхай')){width=1.25;length=1.02;}
else if(g.name.includes('шилбэ')){width=1.42;length=1.16;}
else if(['Шороо','Огторгуй','Уул','Салхи'].includes(g.name)){width=1.42;length=1.12;}
else if(g.name==='Чих'){width=1.22;length=1.04;}
else if(['Гал','Нүд'].includes(g.name)){width=1.42;length=1.12;}
else if(g.name==='Толгой'){width=1.2;length=.84;}
else if(g.name==='Хүзүү'){width=1.0;length=.9;}
m.scale.set(width,1,length);m.userData.group=g;const outline=new THREE.Mesh(outlineGeometry,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.96,depthTest:false,depthWrite:false,toneMapped:false}));outline.renderOrder=10;glowGeometries.forEach((geo,i)=>{const halo=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:[.20,.08,.025][i],blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,toneMapped:false}));halo.renderOrder=9-i;outline.add(halo);});outline.visible=false;m.add(outline);m.userData.outline=outline;scene.add(m);meshes.push(m);g.objects.push(m);}}$('loading').remove();positionCamera();reset();$('start').disabled=false;$('start').textContent='Тоглож эхлэх';$('start-status').textContent='Тоглогчдын тоогоо сонгоод эхлээрэй.';new ResizeObserver(positionCamera).observe($('scene'));const ray=new THREE.Raycaster();renderer.domElement.addEventListener('pointerup',e=>{const b=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),camera);const hit=ray.intersectObjects(meshes.filter(m=>m.visible),false)[0];if(hit)select(hit.object.userData.group);});const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;renderer.setAnimationLoop(()=>{const wave=reduceMotion?0:(Math.sin(performance.now()*.004)+1)*.5;for(const g of groups){if(!valid(g))continue;for(const m of g.objects){m.userData.outline.material.opacity=.90+wave*.06;m.userData.outline.children.forEach((halo,i)=>halo.material.opacity=[.20,.08,.025][i]*(.90+wave*.20));}}renderer.render(scene,camera);});}catch(err){if($('loading'))$('loading').textContent='3D дүрслэл ачаалсангүй. Хуудсыг дахин нээнэ үү.';$('start-status').textContent='Өрөг ачаалсангүй. Хуудсыг дахин нээнэ үү.';$('message').textContent='WebGL дэмждэг хөтөч дээр нээнэ үү.';console.error(err);}}
const faceAngles={1:[0,0],2:[0,-90],3:[-90,0],4:[90,0],5:[0,90],6:[0,180]};
function setDie(value){const [x,y]=faceAngles[value];$('die').style.transform=`rotateX(${x}deg) rotateY(${y}deg)`;$('die').setAttribute('aria-label',`${value} буулаа`);}
async function animateDie(value){const cube=$('die'),[x,y]=faceAngles[value],reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;playDiceSound(reduced?.2:1.2);const anim=cube.animate(reduced?[{opacity:.4},{opacity:1}]:[{transform:'translate(-60px,-30px) rotateX(0deg) rotateY(0deg) rotateZ(-25deg)'},{offset:.4,transform:'translate(30px,-42px) rotateX(390deg) rotateY(250deg) rotateZ(20deg)'},{offset:.7,transform:'translate(10px,0px) rotateX(620deg) rotateY(530deg) rotateZ(-12deg)'},{offset:.87,transform:`translate(0,-9px) rotateX(${x+720}deg) rotateY(${y+720}deg)`},{transform:`translate(0,0) rotateX(${x+720}deg) rotateY(${y+720}deg)`}],{duration:reduced?200:1200,easing:'ease-out'});await anim.finished;setDie(value);}
import { setupHandThrow } from './hand-throw.js';
setupHandThrow({canThrow:()=>started&&!rolled&&!rolling&&!finished,throwDice:()=>$('roll').click()});

const lan=new URLSearchParams(location.search).get('lan')==='1';
let lanSocket=null,lanId=null,lanState=null,lanReady=false,lanSequence=0,lanPending=false;
function renderLanUI(){
  if(!lanState)return;
  const current=lanState.players.find(p=>p.id===lanState.currentPlayerId);
  $('turn').textContent=current ? current.name+' | Seat '+(current.seat+1) : 'Waiting for server';
  $('scores').replaceChildren(...lanState.players.map(p=>{
    const el=document.createElement('div');
    el.className='score'+(p.id===lanState.currentPlayerId?' active':'');
    const label=document.createElement('span'),value=document.createElement('strong');
    label.textContent=p.name+' | Seat '+(p.seat+1)+(p.id===lanId?' (You)':'');
    value.textContent=p.score+' bones';el.append(label,value);return el;
  }));
  $('roll').disabled=!lanReady||!lanSocket?.connected||lanPending||rolling||Boolean(lanState.rolled)||lanState.finished||lanId!==lanState.currentPlayerId;
}
async function applyLanState(){
  if(!lanReady||!lanState)return;
  const state=lanState;
  started=state.started;finished=state.finished;count=state.players.length;
  scores=state.players.map(p=>p.score);eliminated=state.players.map(p=>p.eliminated);
  player=state.players.findIndex(p=>p.id===state.currentPlayerId);
  $('start-screen').hidden=true;$('restart').disabled=true;
  if(state.rollSequence>lanSequence){
    lanSequence=state.rollSequence;rolling=true;renderLanUI();
    $('message').textContent='Rolling dice...';
    await animateDie(state.rolled);rolling=false;
  }
  rolled=state.rolled;mode='take';update();renderLanUI();
  $('message').textContent=rolled ? rolled+' rolled. Group selection is not available yet.' : 'LAN: Waiting for '+$('turn').textContent+' to roll.';
}
function requestLanRoll(){
  if($('roll').disabled||!lanSocket)return;
  lanPending=true;renderLanUI();
  lanSocket.timeout(5000).emit('game:roll',{},(error,response)=>{
    lanPending=false;renderLanUI();
    if(error||!response?.ok)$('message').textContent=response?.error||'Server did not respond. Reconnecting...';
  });
}
if(lan){
  $('start-screen').hidden=true;$('restart').disabled=true;
  $('message').textContent='Connecting to LAN game...';
  if(typeof io==='function'){
    lanSocket=io({auth:{sessionToken:sessionStorage.getItem('lan-session-token')}});
    lanSocket.on('session',s=>{lanId=s.playerId;lanSocket.auth.sessionToken=s.token;sessionStorage.setItem('lan-session-token',s.token);renderLanUI();});
    lanSocket.on('game:state',state=>{lanState=state;applyLanState();});
    lanSocket.on('connect',renderLanUI);
    lanSocket.on('disconnect',()=>{renderLanUI();$('message').textContent='Disconnected. Reconnecting to your LAN seat...';});
    lanSocket.on('connect_error',()=>{$('roll').disabled=true;$('message').textContent='Cannot connect to LAN server.';});
    lanSocket.on('lobby:state',state=>{if(!state.started)$('message').textContent='No active LAN game. Return to the lobby.';});
  }
}
init().then(()=>{lanReady=true;if(lanState)applyLanState();});
