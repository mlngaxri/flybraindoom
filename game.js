const DOOM_COMMIT = '64de0924591dec59a7d49a7d10467e125b50ea99';
const DOOM_MODULE_BASE = `https://cdn.jsdelivr.net/gh/gabrielbotandev/doom-wasm@${DOOM_COMMIT}/web/public/engine/`;
const DOOM_RAW_BASE = `https://raw.githubusercontent.com/gabrielbotandev/doom-wasm/${DOOM_COMMIT}/web/public/engine/`;

export const ACTIONS = [
  { name: 'forward', keys: ['ArrowUp'] },
  { name: 'left', keys: ['ArrowLeft'] },
  { name: 'right', keys: ['ArrowRight'] },
  { name: 'forward-left', keys: ['ArrowUp', 'ArrowLeft'] },
  { name: 'forward-right', keys: ['ArrowUp', 'ArrowRight'] },
  { name: 'use', keys: ['Space'] },
  { name: 'idle', keys: [] },
];

const codeFor = (key) => ({ ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Space: 32, Enter: 13 }[key] || 0);

export class DoomGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.module = null;
    this.actionIndex = ACTIONS.length - 1;
    this.restartTimers = [];
    this.watchdogTimer = null;
    this.watchdogCanvas = null;
    this.watchdogCtx = null;
    this.watchdogPrev = null;
    this.lastVisualChangeAt = performance.now();
    this.lastAutoRestartAt = -Infinity;
    this.bootedAt = 0;
  }

  async boot() {
    this.canvas.width = 320;
    this.canvas.height = 200;

    const createModule = (await import(`${DOOM_MODULE_BASE}chocolate-doom.js`)).default;
    const module = await createModule({
      canvas: this.canvas,
      keyboardListeningElement: this.canvas,
      locateFile: (path) => {
        if (path === 'chocolate-doom.data' || path === 'chocolate-doom.wasm') return `${DOOM_RAW_BASE}${path}`;
        return `${DOOM_MODULE_BASE}${path}`;
      },
      noInitialRun: true,
      print: () => {},
      printErr: (text) => console.warn('[doom]', text),
    });

    for (const dir of ['/config', '/savegames']) {
      try { module.FS.mkdir(dir); } catch {}
    }

    module.FS.writeFile('/config/default.cfg', [
      'fullscreen 0',
      'window_width 320',
      'window_height 200',
      'grabmouse 0',
      'use_mouse 0',
      'screenblocks 11',
      'show_messages 0',
    ].join('\n') + '\n');
    module.FS.writeFile('/config/chocolate-doom.cfg', [
      'smooth_pixel_scaling 0',
      'force_software_renderer 1',
      'aspect_ratio_correct 1',
      'integer_scaling 0',
    ].join('\n') + '\n');

    // Skill 3 gives the fly a more threatening environment without exposing weapon controls.
    const args = [
      '-window', '-iwad', '/iwads/freedoom2.wad', '-warp', '1', '-skill', '3', '-nomusic',
      '-savedir', '/savegames', '-config', '/config/default.cfg', '-extraconfig', '/config/chocolate-doom.cfg',
    ];

    try { module.callMain(args); }
    catch (error) {
      const text = String(error || '');
      if (!text.includes('unwind') && !text.includes('SimulateInfiniteLoop')) throw error;
    }

    this.module = module;
    this.bootedAt = performance.now();
    this.lastVisualChangeAt = this.bootedAt;
    this.canvas.focus();
    this.startWatchdog();
  }

  dispatch(key, down) {
    const code = codeFor(key);
    const event = new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key, code: key === 'Space' ? 'Space' : key, bubbles: true, cancelable: true,
    });
    Object.defineProperty(event, 'keyCode', { get: () => code });
    Object.defineProperty(event, 'which', { get: () => code });
    this.canvas.dispatchEvent(event);
  }

  releaseAll() {
    for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter']) this.dispatch(key, false);
    this.actionIndex = ACTIONS.length - 1;
  }

  pulse(key, duration = 90) {
    this.dispatch(key, true);
    const timer = setTimeout(() => this.dispatch(key, false), duration);
    this.restartTimers.push(timer);
  }

  act(index) {
    for (const key of ACTIONS[this.actionIndex].keys) this.dispatch(key, false);
    this.actionIndex = index;
    for (const key of ACTIONS[index].keys) this.dispatch(key, true);
  }

  respawn(reason = 'episode-reset') {
    const now = performance.now();
    if (now - this.lastAutoRestartAt < 2200) return;
    this.lastAutoRestartAt = now;
    this.lastVisualChangeAt = now;

    for (const timer of this.restartTimers) clearTimeout(timer);
    this.restartTimers = [];
    this.releaseAll();
    this.canvas.focus();

    // Doom restarts a defeated player via the USE key. Pulse it repeatedly so the
    // command lands after the death animation/state transition rather than only once.
    const sequence = [
      [180, 'Space', 100],
      [650, 'Space', 110],
      [1150, 'Space', 120],
      [1650, 'Enter', 100],
      [2050, 'Space', 120],
    ];
    for (const [delay, key, duration] of sequence) {
      const timer = setTimeout(() => this.pulse(key, duration), delay);
      this.restartTimers.push(timer);
    }

    window.dispatchEvent(new CustomEvent('flydoom:autorespawn', { detail: { reason } }));
  }

  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogCanvas = document.createElement('canvas');
    this.watchdogCanvas.width = 32;
    this.watchdogCanvas.height = 20;
    this.watchdogCtx = this.watchdogCanvas.getContext('2d', { willReadFrequently: true });
    this.watchdogPrev = null;

    this.watchdogTimer = setInterval(() => {
      if (!this.module || !this.watchdogCtx) return;
      const now = performance.now();
      if (now - this.bootedAt < 6000 || now - this.lastAutoRestartAt < 5000) return;

      try {
        const c = this.watchdogCtx;
        c.drawImage(this.canvas, 0, 0, 32, 20);
        const rgba = c.getImageData(0, 0, 32, 20).data;
        const gray = new Uint8Array(32 * 20);
        for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
          gray[p] = Math.round(rgba[i] * .299 + rgba[i + 1] * .587 + rgba[i + 2] * .114);
        }

        if (this.watchdogPrev) {
          let diff = 0;
          for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - this.watchdogPrev[i]) / 255;
          diff /= gray.length;
          if (diff > .006) this.lastVisualChangeAt = now;
        } else {
          this.lastVisualChangeAt = now;
        }
        this.watchdogPrev = gray;

        // If the rendered game has been essentially motionless for several seconds,
        // recover automatically. This catches defeated/dead screens and hard stalls.
        if (now - this.lastVisualChangeAt > 6500) this.respawn('visual-stall');
      } catch (error) {
        console.warn('[doom] restart watchdog disabled for this frame', error);
      }
    }, 500);
  }
}

export class MockGame {
  constructor(canvas) { this.canvas = canvas; this.actionIndex = ACTIONS.length - 1; this.t = 0; }
  async boot() { this.draw(); }
  act(index) { this.actionIndex = index; }
  respawn() { this.t = 0; }
  draw() {
    this.t += 0.08;
    const c = this.canvas.getContext('2d');
    const w = this.canvas.width, h = this.canvas.height;
    c.fillStyle = '#111'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3b4140';
    for (let x = 0; x < w; x += 32) c.fillRect(x + Math.sin(this.t + x) * 8, 25, 10, 130);
    c.fillStyle = '#d7ff8a';
    c.fillRect((Math.sin(this.t * .8) * .4 + .5) * (w - 22), 75, 22, 38);
    requestAnimationFrame(() => this.draw());
  }
}
