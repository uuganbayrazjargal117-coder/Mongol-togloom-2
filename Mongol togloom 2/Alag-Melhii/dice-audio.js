// Short wooden clicks and a soft rattle, generated locally without audio files.
let context;
function unlock(){
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return null;
    context??=new Audio();
    if(context.state==='suspended')context.resume().catch(()=>{});
    return context;
  }catch{return null;}
}
window.addEventListener('pointerdown',unlock,{passive:true});
window.addEventListener('keydown',unlock);
export function playDiceSound(duration=1.2){
  const ctx=unlock();if(!ctx)return;
  const start=ctx.currentTime+.015;
  const beats=duration<.5?[0,.55]:[0,.09,.2,.34,.5,.69,.84,.96];
  beats.forEach((beat,i)=>{
    const at=start+beat*duration,length=.065;
    const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*length),ctx.sampleRate),samples=buffer.getChannelData(0);
    for(let j=0;j<samples.length;j++)samples[j]=(Math.random()*2-1)*Math.exp(-j/(ctx.sampleRate*.013));
    const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),volume=ctx.createGain();
    filter.type='bandpass';filter.frequency.value=1200+i*140;filter.Q.value=.7;
    volume.gain.value=i===beats.length-1?.3:.16;
    noise.buffer=buffer;noise.connect(filter);filter.connect(volume);volume.connect(ctx.destination);noise.start(at);
    noise.onended=()=>{noise.disconnect();filter.disconnect();volume.disconnect();};
    const click=ctx.createOscillator(),gain=ctx.createGain();click.type='triangle';
    click.frequency.setValueAtTime(440,at);click.frequency.exponentialRampToValueAtTime(160,at+.04);
    gain.gain.setValueAtTime(i===beats.length-1?.09:.045,at);gain.gain.exponentialRampToValueAtTime(.001,at+.055);
    click.connect(gain);gain.connect(ctx.destination);click.start(at);click.stop(at+.06);
    click.onended=()=>{click.disconnect();gain.disconnect();};
  });
}
