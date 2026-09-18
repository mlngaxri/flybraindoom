const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

export function neuralFeatures(frame={}){
  const ch=frame.channels||{};
  const dn=frame.dn_rates||{};
  const left=Number(dn.DN_left??dn.left??dn.DNa02_L??0)||0;
  const right=Number(dn.DN_right??dn.right??dn.DNa02_R??0)||0;
  const esc=Number(dn.DN_escape??dn.escape??dn.DNp01??0)||0;
  const mean=Number(frame.mean_rate_hz)||0;
  const active=Number(frame.active_neurons)||0;
  return Float32Array.from([
    1,
    clamp(Number(ch.turn_bias)||0,-1,1),
    clamp(Number(ch.escape_takeoff)||0,0,1),
    clamp(Number(ch.escape_long_mode)||0,0,1),
    clamp(Number(ch.stop_freeze)||0,0,1),
    clamp(Number(ch.backward_walk)||0,0,1),
    clamp(mean/30,0,2),
    clamp(active/12000,0,2),
    clamp(left/60,0,2),
    clamp(right/60,0,2),
    clamp(esc/60,0,2),
    clamp((right-left)/60,-2,2),
    clamp(Number(frame.proboscis_drive)||0,0,1),
    clamp(Number(frame.escape_laterality)||0,-1,1),
  ]);
}

export function neuralActionPrior(frame={},n=6){
  const ch=frame.channels||{};
  const t=clamp(Number(ch.turn_bias)||0,-1,1);
  const escape=clamp(Math.max(Number(ch.escape_takeoff)||0,Number(ch.escape_long_mode)||0),0,1);
  const freeze=clamp(Number(ch.stop_freeze)||0,0,1);
  const back=clamp(Number(ch.backward_walk)||0,0,1);
  const p=new Float32Array(n);
  p[0]=freeze*.8+.04;
  p[1]=Math.max(0,.08-back*.15)+escape*.08;
  p[2]=back*.45+freeze*.10;
  p[3]=Math.max(0,-t)*.55;
  p[4]=Math.max(0,t)*.55;
  p[5]=escape*.18;
  return p;
}

function mirrorFeatures(x){
  const y=Float32Array.from(x);
  y[1]*=-1;
  [y[8],y[9]]=[y[9],y[8]];
  y[11]*=-1;
  y[13]*=-1;
  return y;
}
function mirroredAction(a){return a===3?4:a===4?3:a;}

export class LinearQLearner{
  constructor(inputSize,actionCount,id){
    this.inputSize=inputSize;this.actionCount=actionCount;this.id=id;
    this.alpha=.010;this.gamma=.965;this.epsilon=.16;this.minEpsilon=.025;this.decay=.99965;
    this.priorWeight=.16;this.updates=0;
    this.weights=Array.from({length:actionCount},()=>new Float32Array(inputSize));
    this.key=`flybrainarena.policy.v1.${id}`;
    this.restore();
  }
  q(x,a){let s=0,w=this.weights[a];for(let i=0;i<this.inputSize;i++)s+=w[i]*x[i];return s;}
  values(x,prior){const q=new Float32Array(this.actionCount);for(let a=0;a<this.actionCount;a++)q[a]=this.q(x,a)+(prior?.[a]||0)*this.priorWeight;return q;}
  choose(x,prior,mask){
    const allowed=[];for(let a=0;a<this.actionCount;a++)if(!mask||mask[a])allowed.push(a);
    if(!allowed.length)return 0;
    if(Math.random()<this.epsilon)return allowed[(Math.random()*allowed.length)|0];
    const q=this.values(x,prior);let best=allowed[0],bv=-Infinity;
    for(const a of allowed){if(q[a]>bv){bv=q[a];best=a;}}
    return best;
  }
  _updateOne(x,a,r,nx,done){
    const next=done?0:Math.max(...Array.from({length:this.actionCount},(_,i)=>this.q(nx,i)));
    const td=clamp(r+this.gamma*next-this.q(x,a),-12,12);
    const w=this.weights[a];for(let i=0;i<this.inputSize;i++)w[i]+=this.alpha*td*x[i];
  }
  update(x,a,r,nx,done){
    this._updateOne(x,a,r,nx,done);
    this._updateOne(mirrorFeatures(x),mirroredAction(a),r,mirrorFeatures(nx),done);
    this.updates++;
    this.epsilon=Math.max(this.minEpsilon,this.epsilon*this.decay);
    if(this.updates%24===0)this.persist();
  }
  reset(){
    this.weights=Array.from({length:this.actionCount},()=>new Float32Array(this.inputSize));
    this.epsilon=.16;this.updates=0;try{localStorage.removeItem(this.key);}catch{}
  }
  persist(){
    try{localStorage.setItem(this.key,JSON.stringify({v:1,epsilon:this.epsilon,updates:this.updates,weights:this.weights.map(w=>Array.from(w))}));}catch{}
  }
  restore(){
    try{
      const s=JSON.parse(localStorage.getItem(this.key)||'null');if(!s||s.v!==1||!Array.isArray(s.weights))return;
      for(let a=0;a<this.actionCount;a++)if(Array.isArray(s.weights[a])&&s.weights[a].length===this.inputSize)this.weights[a]=Float32Array.from(s.weights[a]);
      if(Number.isFinite(s.epsilon))this.epsilon=clamp(s.epsilon,this.minEpsilon,.25);
      if(Number.isFinite(s.updates))this.updates=s.updates|0;
    }catch{}
  }
}
