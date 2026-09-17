export const ACTIONS = [
  { name: 'flap' },
  { name: 'coast' },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class FlappyGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.booted = false;
    this.paused = true;
    this.dead = false;
    this.score = 0;
    this.events = [];
    this.lastTime = 0;
    this.lastFlapAt = -Infinity;
    this.frameHandle = 0;

    this.width = 288;
    this.height = 512;
    this.groundY = 456;
    this.birdX = 72;
    this.birdRadius = 12;
    this.gravity = 980;
    this.flapVelocity = -320;
    this.pipeSpeed = 118;
    this.pipeWidth = 52;
    this.pipeGap = 126;
    this.pipeSpacing = 176;
    this.pipeMinCenter = 112;
    this.pipeMaxCenter = 338;

    this.birdY = 240;
    this.birdVY = 0;
    this.pipes = [];
    this.groundOffset = 0;
  }

  async boot() {
    if (this.booted) {
      this.paused = false;
      return;
    }
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.resetWorld();
    this.booted = true;
    this.paused = false;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame((t) => this.loop(t));
  }

  setPaused(value) {
    this.paused = Boolean(value);
    this.lastTime = performance.now();
  }

  act(index) {
    if (this.paused || this.dead || index !== 0) return;
    const now = performance.now();
    if (now - this.lastFlapAt < 70) return;
    this.lastFlapAt = now;
    this.birdVY = this.flapVelocity;
  }

  consumeEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  respawn() {
    this.resetWorld();
  }

  resetWorld() {
    this.dead = false;
    this.score = 0;
    this.birdY = 236;
    this.birdVY = 0;
    this.lastFlapAt = -Infinity;
    this.groundOffset = 0;
    this.events = [];
    this.pipes = [
      this.makePipe(342, 228),
      this.makePipe(342 + this.pipeSpacing, 282),
      this.makePipe(342 + this.pipeSpacing * 2, 194),
    ];
    this.draw();
  }

  makePipe(x, center = null) {
    const gapCenter = center ?? (this.pipeMinCenter + Math.random() * (this.pipeMaxCenter - this.pipeMinCenter));
    return { x, gapCenter, passed: false };
  }

  loop(now) {
    const dt = Math.min(1 / 30, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    if (!this.paused && !this.dead) this.update(dt);
    this.draw();
    this.frameHandle = requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    this.birdVY += this.gravity * dt;
    this.birdVY = clamp(this.birdVY, -420, 620);
    this.birdY += this.birdVY * dt;
    this.groundOffset = (this.groundOffset + this.pipeSpeed * dt) % 24;

    for (const pipe of this.pipes) {
      pipe.x -= this.pipeSpeed * dt;
      if (!pipe.passed && pipe.x + this.pipeWidth < this.birdX - this.birdRadius) {
        pipe.passed = true;
        this.score++;
        this.events.push({ type: 'pipe', score: this.score });
      }
    }

    while (this.pipes.length && this.pipes[0].x + this.pipeWidth < -8) this.pipes.shift();
    while (this.pipes.length < 3) {
      const lastX = this.pipes.length ? this.pipes[this.pipes.length - 1].x : this.width;
      this.pipes.push(this.makePipe(lastX + this.pipeSpacing));
    }

    if (this.collides()) this.kill();
  }

  collides() {
    const r = this.birdRadius;
    if (this.birdY - r <= 0 || this.birdY + r >= this.groundY) return true;

    const bx0 = this.birdX - r + 2;
    const bx1 = this.birdX + r - 2;
    const by0 = this.birdY - r + 2;
    const by1 = this.birdY + r - 2;

    for (const pipe of this.pipes) {
      const px0 = pipe.x;
      const px1 = pipe.x + this.pipeWidth;
      if (bx1 < px0 || bx0 > px1) continue;
      const gapTop = pipe.gapCenter - this.pipeGap / 2;
      const gapBottom = pipe.gapCenter + this.pipeGap / 2;
      if (by0 < gapTop || by1 > gapBottom) return true;
    }
    return false;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.events.push({ type: 'death', score: this.score });
  }

  drawCloud(x, y, scale = 1) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    c.fillStyle = 'rgba(255,255,255,.72)';
    c.beginPath();
    c.arc(0, 4, 16, 0, Math.PI * 2);
    c.arc(18, 0, 20, 0, Math.PI * 2);
    c.arc(38, 7, 14, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  drawPipe(pipe) {
    const c = this.ctx;
    const gapTop = pipe.gapCenter - this.pipeGap / 2;
    const gapBottom = pipe.gapCenter + this.pipeGap / 2;
    const lip = 6;
    const pipeColor = '#5bbb48';
    const pipeDark = '#337b36';
    const pipeLight = '#8ed35e';

    const drawSegment = (x, y, w, h, capAtBottom) => {
      c.fillStyle = pipeDark;
      c.fillRect(x, y, w, h);
      c.fillStyle = pipeColor;
      c.fillRect(x + 4, y, w - 8, h);
      c.fillStyle = pipeLight;
      c.fillRect(x + 8, y, 6, h);
      const capY = capAtBottom ? y + h - 22 : y;
      c.fillStyle = pipeDark;
      c.fillRect(x - lip, capY, w + lip * 2, 22);
      c.fillStyle = pipeColor;
      c.fillRect(x - lip + 4, capY + 3, w + lip * 2 - 8, 16);
      c.fillStyle = pipeLight;
      c.fillRect(x + 3, capY + 3, 6, 16);
    };

    drawSegment(pipe.x, 0, this.pipeWidth, gapTop, true);
    drawSegment(pipe.x, gapBottom, this.pipeWidth, this.groundY - gapBottom, false);
  }

  drawBird() {
    const c = this.ctx;
    const tilt = clamp(this.birdVY / 520, -0.55, 0.9);
    const wingBeat = Math.sin(performance.now() / 65) * 2;
    c.save();
    c.translate(this.birdX, this.birdY);
    c.rotate(tilt);

    c.fillStyle = '#f2c84b';
    c.strokeStyle = '#705427';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(0, 0, 14, 11, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();

    c.fillStyle = '#fff';
    c.beginPath();
    c.ellipse(7, -5, 5, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#4b4334';
    c.stroke();
    c.fillStyle = '#1c2220';
    c.beginPath();
    c.arc(9, -5, 2, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = '#ed8d3d';
    c.beginPath();
    c.moveTo(12, -1);
    c.lineTo(23, 2);
    c.lineTo(12, 5);
    c.closePath();
    c.fill();

    c.fillStyle = '#f8df78';
    c.beginPath();
    c.ellipse(-5, 5 + wingBeat, 8, 5, -0.35, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#705427';
    c.stroke();
    c.restore();
  }

  draw() {
    const c = this.ctx;
    const w = this.width;
    const h = this.height;

    const sky = c.createLinearGradient(0, 0, 0, this.groundY);
    sky.addColorStop(0, '#72c9d7');
    sky.addColorStop(1, '#b7e8df');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);

    this.drawCloud(30, 82, .72);
    this.drawCloud(188, 138, .56);
    this.drawCloud(110, 34, .45);

    c.fillStyle = '#bde6a0';
    c.fillRect(0, this.groundY - 32, w, 32);
    c.fillStyle = '#91cc7b';
    for (let x = -24 - this.groundOffset; x < w + 24; x += 24) {
      c.beginPath();
      c.moveTo(x, this.groundY);
      c.lineTo(x + 24, this.groundY - 32);
      c.lineTo(x + 36, this.groundY - 32);
      c.lineTo(x + 12, this.groundY);
      c.closePath();
      c.fill();
    }

    for (const pipe of this.pipes) this.drawPipe(pipe);
    this.drawBird();

    c.fillStyle = '#e7d58d';
    c.fillRect(0, this.groundY, w, h - this.groundY);
    c.fillStyle = '#a6c66f';
    c.fillRect(0, this.groundY, w, 8);
    c.fillStyle = '#6e9d57';
    for (let x = -this.groundOffset; x < w + 24; x += 24) c.fillRect(x, this.groundY + 10, 12, 3);

    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.font = '700 44px ui-sans-serif, system-ui, sans-serif';
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(0,0,0,.38)';
    c.strokeText(String(this.score), w / 2, 26);
    c.fillStyle = '#fff';
    c.fillText(String(this.score), w / 2, 26);
  }
}
