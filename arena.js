export const ACTIONS = [
  { name: 'idle' },
  { name: 'forward' },
  { name: 'backward' },
  { name: 'turn-left' },
  { name: 'turn-right' },
  { name: 'lunge' },
];

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
const lerp = (a, b, t) => a + (b - a) * t;

function makeFly(id, x, y, angle, accent) {
  return {
    id, accent,
    x, y, angle,
    vx: 0, vy: 0, omega: 0,
    action: 0,
    stability: 100,
    contacts: 0,
    score: 0,
    lungeTime: 0,
    lungeCooldown: 0,
    contactCooldown: 0,
    flash: 0,
    legPhase: Math.random() * TAU,
    lastX: x,
    lastY: y,
  };
}

export class FlyArena {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.worldRadius = 7.6;
    this.bodyRadius = .56;
    this.round = 1;
    this.roundTime = 0;
    this.matchTime = 0;
    this.roundPause = 0;
    this.events = [];
    this.running = false;
    this.fly = [
      makeFly('A', -2.7, 0, 0, '#67b7ff'),
      makeFly('B', 2.7, 0, Math.PI, '#ff7b91'),
    ];
  }

  resetMatch() {
    this.fly[0].score = 0;
    this.fly[1].score = 0;
    this.round = 1;
    this.matchTime = 0;
    this.resetRound();
  }

  resetRound() {
    const a = this.fly[0], b = this.fly[1];
    Object.assign(a, makeFly('A', -2.7, this.rand(-.6,.6), this.rand(-.08,.08), a.accent), { score: a.score });
    Object.assign(b, makeFly('B', 2.7, this.rand(-.6,.6), Math.PI + this.rand(-.08,.08), b.accent), { score: b.score });
    this.roundTime = 0;
    this.roundPause = 0;
  }

  rand(a,b){ return a + Math.random() * (b-a); }

  start() { this.running = true; }
  pause() { this.running = false; }

  setAction(i, actionIndex) {
    const f = this.fly[i];
    f.action = clamp(actionIndex | 0, 0, ACTIONS.length - 1);
    if (f.action === 5 && f.lungeCooldown <= 0) {
      f.lungeTime = .24;
      f.lungeCooldown = 1.05;
      const impulse = 4.6;
      f.vx += Math.cos(f.angle) * impulse;
      f.vy += Math.sin(f.angle) * impulse;
      this.events.push({ type:'lunge', actor:i, rewards:[i===0?-0.04:0,i===1?-0.04:0] });
    } else if (f.action === 5) {
      f.action = 0;
    }
  }

  getActionMask(i) {
    const f = this.fly[i];
    return [true, true, true, true, true, f.lungeCooldown <= 0 && this.roundPause <= 0];
  }

  update(dt) {
    if (!this.running) return;
    dt = clamp(dt, 0, .04);
    this.matchTime += dt;
    if (this.roundPause > 0) {
      this.roundPause -= dt;
      if (this.roundPause <= 0) {
        this.round++;
        this.resetRound();
      }
      return;
    }
    this.roundTime += dt;

    for (let i=0;i<2;i++) {
      const f = this.fly[i];
      f.lastX = f.x; f.lastY = f.y;
      f.lungeTime = Math.max(0, f.lungeTime - dt);
      f.lungeCooldown = Math.max(0, f.lungeCooldown - dt);
      f.contactCooldown = Math.max(0, f.contactCooldown - dt);
      f.flash = Math.max(0, f.flash - dt);

      let thrust = 0;
      let turn = 0;
      if (f.action === 1) thrust = 5.0;
      if (f.action === 2) thrust = -2.8;
      if (f.action === 3) turn = -4.0;
      if (f.action === 4) turn = 4.0;
      if (f.action === 5 && f.lungeTime > 0) thrust = 7.5;

      f.omega += turn * dt;
      f.omega *= Math.pow(.20, dt);
      f.angle = wrap(f.angle + f.omega * dt);

      f.vx += Math.cos(f.angle) * thrust * dt;
      f.vy += Math.sin(f.angle) * thrust * dt;
      const drag = Math.pow(.13, dt);
      f.vx *= drag; f.vy *= drag;
      const speed = Math.hypot(f.vx,f.vy);
      const maxSpeed = f.lungeTime > 0 ? 6.7 : 3.6;
      if (speed > maxSpeed) { f.vx *= maxSpeed/speed; f.vy *= maxSpeed/speed; }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.legPhase += Math.max(.4, speed * 4.2) * dt;

      const d = Math.hypot(f.x,f.y);
      if (d > this.worldRadius - .25) {
        const nx = f.x / d, ny = f.y / d;
        const outward = f.vx*nx + f.vy*ny;
        if (outward > 0) { f.vx -= nx*outward*1.65; f.vy -= ny*outward*1.65; }
        f.x = nx*(this.worldRadius-.25); f.y = ny*(this.worldRadius-.25);
        f.stability = Math.max(0, f.stability - 7*dt);
      }
    }

    this.resolveContact();

    for (let i=0;i<2;i++) {
      const f = this.fly[i];
      const d = Math.hypot(f.x,f.y);
      if (d > this.worldRadius + .02 || f.stability <= 0) {
        this.finishRound(1-i, d > this.worldRadius ? 'ring-out' : 'stability');
        return;
      }
    }

    if (this.roundTime >= 40) {
      const a=this.fly[0], b=this.fly[1];
      const winner = a.stability === b.stability ? null : (a.stability > b.stability ? 0 : 1);
      this.finishRound(winner, 'time');
    }
  }

  resolveContact() {
    const a=this.fly[0], b=this.fly[1];
    let dx=b.x-a.x, dy=b.y-a.y;
    let d=Math.hypot(dx,dy);
    const minD=this.bodyRadius*2;
    if (d >= minD || d < 1e-6) return;
    const nx=dx/d, ny=dy/d;
    const overlap=minD-d;
    a.x -= nx*overlap*.5; a.y -= ny*overlap*.5;
    b.x += nx*overlap*.5; b.y += ny*overlap*.5;

    const rvx=b.vx-a.vx, rvy=b.vy-a.vy;
    const rel=rvx*nx+rvy*ny;
    if (rel < 0) {
      const impulse=-rel*.64 + .18;
      a.vx -= nx*impulse; a.vy -= ny*impulse;
      b.vx += nx*impulse; b.vy += ny*impulse;
    }

    if (a.contactCooldown>0 || b.contactCooldown>0) return;
    a.contactCooldown=b.contactCooldown=.24;
    const speedA=Math.hypot(a.vx,a.vy), speedB=Math.hypot(b.vx,b.vy);
    const facingA=Math.max(0, Math.cos(wrap(Math.atan2(dy,dx)-a.angle)));
    const facingB=Math.max(0, Math.cos(wrap(Math.atan2(-dy,-dx)-b.angle)));
    const attackA=(a.lungeTime>0?1.35:1)*speedA*facingA;
    const attackB=(b.lungeTime>0?1.35:1)*speedB*facingB;
    let attacker = null;
    if (attackA > attackB + .22) attacker=0;
    else if (attackB > attackA + .22) attacker=1;

    const severity=clamp(.18+Math.max(attackA,attackB)*.16,.18,.95);
    if (attacker !== null) {
      const receiver=1-attacker;
      const af=this.fly[attacker], rf=this.fly[receiver];
      af.contacts++; rf.flash=.22;
      rf.stability=Math.max(0,rf.stability-(3.5+severity*7.5));
      const push=1.1+severity*2.1;
      const sx=attacker===0?nx:-nx, sy=attacker===0?ny:-ny;
      rf.vx+=sx*push; rf.vy+=sy*push;
      this.events.push({type:'contact',actor:attacker,receiver,severity,rewards:attacker===0?[3.2+severity,-3.0-severity]:[-3.0-severity,3.2+severity]});
    } else {
      a.flash=b.flash=.10;
      this.events.push({type:'clash',rewards:[-.10,-.10]});
    }
  }

  finishRound(winner, reason) {
    if (this.roundPause>0) return;
    if (winner !== null) this.fly[winner].score++;
    const rewards = winner === 0 ? [7,-7] : winner === 1 ? [-7,7] : [-.4,-.4];
    this.events.push({type:'round-end',winner,reason,rewards,terminal:true});
    this.roundPause=1.25;
  }

  consumeEvents() {
    const e=this.events.slice(); this.events.length=0; return e;
  }

  getSensory(i) {
    const me=this.fly[i], other=this.fly[1-i];
    const dx=other.x-me.x, dy=other.y-me.y;
    const dist=Math.max(.01,Math.hypot(dx,dy));
    const bearing=wrap(Math.atan2(dy,dx)-me.angle);
    const ux=dx/dist, uy=dy/dist;
    const relClosing=(me.vx-other.vx)*ux+(me.vy-other.vy)*uy;
    const angular=clamp((this.bodyRadius*2)/dist,0,1.2);
    const loom=clamp(angular*.64+Math.max(0,relClosing)*.17+(other.lungeTime>0?.24:0),0,1);
    const az=bearing*180/Math.PI;
    const inFront=Math.abs(az)<105;
    const stimuli=[];
    if (inFront) {
      stimuli.push({
        azimuth_deg:clamp(az,-100,100),
        elevation_deg:0,
        strength:clamp(.05+angular*.95+Math.max(0,relClosing)*.10,0,1),
        salience:loom,
      });
    }
    const wallGap=Math.max(.05,this.worldRadius-Math.hypot(me.x,me.y));
    const wallStrength=clamp((1.3-wallGap)/1.3,0,1);
    if (wallStrength>.04) {
      const wallBearing=wrap(Math.atan2(me.y,me.x)+Math.PI-me.angle)*180/Math.PI;
      stimuli.push({azimuth_deg:clamp(wallBearing,-100,100),elevation_deg:-14,strength:wallStrength*.55,salience:wallStrength*.4});
    }
    let left=0, center=0, right=0;
    for(const s of stimuli){
      if(s.azimuth_deg < -18) left=Math.max(left,s.strength);
      else if(s.azimuth_deg > 18) right=Math.max(right,s.strength);
      else center=Math.max(center,s.strength);
    }
    return {
      left, center, right,
      salience:Math.max(loom,wallStrength*.35),
      darkOnset:other.lungeTime>0 && dist<2.2 ? .24 : 0,
      stimuli,
      meta:{distance:dist,bearing_deg:az,closing:relClosing,wall_gap:wallGap},
    };
  }

  render() {
    const c=this.ctx,w=this.canvas.width,h=this.canvas.height;
    c.clearRect(0,0,w,h);
    const bg=c.createRadialGradient(w*.5,h*.43,0,w*.5,h*.48,Math.max(w,h)*.7);
    bg.addColorStop(0,'#111923'); bg.addColorStop(1,'#030507');
    c.fillStyle=bg;c.fillRect(0,0,w,h);
    const S=Math.min(w,h)*.052;
    const cx=w*.5,cy=h*.52;

    c.save();
    c.translate(cx,cy);
    c.scale(1,.72);
    c.fillStyle='#0a1016';c.strokeStyle='#243341';c.lineWidth=2;
    c.beginPath();c.arc(0,0,this.worldRadius*S,0,TAU);c.fill();c.stroke();
    c.strokeStyle='rgba(112,150,175,.09)';c.lineWidth=1;
    for(let r=1;r<8;r++){c.beginPath();c.arc(0,0,r*S,0,TAU);c.stroke();}
    for(let a=0;a<TAU;a+=Math.PI/8){c.beginPath();c.moveTo(0,0);c.lineTo(Math.cos(a)*this.worldRadius*S,Math.sin(a)*this.worldRadius*S);c.stroke();}
    c.restore();

    for(let i=0;i<2;i++) this.drawFly(this.fly[i],S,cx,cy);

    c.fillStyle='rgba(225,236,244,.72)';c.font='12px ui-monospace, monospace';
    c.fillText(`ROUND ${this.round}  ·  ${Math.max(0,40-this.roundTime).toFixed(1)}s`,18,28);
    if(this.roundPause>0){
      c.fillStyle='rgba(0,0,0,.52)';c.fillRect(0,0,w,h);
      c.textAlign='center';c.fillStyle='#eef5f8';c.font='600 24px system-ui';
      c.fillText('Resetting arena…',w/2,h/2);c.textAlign='left';
    }
  }

  drawFly(f,S,cx,cy){
    const c=this.ctx;
    const x=cx+f.x*S, y=cy+f.y*S*.72;
    const scale=S*.78;
    c.save();c.translate(x,y);c.rotate(f.angle);c.scale(1,.82);
    const flash=f.flash>0?1:0;
    const body=flash?'#ffd8d8':'#8b6c47';
    const dark='#3c2a1d';
    c.globalAlpha=.38;
    c.fillStyle=f.accent;
    c.beginPath();c.ellipse(-.10*scale,-.42*scale,.55*scale,.25*scale,-.35,0,TAU);c.fill();
    c.beginPath();c.ellipse(-.10*scale,.42*scale,.55*scale,.25*scale,.35,0,TAU);c.fill();
    c.globalAlpha=1;

    const gait=Math.sin(f.legPhase);
    c.strokeStyle='#72543a';c.lineWidth=Math.max(1.2,scale*.055);c.lineCap='round';
    const legYs=[-.42,0,.42];
    for(const side of [-1,1]) for(let k=0;k<3;k++){
      const rootX=(k-1)*.12*scale,rootY=side*(.20+.04*k)*scale;
      const swing=(k%2?1:-1)*gait*.10*scale;
      const midX=(k-.8)*.32*scale+swing, midY=side*.62*scale;
      const endX=(k-.8)*.52*scale-swing*.4,endY=side*(.95-.08*k)*scale;
      c.beginPath();c.moveTo(rootX,rootY);c.lineTo(midX,midY);c.lineTo(endX,endY);c.stroke();
    }

    c.fillStyle=body;c.strokeStyle=dark;c.lineWidth=1;
    c.beginPath();c.ellipse(-.34*scale,0,.46*scale,.27*scale,0,0,TAU);c.fill();c.stroke();
    c.fillStyle='#9a774f';c.beginPath();c.ellipse(.08*scale,0,.31*scale,.29*scale,0,0,TAU);c.fill();c.stroke();
    c.fillStyle='#765233';c.beginPath();c.ellipse(.40*scale,0,.22*scale,.24*scale,0,0,TAU);c.fill();c.stroke();
    c.fillStyle='#311c19';c.beginPath();c.ellipse(.47*scale,-.105*scale,.09*scale,.10*scale,0,0,TAU);c.fill();
    c.beginPath();c.ellipse(.47*scale,.105*scale,.09*scale,.10*scale,0,0,TAU);c.fill();
    c.strokeStyle=f.accent;c.lineWidth=2;c.beginPath();c.moveTo(-.62*scale,-.22*scale);c.lineTo(-.92*scale,-.38*scale);c.stroke();
    c.beginPath();c.moveTo(-.62*scale,.22*scale);c.lineTo(-.92*scale,.38*scale);c.stroke();
    if(f.lungeTime>0){c.strokeStyle=f.accent;c.globalAlpha=.45;c.lineWidth=4;c.beginPath();c.moveTo(-.8*scale,0);c.lineTo(-1.4*scale,0);c.stroke();c.globalAlpha=1;}
    c.restore();

    const bw=82,bh=6;
    c.fillStyle='rgba(0,0,0,.55)';c.fillRect(x-bw/2,y-scale*.98,bw,bh);
    c.fillStyle=f.accent;c.fillRect(x-bw/2,y-scale*.98,bw*clamp(f.stability/100,0,1),bh);
    c.fillStyle='#ecf3f7';c.font='600 11px system-ui';c.textAlign='center';c.fillText(`FLY ${f.id}`,x,y-scale*1.08);c.textAlign='left';
  }
}
