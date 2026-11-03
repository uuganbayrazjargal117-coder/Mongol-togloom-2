import { createMultiplayerSession } from './multiplayer-session.mjs';
// Apply logical presence to the existing meshes; never create/remove model instances.
export function syncAlagBoard(groups, board) {
  const byId = new Map(board.map(g => [g.id, g]));
  if (byId.size !== board.length || byId.size !== groups.length || groups.some(g => !byId.has(g.id))) {
    throw new Error('Alag Melkhii board IDs do not match the logical catalog.');
  }
  for (const group of groups) {
    group.present = byId.get(group.id).present;
    group.objects.forEach(mesh => { mesh.visible = group.present; });
  }
}

export function createAlagMultiplayer(view, options) {
  let state=null, canAct=false;
  const canRoll=()=>Boolean(canAct&&!state.rolled);
  const canSelect=id=>Boolean(canAct&&state.rolled&&state.mode==='take'&&state.eligibleGroupIds.includes(id));
  const session=createMultiplayerSession({
    stateEvent:'game:state',gameType:'alag',
    sequence:s=>s.rollSequence,restoreSequence:s=>s.rollSequence,
    animate:(_s,restoring,isNew)=>!restoring&&isNew,
    actionFields:s=>({rollSequence:s.rollSequence})
  },{...view,renderControls:controls=>{
    state=controls.state;canAct=controls.canAct;
    view.renderControls({...controls,canRoll:canRoll(),canSelect});
  }},options);
  return {...session,canRoll,canSelect,
    requestRoll:()=>canRoll()?session.request('game:roll'):false,
    requestSelect:id=>canSelect(id)?session.request('game:select',{groupId:id}):false
  };
}
