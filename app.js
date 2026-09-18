import { ACTIONS, FlyArena } from './arena.js';
import { LinearQLearner, neuralActionPrior, neuralFeatures } from './policy.js';

const $=(id)=>document.getElementById(id);
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const arenaCanvas=$('arena');
const arena=new FlyArena(arenaCanvas);
const ui={
  system:$('system-status'),start:$('start'),pause:$('pause'),reset:$('reset'),overlay:$('overlay'),
  round:$('round'),time:$('time'),scoreA:$('score-a'),scoreB:$('score-b'),
  fly:[0,1].map((i)=>({
    status:$(`status-${i?'b':'a'}`),brain:$(`brain-${i?'b':'a'}`),action:$(`action-${i?'b':'a'}`),
    active:$(`active-${i?'b':'a'}`),rate:$(`rate-${i?'b':'a'}`),stability:$(`stability-${i?'b':'a'}`),
    contacts:$(`contacts-${i?'b':'a'}`),epsilon:$(`epsilon-${i?'b':'a'}`),reward:$(`reward-${i?'b':'a'}`),distance:$(`distance-${i?'b':'a'}`),
  })),
};

const agents=[0,1].map((i)=>({
  id:i?'B':'A', worker:null,ready:false,frame:{},positions:null,bounds:null,
  learner:new LinearQLearner(14,ACTIONS.length,i?'B':'A'),
  previousFeatures:null,action:0,actionUntil:0,reward:0,
}));

let running=false,raf=0,lastFrame=0,lastControl=0;

function status(el,text,tone=''){el.textContent=text;el.className=`status${tone?` ${tone}`:''}`;}

function bootBrain(i){
  return new Promise((resolve,reject)=>{
    const a=agents[i];
    const w=new Worker('./brain-worker.js',{type:'module'});a.worker=w;
    w.onmessage=({data:m})=>{
      if(m.type==='status')status(ui.fly[i].status,m.message,'warn');
      if(m.type==='progress'){
        const p=m.total?` ${Math.min(100,Math.round(m.loaded/m.total*100))}%`:'';
        status(ui.fly[i].status,`${m.label}${p}`,'warn');
      }
      if(m.type==='ready'){
        a.ready=true;a.positions=m.positions;a.bounds=brainBounds(m.positions);
        status(ui.fly[i].status,`${Number(m.n).toLocaleString()} neurons`,'ok');
        resolve();
      }
      if(m.type==='frame'){a.frame=m.frame||{};updateAgentUI(i);}
      if(m.type==='error'){status(ui.fly[i].status,'brain error','error');reject(new Error(m.message));}
    };
    w.onerror=(e)=>reject(e.error||new Error(e.message));
    w.postMessage({cmd:'boot'});
  });
}

async function bootAll(){
  try{
    ui.system.textContent='loading fly A';
    await bootBrain(0);
    ui.system.textContent='loading fly B';
    status(ui.fly[1].status,'booting','warn');
    await bootBrain(1);
    status(ui.system,'two brains ready','ok');
    ui.start.disabled=false;
    ui.overlay.querySelector('strong').textContent='Two independent brains ready';
    ui.overlay.querySelector('span').textContent='Start the arena to begin closed-loop self-play.';
  }catch(e){console.error(e);status(ui.system,'brain load failed','error');ui.overlay.querySelector('strong').textContent='Brain load failed';ui.overlay.querySelector('span').textContent=String(e?.message||e);}
}

function brainBounds(pos){
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;const n=pos.length/3;const stride=Math.max(1,Math.floor(n/5000));
  for(let i=0;i<n;i+=stride){const x=pos[i*3],y=pos[i*3+1];if(!Number.isFinite(x+y))continue;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  return{minX,maxX,minY,maxY};
}

function drawBrain(i){
  const a=agents[i],cv=ui.fly[i].brain,c=cv.getContext('2d'),w=cv.width,h=cv.height;
  c.fillStyle='#05090c';c.fillRect(0,0,w,h);
  if(!a.positions||!a.bounds){c.fillStyle='#71808c';c.font='12px monospace';c.fillText('loading connectome…',16,24);return;}
  const p=a.positions,n=p.length/3,b=a.bounds;const sx=(w-28)/Math.max(1,b.maxX-b.minX),sy=(h-28)/Math.max(1,b.maxY-b.minY),s=Math.min(sx,sy);
  const ox=(w-(b.maxX-b.minX)*s)/2,oy=(h-(b.maxY-b.minY)*s)/2;
  c.fillStyle='rgba(140,159,169,.12)';const stride=Math.max(1,Math.floor(n/2700));
  for(let k=0;k<n;k+=stride){const x=ox+(p[k*3]-b.minX)*s,y=oy+(p[k*3+1]-b.minY)*s;if(Number.isFinite(x+y))c.fillRect(x,y,1,1);}
  c.fillStyle=i?'#ff7b91':'#67b7ff';for(const k of a.frame.active_idx||[]){if(k>=n)continue;const x=ox+(p[k*3]-b.minX)*s,y=oy+(p[k*3+1]-b.minY)*s;if(Number.isFinite(x+y))c.fillRect(x-1,y-1,2.4,2.4);}
}

function updateAgentUI(i){
  const a=agents[i],f=arena.fly[i],u=ui.fly[i],sens=arena.getSensory(i);
  u.active.textContent=Number(a.frame.active_neurons||0).toLocaleString();
  u.rate.textContent=`${Number(a.frame.mean_rate_hz||0).toFixed(2)} Hz`;
  u.action.textContent=ACTIONS[a.action]?.name||'idle';
  u.stability.textContent=f.stability.toFixed(0);
  u.contacts.textContent=f.contacts.toLocaleString();
  u.epsilon.textContent=a.learner.epsilon.toFixed(3);
  u.reward.textContent=a.reward.toFixed(2);
  u.distance.textContent=sens.meta.distance.toFixed(2);
}

function aggregateEvents(events){
  const rewards=[-.004,-.004];let terminal=false;
  for(const e of events){
    if(Array.isArray(e.rewards)){rewards[0]+=Number(e.rewards[0])||0;rewards[1]+=Number(e.rewards[1])||0;}
    if(e.type==='contact'&&Number.isInteger(e.receiver)){
      const r=e.receiver;const sens=arena.getSensory(r);const side=sens.meta.bearing_deg<0?'left':sens.meta.bearing_deg>0?'right':'center';
      agents[r].worker?.postMessage({cmd:'contact',side,strength:clamp(Number(e.severity)||.5,0,1)});
    }
    if(e.terminal)terminal=true;
  }
  return{rewards,terminal};
}

function control(now){
  const events=arena.consumeEvents();const outcome=aggregateEvents(events);
  for(let i=0;i<2;i++){
    const a=agents[i];if(!a.ready)continue;
    const sensory=arena.getSensory(i);a.worker.postMessage({cmd:'vision',vision:sensory});
    if(!Number.isFinite(a.frame.t_ms)||a.frame.t_ms<=0)continue;
    const x=neuralFeatures(a.frame);
    if(a.previousFeatures)a.learner.update(a.previousFeatures,a.action,outcome.rewards[i],x,outcome.terminal);
    a.previousFeatures=x;a.reward+=outcome.rewards[i];
    if(outcome.terminal){a.worker.postMessage({cmd:'reset',seed:(arena.round+1)*97+i*31});a.previousFeatures=null;a.action=0;a.actionUntil=0;}
    if(now>=a.actionUntil&&!outcome.terminal){
      const prior=neuralActionPrior(a.frame,ACTIONS.length);const mask=arena.getActionMask(i);const next=a.learner.choose(x,prior,mask);a.action=next;arena.setAction(i,next);
      a.actionUntil=now+(next===5?260:105+Math.random()*80);
    }
    updateAgentUI(i);
  }
}

function updateGlobal(){
  ui.round.textContent=arena.round.toLocaleString();ui.time.textContent=`${arena.roundTime.toFixed(1)}s`;ui.scoreA.textContent=arena.fly[0].score;ui.scoreB.textContent=arena.fly[1].score;
}

function loop(now){
  if(!running)return;const dt=lastFrame?(now-lastFrame)/1000:0;lastFrame=now;arena.update(dt);arena.render();
  if(now-lastControl>70){lastControl=now;control(now);}
  drawBrain(0);drawBrain(1);updateGlobal();raf=requestAnimationFrame(loop);
}

function start(){
  if(running||!agents.every(a=>a.ready))return;running=true;ui.start.disabled=true;ui.pause.disabled=false;ui.pause.textContent='Pause';ui.overlay.hidden=true;arena.start();lastFrame=performance.now();lastControl=0;for(const a of agents)a.worker?.postMessage({cmd:'play'});raf=requestAnimationFrame(loop);status(ui.system,'arena running','ok');
}
function pause(){
  running=!running;ui.pause.textContent=running?'Pause':'Resume';arena.running=running;for(const a of agents)a.worker?.postMessage({cmd:running?'play':'pause'});if(running){lastFrame=performance.now();raf=requestAnimationFrame(loop);status(ui.system,'arena running','ok');}else{cancelAnimationFrame(raf);status(ui.system,'paused');}
}
function resetLearning(){
  for(const a of agents){a.learner.reset();a.reward=0;a.previousFeatures=null;a.action=0;}
  arena.resetMatch();updateGlobal();for(let i=0;i<2;i++)updateAgentUI(i);
}

ui.start.addEventListener('click',start);ui.pause.addEventListener('click',pause);ui.reset.addEventListener('click',resetLearning);
window.addEventListener('pagehide',()=>agents.forEach(a=>a.learner.persist()));
setInterval(()=>agents.forEach(a=>a.learner.persist()),5000);
arena.render();drawBrain(0);drawBrain(1);updateGlobal();bootAll();
