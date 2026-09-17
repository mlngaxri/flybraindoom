export const ACTIONS = [
  { name: 'idle' },
  { name: 'left-swing' },
  { name: 'right-swing' },
];

const BLUE = '#43a8ff';
const RED = '#ff4f67';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function freshSeed() {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] || 1;
  } catch {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }
}

function rotate2(x, y, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

export class SaberGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;
    this.focal = this.width * 1.02;
    this.ready = false;
    this.running = false;
    this.seed = freshSeed();
    this.rng = mulberry32(this.seed);
    this.blocks = [];
    this.fragments = [];
    this.events = [];
    this.time = 0;
    this.spawnIn = .75;
    this.score = 0;
    this.combo = 0;
    this.hits = 0;
    this.misses = 0;
    this.episodeTime = 0;
    this.episodeEnded = false;
    this.actionIndex = 0;
    this.swing = {
      left: { active: false, t: 0, duration: .36, hit: false, cooldown: 0 },
      right: { active: false, t: 0, duration: .36, hit: false, cooldown: 0 },
    };
    this.bodySignal = { turn: 0, escape: 0, freeze: 0 };
  }

  async boot() {
    this.ready = true;
    this.running = true;
    this.reset();
  }

  reset(seed = freshSeed()) {
    this.seed = seed >>> 0 || 1;
    this.rng = mulberry32(this.seed);
    this.blocks = [];
    this.fragments = [];
    this.events = [];
    this.time = 0;
    this.spawnIn = .65 + this.rng() * .85;
    this.score = 0;
    this.combo = 0;
    this.hits = 0;
    this.misses = 0;
    this.episodeTime = 0;
    this.episodeEnded = false;
    this.actionIndex = 0;
    for (const hand of ['left', 'right']) {
      const s = this.swing[hand];
      s.active = false;
      s.t = 0;
      s.hit = false;
      s.cooldown = 0;
    }
    this.render();
  }

  setBodySignal(turn = 0, escape = 0, freeze = 0) {
    this.bodySignal.turn = clamp(turn, -1, 1);
    this.bodySignal.escape = clamp(escape, 0, 1);
    this.bodySignal.freeze = clamp(freeze, 0, 1);
  }

  randomRange(a, b) { return a + (b - a) * this.rng(); }

  spawnBlock() {
    const hand = this.rng() < .5 ? 'left' : 'right';
    this.blocks.push({
      id: `${this.seed}-${this.time}-${this.blocks.length}-${Math.floor(this.rng() * 1e9)}`,
      hand,
      color: hand === 'left' ? BLUE : RED,
      // Fruit Fly Lab's current browser model is strongest for motion/looming rather than
      // faithful spectral colour. Keep the two block classes randomly lateralized so
      // the fly can infer the correct hand from real left/right visual activity.
      x: hand === 'left' ? this.randomRange(-.76, -.14) : this.randomRange(.14, .76),
      y: this.randomRange(-.02, .46),
      z: this.randomRange(16.5, 20.5),
      size: this.randomRange(.22, .31),
      speed: this.randomRange(4.8, 7.2),
      rot: this.randomRange(-Math.PI, Math.PI),
      spin: this.randomRange(-1.2, 1.2),
      sliced: false,
      missed: false,
    });
  }

  act(index) {
    this.actionIndex = clamp(index | 0, 0, ACTIONS.length - 1);
    if (this.actionIndex === 1) this.beginSwing('left');
    if (this.actionIndex === 2) this.beginSwing('right');
  }

  beginSwing(hand) {
    const s = this.swing[hand];
    if (s.active || s.cooldown > 0) return;
    s.active = true;
    s.t = 0;
    s.hit = false;
    s.cooldown = .13;
  }

  saberSweepPoint(hand, p) {
    const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    if (hand === 'left') {
      return { x: lerp(-.82, .68, e), y: lerp(-.34, .58, e), z: 2.9 + Math.sin(Math.PI * e) * .18 };
    }
    return { x: lerp(.82, -.68, e), y: lerp(-.34, .58, e), z: 2.9 + Math.sin(Math.PI * e) * .18 };
  }

  trySlice(hand, swingProgress) {
    const point = this.saberSweepPoint(hand, swingProgress);
    let best = null;
    let bestDist = Infinity;
    for (const block of this.blocks) {
      if (block.sliced || block.missed || block.hand !== hand) continue;
      if (block.z < 2.35 || block.z > 3.65) continue;
      const dx = block.x - point.x;
      const dy = block.y - point.y;
      const dz = (block.z - point.z) * .45;
      const d = Math.hypot(dx, dy, dz);
      if (d < bestDist) { bestDist = d; best = block; }
    }
    if (!best || bestDist > .72) return false;

    best.sliced = true;
    const timing = clamp(1 - Math.abs(best.z - 2.95) / .8, 0, 1);
    this.hits++;
    this.combo++;
    const points = Math.round(80 + timing * 70 + Math.min(100, this.combo * 2));
    this.score += points;
    this.events.push({ type: 'hit', hand, timing, points, combo: this.combo });
    this.spawnFragments(best);
    return true;
  }

  spawnFragments(block) {
    for (let i = 0; i < 10; i++) {
      this.fragments.push({
        x: block.x + this.randomRange(-.05, .05),
        y: block.y + this.randomRange(-.05, .05),
        z: block.z,
        vx: this.randomRange(-.9, .9),
        vy: this.randomRange(-.3, 1.1),
        vz: this.randomRange(-.2, .9),
        life: this.randomRange(.35, .72),
        maxLife: .72,
        color: block.color,
      });
    }
  }

  update(dt) {
    if (!this.running || this.episodeEnded) return;
    dt = clamp(dt, 0, .05);
    this.time += dt;
    this.episodeTime += dt;
    this.spawnIn -= dt;

    if (this.spawnIn <= 0) {
      this.spawnBlock();
      this.spawnIn = this.randomRange(.62, 1.65);
    }

    for (const hand of ['left', 'right']) {
      const s = this.swing[hand];
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (!s.active) continue;
      s.t += dt;
      const p = clamp(s.t / s.duration, 0, 1);
      if (!s.hit && p > .08 && p < .94) s.hit = this.trySlice(hand, p);
      if (p >= 1) {
        if (!s.hit) this.events.push({ type: 'air', hand });
        s.active = false;
        s.t = 0;
        s.hit = false;
      }
    }

    for (const block of this.blocks) {
      if (block.sliced || block.missed) continue;
      block.z -= block.speed * dt;
      block.rot += block.spin * dt;
      if (block.z < 1.75) {
        block.missed = true;
        this.misses++;
        this.combo = 0;
        this.events.push({ type: 'miss', hand: block.hand });
      }
    }

    this.blocks = this.blocks.filter((b) => !b.sliced && !b.missed);

    for (const f of this.fragments) {
      f.life -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.vy -= 1.7 * dt;
    }
    this.fragments = this.fragments.filter((f) => f.life > 0 && f.z > .7);

    if (this.episodeTime >= 75 || this.misses >= 18) {
      this.episodeEnded = true;
      this.events.push({ type: 'episode-end', reason: this.misses >= 18 ? 'miss-limit' : 'time-limit' });
    }
  }

  consumeEvents() {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  project(x, y, z) {
    const zz = Math.max(.55, z);
    const scale = this.focal / zz;
    return { x: this.width * .5 + x * scale, y: this.height * .49 - y * scale, scale };
  }

  drawGlowLine(x1, y1, x2, y2, color, width) {
    const c = this.ctx;
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = color;
    c.shadowColor = color;
    c.shadowBlur = width * 2.8;
    c.lineWidth = width;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(255,255,255,.72)';
    c.lineWidth = Math.max(1, width * .22);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.restore();
  }

  drawTunnel() {
    const c = this.ctx, w = this.width, h = this.height;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#050914');
    g.addColorStop(.55, '#07101a');
    g.addColorStop(1, '#020307');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const vx = w * .5, vy = h * .47;
    c.save();
    c.strokeStyle = 'rgba(61,139,198,.15)';
    c.lineWidth = 1;
    for (let i = -7; i <= 7; i++) {
      const x = vx + i * w * .09;
      c.beginPath(); c.moveTo(vx, vy); c.lineTo(x, h); c.stroke();
    }
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const y = vy + Math.pow(t, 2.2) * (h - vy);
      c.globalAlpha = .16 + t * .28;
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    }
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,.035)';
    c.beginPath(); c.moveTo(0, vy); c.lineTo(w, vy); c.stroke();
    c.restore();
  }

  drawCube(block) {
    const c = this.ctx;
    const p = this.project(block.x, block.y, block.z);
    const s = block.size * p.scale;
    if (s < 2) return;
    const depth = Math.max(2, s * .22);
    const [rx, ry] = rotate2(depth, -depth * .58, block.rot * .35);
    const x = p.x, y = p.y;
    c.save();
    c.shadowColor = block.color;
    c.shadowBlur = Math.min(28, 5 + s * .13);
    c.fillStyle = block.hand === 'left' ? 'rgba(30,101,166,.92)' : 'rgba(163,38,61,.92)';
    c.fillRect(x - s/2, y - s/2, s, s);
    c.shadowBlur = 0;
    c.fillStyle = block.hand === 'left' ? 'rgba(67,168,255,.38)' : 'rgba(255,79,103,.38)';
    c.beginPath(); c.moveTo(x-s/2,y-s/2); c.lineTo(x-s/2+rx,y-s/2+ry); c.lineTo(x+s/2+rx,y-s/2+ry); c.lineTo(x+s/2,y-s/2); c.closePath(); c.fill();
    c.fillStyle = block.hand === 'left' ? 'rgba(12,68,119,.55)' : 'rgba(117,25,42,.55)';
    c.beginPath(); c.moveTo(x+s/2,y-s/2); c.lineTo(x+s/2+rx,y-s/2+ry); c.lineTo(x+s/2+rx,y+s/2+ry); c.lineTo(x+s/2,y+s/2); c.closePath(); c.fill();
    c.strokeStyle = block.color;
    c.lineWidth = Math.max(1.5, s * .035);
    c.strokeRect(x - s/2, y - s/2, s, s);
    c.fillStyle = 'rgba(255,255,255,.78)';
    c.beginPath(); c.arc(x, y, Math.max(2, s * .055), 0, Math.PI * 2); c.fill();
    c.restore();
  }

  drawFragments() {
    const c = this.ctx;
    for (const f of this.fragments) {
      const p = this.project(f.x, f.y, f.z);
      const alpha = clamp(f.life / f.maxLife, 0, 1);
      c.save(); c.globalAlpha = alpha; c.fillStyle = f.color; c.shadowColor = f.color; c.shadowBlur = 8;
      const s = Math.max(2, p.scale * .025);
      c.fillRect(p.x - s/2, p.y - s/2, s, s); c.restore();
    }
  }

  saberPose(hand) {
    const s = this.swing[hand];
    const p = s.active ? clamp(s.t / s.duration, 0, 1) : 0;
    const baseX = hand === 'left' ? -.24 : .24;
    const baseY = -.42;
    const baseZ = 2.18;
    if (!s.active) return { base: { x: baseX, y: baseY, z: baseZ }, tip: { x: hand === 'left' ? -.58 : .58, y: .28, z: 2.72 } };
    const q = this.saberSweepPoint(hand, p);
    return { base: { x: baseX, y: baseY, z: baseZ }, tip: { x: q.x, y: q.y, z: q.z } };
  }

  drawSabers() {
    for (const hand of ['left', 'right']) {
      const pose = this.saberPose(hand);
      const a = this.project(pose.base.x, pose.base.y, pose.base.z);
      const b = this.project(pose.tip.x, pose.tip.y, pose.tip.z);
      const color = hand === 'left' ? BLUE : RED;
      const width = Math.max(5, 11 * (2.8 / pose.base.z));
      this.drawGlowLine(a.x, a.y, b.x, b.y, color, width);
      const c = this.ctx;
      c.save(); c.strokeStyle = '#cfd8de'; c.lineWidth = Math.max(5, width * .65); c.beginPath();
      const hx = lerp(a.x, b.x, .14), hy = lerp(a.y, b.y, .14);
      c.moveTo(a.x, a.y); c.lineTo(hx, hy); c.stroke(); c.restore();
    }
  }

  drawAvatar() {
    const c = this.ctx;
    const bob = Math.sin(this.time * 2.2) * 5 * (1 - this.bodySignal.freeze * .7);
    const turn = this.bodySignal.turn * .12;
    const cx = this.width * .5 + turn * 45;
    const cy = this.height * .78 + bob - this.bodySignal.escape * 7;
    const s = 76, d = 14;
    c.save(); c.shadowColor = 'rgba(122,247,210,.32)'; c.shadowBlur = 20; c.fillStyle = '#dfe9e5'; c.fillRect(cx-s/2,cy-s/2,s,s); c.shadowBlur = 0;
    c.fillStyle = '#aab9b3'; c.beginPath(); c.moveTo(cx+s/2,cy-s/2); c.lineTo(cx+s/2+d,cy-s/2-d*.55); c.lineTo(cx+s/2+d,cy+s/2-d*.55); c.lineTo(cx+s/2,cy+s/2); c.closePath(); c.fill();
    c.fillStyle = '#eef5f2'; c.beginPath(); c.moveTo(cx-s/2,cy-s/2); c.lineTo(cx-s/2+d,cy-s/2-d*.55); c.lineTo(cx+s/2+d,cy-s/2-d*.55); c.lineTo(cx+s/2,cy-s/2); c.closePath(); c.fill();
    c.fillStyle = '#15222a'; c.beginPath(); c.arc(cx-17,cy-8,5.5,0,Math.PI*2); c.fill(); c.beginPath(); c.arc(cx+17,cy-8,5.5,0,Math.PI*2); c.fill();
    c.strokeStyle = '#15222a'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.arc(cx,cy+4,20,.18*Math.PI,.82*Math.PI); c.stroke(); c.restore();
  }

  drawHUD() {
    const c = this.ctx;
    c.save(); c.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace'; c.fillStyle = 'rgba(235,244,249,.86)';
    c.fillText(`SCORE ${this.score.toString().padStart(5,'0')}`,24,32); c.fillText(`COMBO ${this.combo}`,24,52);
    c.textAlign = 'right'; c.fillStyle = BLUE; c.fillText('LEFT = BLUE',this.width-24,32); c.fillStyle = RED; c.fillText('RIGHT = RED',this.width-24,52); c.restore();
  }

  render() {
    this.drawTunnel();
    const sorted = [...this.blocks].filter(b => !b.sliced && b.z > .6).sort((a,b) => b.z-a.z);
    for (const block of sorted) this.drawCube(block);
    this.drawFragments();
    this.drawAvatar();
    this.drawSabers();
    this.drawHUD();
  }
}
