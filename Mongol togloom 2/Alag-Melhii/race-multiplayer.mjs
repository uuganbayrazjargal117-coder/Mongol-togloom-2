import { createMultiplayerSession } from './multiplayer-session.mjs';
export function createHorseMultiplayer(view, options) {
  let state=null,canAct=false;
  const canThrow=()=>Boolean(canAct&&state.phase==='ready');
  const session=createMultiplayerSession({
    stateEvent:'horse:state',gameType:'horse',
    sequence:s=>s.lastThrow?.sequence??0,restoreSequence:()=>0,
    animate:(s,_restoring,isNew)=>isNew&&s.phase==='animating',
    actionFields:()=>({})
  },{...view,renderControls:controls=>{
    state=controls.state;canAct=controls.canAct;
    view.renderControls({...controls,canThrow:canThrow()});
  }},options);
  return {...session,canThrow,requestThrow:()=>canThrow()?session.request('horse:throw'):false};
}
