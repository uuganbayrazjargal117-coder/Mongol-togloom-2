// Recorded shagai sound supplied by the user; used by the horse race only.
export const THROW_DURATION = 2650;
let context, decoded, decoding, source;
const bytes = fetch(new URL('./shagai-throw.mp3', import.meta.url), {signal:AbortSignal.timeout(8000)})
  .then(r=>{if(!r.ok)throw Error('Шагайн дуу ачаалсангүй');return r.arrayBuffer();})
  .catch(()=>null);
export async function prepareShagaiSound(){
  try{
    const Audio = window.AudioContext || window.webkitAudioContext;
    if(!Audio)return null;
    context ??= new Audio();
    if(context.state==='suspended')await context.resume();
    if(!decoding)decoding=bytes.then(data=>data?context.decodeAudioData(data):null).then(buffer=>decoded=buffer).catch(()=>null);
    return await decoding;
  }catch{return null;}
}
window.addEventListener('pointerdown',()=>{void prepareShagaiSound();},{passive:true});
window.addEventListener('keydown',()=>{void prepareShagaiSound();});
export async function playShagaiSound(){
  const buffer=decoded || await prepareShagaiSound();
  if(!buffer || !context || context.state!=='running')return false;
  try{
    source?.stop();
    const node=context.createBufferSource();node.buffer=buffer;node.connect(context.destination);
    source=node;node.onended=()=>{node.disconnect();if(source===node)source=null;};
    node.start();return true;
  }catch{return false;}
}
window.addEventListener('pagehide',()=>{try{source?.stop();}catch{};source=null;void context?.close();});
