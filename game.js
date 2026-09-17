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
  }

  async boot() {
    // Chocolate Doom renders a 320x200 framebuffer. Keep the backing store fixed
    // and let CSS correct the historical non-square pixels to a 4:3 display.
    this.canvas.width = 320;
    this.canvas.height = 200;

    const createModule = (await import(`${DOOM_MODULE_BASE}chocolate-doom.js`)).default;
    const module = await createModule({
      canvas: this.canvas,
      keyboardListeningElement: this.canvas,
      locateFile: (path) => {
        if (path === 'chocolate-doom.data' || path === 'chocolate-doom.wasm') {
          return `${DOOM_RAW_BASE}${path}`;
        }
        return `${DOOM_MODULE_BASE}${path}`;
      },
      noInitialRun: true,
      print: () => {},
      printErr: (text) => console.warn('[doom]', text),
    });

    for (const dir of ['/config', '/savegames']) {
      try { module.FS.mkdir(dir); } catch {}
    }

    // screenblocks 11 removes Doom's decorative tiled border and status bar.
    // That matters here because the fly's camera should contain scene pixels,
    // not a large static UI texture that can dominate the sensory encoder.
    module.FS.writeFile('/config/default.cfg', [
      'fullscreen 0',
      'window_width 320',
      'window_height 200',
      'grabmouse 0',
      'use_mouse 0',
      'screenblocks 11',
      'show_messages 0',
    ].join('\n') + '\n');
    module.FS.writeFile('/config/chocolate-doom.cfg', 'smooth_pixel_scaling 0\nforce_software_renderer 1\n');

    const args = [
      '-window', '-iwad', '/iwads/freedoom2.wad', '-warp', '1', '-skill', '2', '-nomusic',
      '-savedir', '/savegames', '-config', '/config/default.cfg', '-extraconfig', '/config/chocolate-doom.cfg',
    ];

    try { module.callMain(args); }
    catch (error) {
      const text = String(error || '');
      if (!text.includes('unwind') && !text.includes('SimulateInfiniteLoop')) throw error;
    }

    this.module = module;
    this.canvas.focus();
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

  act(index) {
    for (const key of ACTIONS[this.actionIndex].keys) this.dispatch(key, false);
    this.actionIndex = index;
    for (const key of ACTIONS[index].keys) this.dispatch(key, true);
  }

  respawn() {
    for (const key of ['Space', 'Enter']) {
      this.dispatch(key, true);
      setTimeout(() => this.dispatch(key, false), 45);
    }
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
