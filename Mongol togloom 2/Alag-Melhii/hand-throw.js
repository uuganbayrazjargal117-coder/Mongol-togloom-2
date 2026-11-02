// Finger reach uses 3D distances so a side-on hand can also release a throw.
export function handFeatures(points) {
  if (!points || points.length !== 21) return null;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  const extended=[8,12,16,20].filter(t=>distance(points[t],points[0])>distance(points[t-2],points[0])*1.15).length;
  const center=[0,5,9,13,17].reduce((p,i)=>({x:p.x+points[i].x/5,y:p.y+points[i].y/5}),{x:0,y:0});
  const size=Math.max(.025,distance(points[0],points[9]),distance(points[5],points[17]));
  return {...center,size,extended};
}
export function handPose(points) {
  const hand=handFeatures(points);
  return !hand?'missing':hand.extended<=1?'closed':hand.extended>=2?'open':'other';
}
export function createThrowGesture() {
  let closedSince=null,armed=false,lastThrow=-Infinity,motionTime=-Infinity,history=[];
  const clear=()=>{closedSince=null;armed=false;motionTime=-Infinity;history=[];};
  return (points,time,ready)=>{
    const hand=handFeatures(points);
    if(!ready||!hand){clear();return false;}
    if(history.length&&time-history.at(-1).time>250)clear();
    history=history.filter(p=>time-p.time<=240);
    const anchor=history.find(p=>time-p.time>=65);
    if(armed&&anchor){
      const travel=Math.hypot(hand.x-anchor.x,hand.y-anchor.y)/Math.max(hand.size,anchor.size);
      const speed=travel/((time-anchor.time)/1000);
      if(travel>=.55&&speed>=2.5)motionTime=time;
    }
    history.push({...hand,time});
    if(hand.extended<=1){closedSince??=time;if(time-closedSince>=140)armed=true;}
    else{
      closedSince=null;
      // A release must follow a quick sweep, rather than a stationary opening.
      if(armed&&time-motionTime<=280&&time-lastThrow>1800){clear();lastThrow=time;return true;}
      armed=false;motionTime=-Infinity;
    }
    return false;
  };
}
export function setupHandThrow({canThrow,throwDice,noun='шоо'}) {
  const button=document.getElementById('camera-toggle'),panel=document.getElementById('camera-panel'),video=document.getElementById('hand-video'),status=document.getElementById('camera-status');
  let stream=null,detector=null,active=false,busy=false,frame=0,lastFrame=-Infinity,lastVideoTime=-1;
  let gesture=createThrowGesture();
  const stop=()=>{
    active=false;cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());stream=null;
    video.srcObject=null;panel.hidden=true;button.textContent=`Камераар ${noun} хаях`;button.setAttribute('aria-pressed','false');gesture=createThrowGesture();
  };
  async function tick(time){
    if(!active)return;
    try{
      if(video.readyState>=2&&time-lastFrame>45&&video.currentTime!==lastVideoTime){
        lastFrame=time;lastVideoTime=video.currentTime;
        const result=detector.detectForVideo(video,time),points=result.landmarks[0],pose=handPose(points),ready=canThrow();
        if(gesture(points,time,ready)){status.textContent=`${noun==='шагай'?'Шагай':'Шоо'} хаялаа!`;throwDice();}
        else status.textContent=!ready?`Дараагийн ${noun} хаях ээлжийг хүлээнэ.`:pose==='missing'?'Гараа хажуугаас нь бүтнээр харуулаарай.':`${noun==='шагай'?'Шагай':'Шоо'} шидэх мэт гараа савж, хуруугаа суллаарай.`;
      }
    }catch(error){stop();panel.hidden=false;status.textContent='Гар танихад алдаа гарлаа. Камераа дахин асаана уу.';console.error(error);return;}
    frame=requestAnimationFrame(tick);
  }
  button.onclick=async()=>{
    if(busy)return;
    if(active){stop();return;}
    busy=true;button.disabled=true;panel.hidden=false;status.textContent='Камер болон гар танихыг бэлдэж байна…';
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
      video.srcObject=stream;await video.play();
      if(!detector){
        const {HandLandmarker,FilesetResolver}=await import('./vendor/hand/vision_bundle.mjs');
        const vision=await FilesetResolver.forVisionTasks(new URL('./vendor/hand/wasm',import.meta.url).href);
        detector=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('./vendor/hand/hand_landmarker.task',import.meta.url).href},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6});
      }
      active=true;lastVideoTime=-1;lastFrame=-Infinity;gesture=createThrowGesture();button.textContent='Камер унтраах';button.setAttribute('aria-pressed','true');frame=requestAnimationFrame(tick);
    }catch(error){
      stop();panel.hidden=false;
      status.textContent=error.name==='NotAllowedError'?'Камерын зөвшөөрөл өгөөд дахин асаана уу.':error.name==='NotFoundError'?'Камер олдсонгүй.':'Камер ассангүй. HTTPS эсвэл VS Code Live Server дээр нээгээд дахин оролдоно уу.';
      console.error(error);
    }finally{busy=false;button.disabled=false;}
  };
  window.addEventListener('pagehide',()=>{stop();detector?.close();detector=null;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)gesture=createThrowGesture();});
}
