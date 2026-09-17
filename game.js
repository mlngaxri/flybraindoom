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
    this.flowParticles = [];
    this.events = [];
    this.time = 0;
    this.flowSpeed = 9.2;
    this.impactStrength = 0;
    this.impactSide = 0;
    this.spawnIn = .75;
    this.score = 0;
    this.combo = 0;
    this.hits = 0;
    this.misses = 0;
    this.episodeTime = 0;
    this.episodeEnded = false;
    this.actionIndex = 0;
    this.rearm = 0;
    this.rearmDuration = .72;
    this.swing = {
      left: { active: false, t: 0, duration: .30, hit: false, cooldown: 0, wrongTarget: false },
      right: { active: false, t: 0, duration: .30, hit: false, cooldown: 0, wrongTarget: false },
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
    this.flowParticles = Array.from({ length: 92 }, () => this.makeFlowParticle());
    this.events = [];
    this.time = 0;
    this.impactStrength = 0;
    this.impactSide = 0;
    this.spawnIn = .72 + this.rng() * .68;
    this.score = 0;
    this.combo = 0;
    this.hits = 0;
    this.misses = 0;
    this.episodeTime = 0;
    this.episodeEnded = false;
    this.actionIndex = 0;
    this.rearm = 0;
    for (const hand of ['left', 'right']) {
      const s = this.swing[hand];
      s.active = false;
      s.t = 0;
      s.hit = false;
      s.cooldown = 0;
      s.wrongTarget = false;
    }
    this.render();
  }

  setBodySignal(turn = 0, escape = 0, freeze = 0) {
    this.bodySignal.turn = clamp(turn, -1, 1);
    this.bodySignal.escape = clamp(escape, 0, 1);
    this.bodySignal.freeze = clamp(freeze, 0, 1);
  }

  randomRange(a, b) { return a + (b - a) * this.rng(); }

  makeFlowParticle(z = this.randomRange(6, 32)) {
    const angle = this.randomRange(0, Math.PI * 2);
    const radius = Math.sqrt(this.randomRange(.08, 1)) * this.randomRange(1.2, 4.2);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * .62 + .18,
      z,
      length: this.randomRange(.07, .16),
      alpha: this.randomRange(.18, .48),
    };
  }

  recycleFlowParticle(p) {
    Object.assign(p, this.makeFlowParticle(this.randomRange(24, 36)));
  }

  spawnBlock() {
    const hand = this.rng() < .5 ? 'left' : 'right';
    this.blocks.push({
      id: `${this.seed}-${this.time}-${this.blocks.length}-${Math.floor(this.rng() * 1e9)}`,
      hand,
      color: hand === 'left' ? BLUE : RED,
      // Fruit Fly Lab's current browser model is strongest for motion/looming rather than
      // faithful spectral colour. Keep the two block classes randomly lateralized so
      // the fly can infer the correct hand from real left/right visual activity.
      x: hand === 'left' ? this.randomRange(-.84, -.14) : this.randomRange(.14, .84),
      y: this.randomRange(-.10, .58),
      z: this.randomRange(15.5, 20.0),
      size: this.randomRange(.16, .22),
      speed: this.randomRange(7.0, 10.8),
      vx: this.randomRange(-.20, .20),
      vy: this.randomRange(-.13, .15),
      rot: this.randomRange(-Math.PI, Math.PI),
      spin: this.randomRange(-1.8, 1.8),
      sliced: false,
      missed: false,
    });
  }

  act(index) {
    const next = clamp(index | 0, 0, ACTIONS.length - 1);
    if (next === 0) { this.actionIndex = 0; return true; }
    const accepted = this.beginSwing(next === 1 ? 'left' : 'right');
    if (accepted) this.actionIndex = next;
    return accepted;
  }

  beginSwing(hand) {
    const s = this.swing[hand];
    if (this.rearm > 0 || s.active || s.cooldown > 0) return false;
    s.active = true;
    s.t = 0;
    s.hit = false;
    s.cooldown = .10;
    this.rearm = this.rearmDuration;
    const other = hand === 'left' ? 'right' : 'left';
    s.wrongTarget = this.blocks.some((b) => !b.sliced && !b.missed && b.hand === other && b.z >= 2.35 && b.z <= 4.10);
    return true;
  }

  getActionMask() {
    const ready = this.rearm <= 0 && !this.swing.left.active && !this.swing.right.active;
    return [true, ready, ready];
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
      if (block.z < 2.55 || block.z > 3.35) continue;
      const dx = block.x - point.x;
      const dy = block.y - point.y;
      const dz = (block.z - point.z) * .45;
      const d = Math.hypot(dx, dy, dz);
      if (d < bestDist) { bestDist = d; best = block; }
    }
    if (!best || bestDist > .48) return false;

    best.sliced = true;
    const timing = clamp(1 - Math.abs(best.z - 2.95) / .40, 0, 1);
    const accuracy = clamp(1 - bestDist / .48, 0, 1);
    this.hits++;
    this.combo++;
    const points = Math.round(80 + timing * 70 + Math.min(100, this.combo * 2));
    this.score += points;
    this.events.push({ type: 'hit', hand, timing, accuracy, points, combo: this.combo });
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
    this.rearm = Math.max(0, this.rearm - dt);
    this.impactStrength = Math.max(0, this.impactStrength - dt * 2.7);

    for (const p of this.flowParticles) {
      p.z -= this.flowSpeed * dt;
      if (p.z < 1.15) this.recycleFlowParticle(p);
    }

    if (this.spawnIn <= 0) {
      this.spawnBlock();
      this.spawnIn = this.randomRange(.68, 1.25);
    }

    for (const hand of ['left', 'right']) {
      const s = this.swing[hand];
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (!s.active) continue;
      s.t += dt;
      const p = clamp(s.t / s.duration, 0, 1);
      if (!s.hit && p > .08 && p < .94) s.hit = this.trySlice(hand, p);
      if (p >= 1) {
        if (!s.hit) this.events.push({ type: 'air', hand, wrongTarget: s.wrongTarget });
        s.active = false;
        s.t = 0;
        s.hit = false;
        s.wrongTarget = false;
      }
    }

    for (const block of this.blocks) {
      if (block.sliced || block.missed) continue;
      block.z -= block.speed * dt;
      block.rot += block.spin * dt;
      block.x += block.vx * dt;
      block.y += block.vy * dt;
      const minX = block.hand === 'left' ? -.88 : .12;
      const maxX = block.hand === 'left' ? -.12 : .88;
      if (block.x < minX || block.x > maxX) { block.vx *= -1; block.x = clamp(block.x, minX, maxX); }
      if (block.y < -.14 || block.y > .62) { block.vy *= -1; block.y = clamp(block.y, -.14, .62); }
      if (block.z < 1.75) {
        block.missed = true;
        this.misses++;
        this.combo = 0;
        this.impactStrength = 1;
        this.impactSide = block.hand === 'left' ? -1 : 1;
        this.events.push({ type: 'impact', hand: block.hand, severity: 1 });
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

    if (this.episodeTime >= 90 || this.misses >= 24) {
      this.episodeEnded = true;
      this.events.push({ type: 'episode-end', reason: this.misses >= 24 ? 'miss-limit' : 'time-limit' });
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
    return {
      x: this.width * .5 + x * scale,
      y: this.height * .49 - y * scale,
      scale,
    };
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

  drawFlowField() {
    const c = this.ctx;
    c.save();
    c.lineCap = 'round';
    for (const p of this.flowParticles) {
      const near = this.project(p.x, p.y, p.z);
      const far = this.project(p.x, p.y, p.z + this.flowSpeed * p.length);
      if (!Number.isFinite(near.x + near.y + far.x + far.y)) continue;
      if (near.x < -40 || near.x > this.width + 40 || near.y < -40 || near.y > this.height + 40) continue;
      const proximity = clamp(1 - (p.z - 1.15) / 34, 0, 1);
      c.globalAlpha = p.alpha * (.35 + proximity * .9);
      c.strokeStyle = 'rgba(130,205,255,.85)';
      c.lineWidth = .7 + proximity * 2.1;
      c.beginPath();
      c.moveTo(far.x, far.y);
      c.lineTo(near.x, near.y);
      c.stroke();
    }
    c.restore();
  }

  drawImpactOverlay() {
    if (this.impactStrength <= 0) return;
    const c = this.ctx;
    const s = clamp(this.impactStrength, 0, 1);
    const focusX = this.impactSide < 0 ? this.width * .28 : this.width * .72;
    const sideX = this.impactSide < 0 ? 0 : this.width * .5;
    const g = c.createRadialGradient(focusX, this.height * .48, 20, focusX, this.height * .48, this.width * .62);
    g.addColorStop(0, `rgba(255,86,105,${.12 + s * .18})`);
    g.addColorStop(1, `rgba(255,26,52,${s * .06})`);
    c.save();
    c.fillStyle = g;
    c.fillRect(sideX, 0, this.width * .5, this.height);
    c.globalAlpha = s * .35;
    c.strokeStyle = '#ff596f';
    c.lineWidth = 5;
    c.strokeRect(3, 3, this.width - 6, this.height - 6);
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
    c.beginPath();
    c.moveTo(x-s/2, y-s/2);
    c.lineTo(x-s/2+rx, y-s/2+ry);
    c.lineTo(x+s/2+rx, y-s/2+ry);
    c.lineTo(x+s/2, y-s/2);
    c.closePath(); c.fill();

    c.fillStyle = block.hand === 'left' ? 'rgba(12,68,119,.55)' : 'rgba(117,25,42,.55)';
    c.beginPath();
    c.moveTo(x+s/2, y-s/2);
    c.lineTo(x+s/2+rx, y-s/2+ry);
    c.lineTo(x+s/2+rx, y+s/2+ry);
    c.lineTo(x+s/2, y+s/2);
    c.closePath(); c.fill();

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
      c.save();
      c.globalAlpha = alpha;
      c.fillStyle = f.color;
      c.shadowColor = f.color;
      c.shadowBlur = 8;
      const s = Math.max(2, p.scale * .025);
      c.fillRect(p.x - s/2, p.y - s/2, s, s);
      c.restore();
    }
  }

  saberPose(hand) {
    const s = this.swing[hand];
    const p = s.active ? clamp(s.t / s.duration, 0, 1) : 0;
    const baseX = hand === 'left' ? -.24 : .24;
    const baseY = -.42;
    const baseZ = 2.18;
    if (!s.active) {
      return {
        base: { x: baseX, y: baseY, z: baseZ },
        tip: { x: hand === 'left' ? -.58 : .58, y: .28, z: 2.72 },
      };
    }
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
      c.save();
      c.strokeStyle = '#cfd8de';
      c.lineWidth = Math.max(5, width * .65);
      c.beginPath();
      const hx = lerp(a.x, b.x, .14), hy = lerp(a.y, b.y, .14);
      c.moveTo(a.x, a.y); c.lineTo(hx, hy); c.stroke();
      c.restore();
    }
  }

  drawAvatar() {
    const c = this.ctx;
    const bob = Math.sin(this.time * 2.2) * 5 * (1 - this.bodySignal.freeze * .7);
    const turn = this.bodySignal.turn * .12;
    const cx = this.width * .5 + turn * 45;
    const cy = this.height * .78 + bob - this.bodySignal.escape * 7;
    const s = 76;
    const d = 14;

    c.save();
    c.shadowColor = 'rgba(122,247,210,.32)';
    c.shadowBlur = 20;
    c.fillStyle = '#dfe9e5';
    c.fillRect(cx - s/2, cy - s/2, s, s);
    c.shadowBlur = 0;

    c.fillStyle = '#aab9b3';
    c.beginPath();
    c.moveTo(cx+s/2, cy-s/2);
    c.lineTo(cx+s/2+d, cy-s/2-d*.55);
    c.lineTo(cx+s/2+d, cy+s/2-d*.55);
    c.lineTo(cx+s/2, cy+s/2);
    c.closePath(); c.fill();

    c.fillStyle = '#eef5f2';
    c.beginPath();
    c.moveTo(cx-s/2, cy-s/2);
    c.lineTo(cx-s/2+d, cy-s/2-d*.55);
    c.lineTo(cx+s/2+d, cy-s/2-d*.55);
    c.lineTo(cx+s/2, cy-s/2);
    c.closePath(); c.fill();

    c.fillStyle = '#15222a';
    const eyeY = cy - 8 + this.impactStrength * 2;
    c.beginPath(); c.arc(cx-17, eyeY, 5.5, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(cx+17, eyeY, 5.5, 0, Math.PI*2); c.fill();
    c.strokeStyle = '#15222a';
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    if (this.impactStrength > .08) c.arc(cx, cy+19, 17, 1.18*Math.PI, 1.82*Math.PI);
    else c.arc(cx, cy+4, 20, .18*Math.PI, .82*Math.PI);
    c.stroke();
    c.restore();
  }

  drawHUD() {
    const c = this.ctx;
    c.save();
    c.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.fillStyle = 'rgba(235,244,249,.86)';
    c.fillText(`SCORE ${this.score.toString().padStart(5,'0')}`, 24, 32);
    c.fillText(`COMBO ${this.combo}`, 24, 52);
    c.textAlign = 'right';
    c.fillStyle = BLUE;
    c.fillText('LEFT = BLUE', this.width - 24, 32);
    c.fillStyle = RED;
    c.fillText('RIGHT = RED', this.width - 24, 52);
    c.restore();
  }

  render() {
    this.drawTunnel();
    this.drawFlowField();
    const sorted = [...this.blocks].filter(b => !b.sliced && b.z > .6).sort((a, b) => b.z - a.z);
    for (const block of sorted) this.drawCube(block);
    this.drawFragments();
    this.drawAvatar();
    this.drawSabers();
    this.drawHUD();
    this.drawImpactOverlay();
  }
}
