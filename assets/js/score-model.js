(() => {
  'use strict';
  const key=(player,hole)=>`${player}:${hole}`;
  const stamp=value=>Date.parse(value?.changed_at||value?.client_changed_at||'1970-01-01')||0;
  const normalise=v=>({scorecard_player_id:v.scorecard_player_id||v.player_id,hole_number:Number(v.hole_number||v.hole),strokes:v.picked_up?null:Number(v.strokes),picked_up:Boolean(v.picked_up),changed_at:v.changed_at||v.client_changed_at||'1970-01-01T00:00:00.000Z'});
  const valid=v=>Boolean(v&&(v.picked_up||(Number.isInteger(Number(v.strokes))&&Number(v.strokes)>=1&&Number(v.strokes)<=20)));
  function merge(remote,local,dirty,cleared=[]){
    const result={};
    remote.forEach(row=>{const v=normalise(row);result[key(v.scorecard_player_id,v.hole_number)]=v;});
    for(const k of Object.keys(dirty||{})){if(local[k]&&(!result[k]||stamp(local[k])>=stamp(result[k])))result[k]=local[k];}
    cleared.forEach(k=>delete result[k]);return result;
  }
  function acknowledge(dirty,sent){const result={...dirty};for(const [k,timestamp] of Object.entries(sent)){if(result[k]===timestamp)delete result[k];}return result;}
  const complete=(players,holes,scores)=>players.length>0&&holes.length===18&&players.every(p=>holes.every(h=>valid(scores[key(p.id,h.hole_number)])));
  const changes=(scores,dirty)=>Object.keys(dirty).filter(k=>valid(scores[k])).map(k=>{const v=scores[k];return{player_id:v.scorecard_player_id,hole:v.hole_number,strokes:v.picked_up?null:Number(v.strokes),picked_up:Boolean(v.picked_up),changed_at:v.changed_at};});
  window.BarfordScoreModel={key,stamp,normalise,valid,merge,acknowledge,complete,changes};
})();
