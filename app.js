import { ACTIONS, FlappyGame } from './game.js';
import { LinearQLearner, neuralActionPrior, neuralFeatures } from './policy.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const AUTO = params.get('autostart') === '1';
const EXPERIMENT_KEY = 'flybraindoom.experiment.v5';
const LEGACY_EXPERIMENT_KEYS = ['flybraindoom.experiment.v4', 'flybraindoom.experiment.v3'];
const GRID_COLS = 6;
const GRID_ROWS = 10;
const H_FOV_DEG = 100;
const V_FOV_DEG = 100;
const $ = (s) => document.querySelector(s);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const gameCanvas = $('#game-canvas');
const gameWrap = gameCanvas.closest('.game-wrap');
const featureCanvas = $('#feature-canvas');
featureCanvas.width = 72;
featureCanvas.height = 128;
const retinaCanvas = $('#retina-canvas');
retinaCanvas.width = 360;
retinaCanvas.height = 600;
const brainCanvas = $('#brain-canvas');
const rewardCanvas = $('#reward-canvas');

const featureCtx = featureCanvas.getContext('2d', { willReadFrequently: true });
const retinaCtx = retinaCanvas.getContext('2d');
const brainCtx = brainCanvas.getContext('2d');
const rewardCtx = rewardCanvas.getContext('2d');
featureCtx.imageSmoothingEnabled = true;
retinaCtx.imageSmoothingEnabled = true;

const ui = {
  start: $('#start-button'), pause: $('#pause-button'), overlay: $('#game-overlay'),
  fullscreen: $('#fullscreen-button'), fullscreenExit: $('#fullscreen-exit'),
  brainStatus: $('#brain-status'), gameStatus: $('#game-status'), episode: $('#episode'),
  reward: $('#reward'), bestReward: $('#best-reward'), score: $('#score'), bestScore: $('#best-score'),
  action: $('#action-label'), active: $('#active-neurons'), mean: $('#mean-rate'),
  turn: $('#turn-bias'), escape: $('#escape-drive'), freeze: $('#freeze-drive'), sim: $('#sim-time'),
  ml: $('#motion-left'), mc: $('#motion-center'), mr: $('#motion-right'), novelty: $('#visual-change'),
  vision: $('#vision-summary'), step: $('#step-reward'), epsilon: $('#epsilon'), updates: $('#updates'),
  terminal: $('#terminal-state'), reset: $('#reset-learning'),
  bars: { flap: $('#bar-flap'), coast: $('#bar-coast') },
};

const state = {
  game: new FlappyGame(gameCanvas),
  running: false,
  gameReady: false,
  brainReady: false,
  brainFrame: {},
  brainPositions: null,
  brainCount: 0,
  previousPixels: null,
  adaptation: null,
  previousFeatures: null,
  vision: { left: 0, center: 0, right: 0, motion: 0, brightness: 0, stimuli: [], cells: [] },
  episode: 0,
  episodeReward: 0,
  bestReward: 0,
  bestScore: 0,
  actionIndex: 1,
  actionUntil: 0,
  lastControlAt: 0,
  rewards: [],
  episodeScores: [],
  raf: 0,
  restored: false,
};

const learner = new LinearQLearner(14, ACTIONS.length);
let brain = null;

const setStatus = (el, text, tone = '') => {
  el.textContent = text;
  el.className = `status${tone ? ` status-${tone}` : ''}`;
};

function restoreExperiment() {
  try {
    let saved = JSON.parse(localStorage.getItem(EXPERIMENT_KEY) || 'null');
    if (!saved) {
      for (const key of LEGACY_EXPERIMENT_KEYS) {
        saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (saved) break;
      }
    }
    if (!saved) return;
    state.episode = Number.isFinite(saved.episode) ? Math.max(0, saved.episode | 0) : 0;
    state.bestReward = Number.isFinite(saved.bestReward) ? saved.bestReward : 0;
    state.bestScore = Number.isFinite(saved.bestScore) ? Math.max(0, saved.bestScore | 0) : 0;
    state.rewards = Array.isArray(saved.rewards) ? saved.rewards.filter(Number.isFinite).slice(-600) : [];
    state.episodeScores = Array.isArray(saved.episodeScores) ? saved.episodeScores.filter(Number.isFinite).slice(-200) : [];
    state.restored = true;
  } catch {}
}

function persistExperiment() {
  learner.persist();
  try {
    localStorage.setItem(EXPERIMENT_KEY, JSON.stringify({
      version: 5,
      episode: state.episode,
      bestReward: state.bestReward,
      bestScore: state.bestScore,
      rewards: state.rewards.slice(-600),
      episodeScores: state.episodeScores.slice(-200),
      savedAt: Date.now(),
    }));
  } catch {}
}

restoreExperiment();
ui.episode.textContent = state.episode.toLocaleString();
ui.bestReward.textContent = state.bestReward.toFixed(2);
ui.bestScore.textContent = String(state.bestScore);
ui.epsilon.textContent = learner.epsilon.toFixed(3);
ui.updates.textContent = learner.updates.toLocaleString();

async function enterFullscreen() {
  try {
    if (document.fullscreenElement === gameWrap) return;
    if (gameWrap.requestFullscreen) await gameWrap.requestFullscreen({ navigationUI: 'hide' });
    else if (gameWrap.webkitRequestFullscreen) gameWrap.webkitRequestFullscreen();
  } catch (error) {
    console.warn('fullscreen request failed', error);
  }
}

async function exitFullscreen() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (error) {
    console.warn('fullscreen exit failed', error);
  }
}

function setupBrain() {
  if (TEST) {
    state.brainCount = 4000;
    const pos = new Float32Array(state.brainCount * 3);
    for (let i = 0; i < state.brainCount; i++) {
      pos[i * 3] = Math.sin(i * .17) * 80 + Math.sin(i * .013) * 25;
      pos[i * 3 + 1] = Math.cos(i * .11) * 55 + Math.cos(i * .021) * 18;
      pos[i * 3 + 2] = Math.sin(i * .07) * 20;
    }
    state.brainPositions = pos;
    state.brainReady = true;
    setStatus(ui.brainStatus, 'mock brain ready', 'ok');
    return;
  }

  brain = new Worker('./brain-worker.js', { type: 'module' });
  brain.onmessage = ({ data: msg }) => {
    if (msg.type === 'status') setStatus(ui.brainStatus, msg.message, 'warn');
    if (msg.type === 'progress') {
      const pct = msg.total ? ` ${Math.min(100, Math.round(msg.loaded / msg.total * 100))}%` : '';
      setStatus(ui.brainStatus, `${msg.label}${pct}`, 'warn');
    }
    if (msg.type === 'ready') {
      state.brainReady = true;
      state.brainCount = msg.n;
      state.brainPositions = msg.positions;
      setStatus(ui.brainStatus, `${msg.n.toLocaleString()} neurons ready`, 'ok');
      if (state.running) brain.postMessage({ cmd: 'play' });
    }
    if (msg.type === 'frame') {
      state.brainFrame = msg.frame;
      updateBrainUI();
    }
    if (msg.type === 'error') {
      setStatus(ui.brainStatus, 'brain error', 'error');
      console.error(msg.message);
    }
  };
  brain.postMessage({ cmd: 'boot' });
}
setupBrain();

function fakeBrain(now) {
  const t = now / 1000;
  const high = state.vision.cells.length
    ? state.vision.cells.slice(0, Math.ceil(state.vision.cells.length / 2)).reduce((s, c) => s + c.drive, 0) / Math.ceil(state.vision.cells.length / 2)
    : 0;
  const low = state.vision.cells.length
    ? state.vision.cells.slice(Math.floor(state.vision.cells.length / 2)).reduce((s, c) => s + c.drive, 0) / Math.ceil(state.vision.cells.length / 2)
    : 0;
  state.brainFrame = {
    t_ms: now,
    active_neurons: 650 + Math.round(state.vision.motion * 5000),
    mean_rate_hz: 2 + state.vision.motion * 24,
    channels: {
      turn_bias: clamp((low - high) * 2, -1, 1),
      escape_takeoff: clamp(high * 1.8, 0, 1),
      escape_long_mode: clamp(state.vision.motion * .8, 0, 1),
      stop_freeze: clamp(.06 - state.vision.motion * .03, 0, 1),
      backward_walk: 0,
    },
    dn_rates: { DN_left: 18 + high * 80, DN_right: 18 + low * 80, DN_escape: state.vision.motion * 120 },
    proboscis_drive: 0,
    active_idx: Array.from({ length: 700 }, (_, i) => (i * 37 + Math.floor(t * 50)) % state.brainCount),
  };
  updateBrainUI();
}

function renderFlyView(cells, stimuli, motion) {
  const w = retinaCanvas.width;
  const h = retinaCanvas.height;
  retinaCtx.fillStyle = '#020403';
  retinaCtx.fillRect(0, 0, w, h);

  const cellW = w / GRID_COLS;
  const cellH = h / GRID_ROWS;
  for (const cell of cells) {
    const cx = (cell.gx + .5) * cellW;
    const cy = (cell.gy + .5) * cellH;
    const base = Math.round(clamp(cell.adapted * 255, 0, 255));
    const drive = clamp(cell.drive, 0, 1);
    const radius = Math.min(cellW, cellH) * .32;
    retinaCtx.beginPath();
    retinaCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    retinaCtx.fillStyle = `rgb(${Math.round(base * .34)}, ${Math.round(base * .42 + drive * 150)}, ${Math.round(base * .34)})`;
    retinaCtx.fill();
    retinaCtx.strokeStyle = 'rgba(220,255,230,.10)';
    retinaCtx.stroke();
  }

  for (const s of stimuli) {
    const x = (s.azimuth_deg / H_FOV_DEG + .5) * w;
    const y = (.5 - s.elevation_deg / V_FOV_DEG) * h;
    const r = 5 + s.strength * 15;
    retinaCtx.beginPath();
    retinaCtx.arc(x, y, r, 0, Math.PI * 2);
    retinaCtx.strokeStyle = `rgba(215,255,138,${.28 + s.strength * .68})`;
    retinaCtx.lineWidth = 2 + s.strength * 3;
    retinaCtx.stroke();
  }

  retinaCtx.fillStyle = 'rgba(220,230,226,.72)';
  retinaCtx.font = '16px ui-monospace, monospace';
  retinaCtx.fillText(`visual motion ${motion.toFixed(3)}`, 12, h - 16);
}

function sampleVision() {
  if (!state.gameReady) return;
  try {
    const w = featureCanvas.width;
    const h = featureCanvas.height;
    featureCtx.drawImage(gameCanvas, 0, 0, gameCanvas.width, gameCanvas.height, 0, 0, w, h);
    const data = featureCtx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    if (!state.adaptation || state.adaptation.length !== gray.length) state.adaptation = new Float32Array(gray.length);

    let brightness = 0;
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      const g = Math.round(data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114);
      gray[p] = g;
      brightness += g / 255;
      if (!state.previousPixels) state.adaptation[p] = g / 255;
    }
    brightness /= gray.length;

    const sums = new Float64Array(GRID_COLS * GRID_ROWS);
    const adaptedSums = new Float64Array(GRID_COLS * GRID_ROWS);
    const counts = new Uint32Array(GRID_COLS * GRID_ROWS);
    let left = 0, center = 0, right = 0, motion = 0;
    let lcount = 0, ccount = 0, rcount = 0;
    const cells = [];
    let stimuli = [];

    if (state.previousPixels) {
      for (let y = 0; y < h; y++) {
        const gy = Math.min(GRID_ROWS - 1, Math.floor(y * GRID_ROWS / h));
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          const current = gray[p] / 255;
          const frameMotion = Math.abs(gray[p] - state.previousPixels[p]) / 255;
          const temporalContrast = Math.abs(current - state.adaptation[p]);
          const residual = frameMotion * .82 + temporalContrast * .18;
          state.adaptation[p] += (current - state.adaptation[p]) * .06;

          const gx = Math.min(GRID_COLS - 1, Math.floor(x * GRID_COLS / w));
          const gi = gy * GRID_COLS + gx;
          sums[gi] += residual;
          adaptedSums[gi] += current;
          counts[gi]++;
          motion += residual;

          if (x < w / 3) { left += residual; lcount++; }
          else if (x < w * 2 / 3) { center += residual; ccount++; }
          else { right += residual; rcount++; }
        }
      }

      left /= Math.max(1, lcount);
      center /= Math.max(1, ccount);
      right /= Math.max(1, rcount);
      motion /= gray.length;

      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) {
          const gi = gy * GRID_COLS + gx;
          const local = sums[gi] / Math.max(1, counts[gi]);
          const adapted = adaptedSums[gi] / Math.max(1, counts[gi]);
          const drive = clamp((local - .0045) * 9.5, 0, 1);
          cells.push({ gx, gy, adapted, drive });
          if (drive < .035) continue;
          stimuli.push({
            azimuth_deg: ((gx + .5) / GRID_COLS - .5) * H_FOV_DEG,
            elevation_deg: (.5 - (gy + .5) / GRID_ROWS) * V_FOV_DEG,
            strength: drive,
          });
        }
      }
      stimuli.sort((a, b) => b.strength - a.strength);
      stimuli = stimuli.slice(0, 12);
    } else {
      for (let p = 0; p < gray.length; p++) state.adaptation[p] = gray[p] / 255;
      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) cells.push({ gx, gy, adapted: .08, drive: 0 });
      }
    }

    state.previousPixels = gray;
    state.vision = { left, center, right, motion, brightness, stimuli, cells };
    renderFlyView(cells, stimuli, motion);
    ui.ml.textContent = left.toFixed(3);
    ui.mc.textContent = center.toFixed(3);
    ui.mr.textContent = right.toFixed(3);
    ui.novelty.textContent = motion.toFixed(3);
    ui.vision.textContent = `full-frame drive · ${stimuli.length} active receptive fields`;

    if (brain && state.brainReady) brain.postMessage({ cmd: 'vision', vision: state.vision });
  } catch (error) {
    console.error('vision sample failed', error);
  }
}

function reinforcementFromEvents(events) {
  let reward = 0.004;
  let terminal = null;
  let passed = false;

  for (const event of events) {
    if (event.type === 'pipe') {
      passed = true;
      reward += 12;
      if (event.score > state.bestScore) {
        state.bestScore = event.score;
        ui.bestScore.textContent = String(state.bestScore);
        reward += 6;
      }
    }
    if (event.type === 'death') {
      reward -= 30;
      terminal = 'collision';
    }
  }

  return { reward, terminal, passed };
}

function resetEpisode(kind) {
  ui.terminal.textContent = kind;
  state.bestReward = Math.max(state.bestReward, state.episodeReward);
  ui.bestReward.textContent = state.bestReward.toFixed(2);
  state.episodeScores.push(state.game.score);
  if (state.episodeScores.length > 200) state.episodeScores.shift();
  state.episode++;
  state.episodeReward = 0;
  state.previousPixels = null;
  state.adaptation = null;
  state.previousFeatures = null;
  state.actionIndex = 1;
  state.actionUntil = 0;
  state.game.respawn();
  ui.episode.textContent = state.episode.toLocaleString();
  ui.score.textContent = '0';
  ui.reward.textContent = '0.00';
  if (brain) brain.postMessage({ cmd: 'reset', seed: state.episode * 17 });
  persistExperiment();
  setTimeout(() => { ui.terminal.textContent = 'none'; }, 900);
}

function setAction(index) {
  state.actionIndex = index;
  state.game.act(index);
  const name = ACTIONS[index].name;
  ui.action.textContent = name;
  ui.bars.flap.style.width = name === 'flap' ? '100%' : '0%';
  ui.bars.coast.style.width = name === 'coast' ? '100%' : '0%';
}

function control(now) {
  sampleVision();
  if (TEST) fakeBrain(now);
  if (!TEST && (!state.brainReady || !Number.isFinite(state.brainFrame.t_ms) || state.brainFrame.t_ms <= 0)) return;

  const x = neuralFeatures(state.brainFrame);
  const events = state.game.consumeEvents();
  const outcome = reinforcementFromEvents(events);
  const r = outcome.reward;
  const end = outcome.terminal;

  if (state.previousFeatures) learner.update(state.previousFeatures, state.actionIndex, r, x, Boolean(end));
  state.previousFeatures = x;
  state.episodeReward += r;
  state.rewards.push(r);
  if (state.rewards.length > 2400) state.rewards.splice(0, 600);

  ui.score.textContent = String(state.game.score);
  ui.step.textContent = r.toFixed(3);
  ui.reward.textContent = state.episodeReward.toFixed(2);
  ui.epsilon.textContent = learner.epsilon.toFixed(3);
  ui.updates.textContent = learner.updates.toLocaleString();

  if (end) return resetEpisode(end);
  if (now >= state.actionUntil) {
    const prior = neuralActionPrior(state.brainFrame, ACTIONS.length);
    setAction(learner.choose(x, prior));
    state.actionUntil = now + 90 + Math.random() * 70;
  }
}

function updateBrainUI() {
  const f = state.brainFrame, ch = f.channels || {};
  ui.active.textContent = Number(f.active_neurons || 0).toLocaleString();
  ui.mean.textContent = `${Number(f.mean_rate_hz || 0).toFixed(2)} Hz`;
  ui.turn.textContent = Number(ch.turn_bias || 0).toFixed(3);
  ui.escape.textContent = Math.max(Number(ch.escape_takeoff || 0), Number(ch.escape_long_mode || 0)).toFixed(3);
  ui.freeze.textContent = Number(ch.stop_freeze || 0).toFixed(3);
  ui.sim.textContent = `${Math.round(f.t_ms || 0)} ms`;
}

function drawBrain() {
  const c = brainCtx, w = brainCanvas.width, h = brainCanvas.height;
  c.fillStyle = '#080b0a';
  c.fillRect(0, 0, w, h);
  if (!state.brainPositions || !state.brainFrame.active_idx) {
    c.fillStyle = '#697570';
    c.font = '12px monospace';
    c.fillText('loading connectome…', 18, 28);
    return;
  }

  const p = state.brainPositions, n = state.brainCount;
  const stride = Math.max(1, Math.floor(n / 4500));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i += stride) {
    const x = p[i * 3], y = p[i * 3 + 1];
    if (!Number.isFinite(x + y)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const scale = Math.min((w - 40) / Math.max(1, maxX - minX), (h - 40) / Math.max(1, maxY - minY));
  const xy = (i) => [20 + (p[i * 3] - minX) * scale, 20 + (p[i * 3 + 1] - minY) * scale];
  c.fillStyle = 'rgba(158,171,166,.12)';
  for (let i = 0; i < n; i += stride) {
    const [x, y] = xy(i);
    c.fillRect(x, y, 1, 1);
  }
  c.fillStyle = '#d7ff8a';
  for (const i of state.brainFrame.active_idx) {
    if (i >= n) continue;
    const [x, y] = xy(i);
    c.fillRect(x - 1, y - 1, 2.5, 2.5);
  }
}

function drawReward() {
  const c = rewardCtx, w = rewardCanvas.width, h = rewardCanvas.height;
  c.fillStyle = '#090c0b';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#1f2825';
  c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
  const v = state.rewards.slice(-260);
  if (v.length < 2) return;
  let lo = Math.min(-30, ...v), hi = Math.max(18, ...v);
  if (hi - lo < 1e-6) hi = lo + 1;
  c.strokeStyle = '#d7ff8a';
  c.lineWidth = 1.5;
  c.beginPath();
  v.forEach((r, i) => {
    const x = i / (v.length - 1) * w;
    const y = h - (r - lo) / (hi - lo) * h;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.stroke();
}

function loop(now) {
  if (!state.running) return;
  if (state.gameReady && now - state.lastControlAt > 100) {
    state.lastControlAt = now;
    control(now);
  }
  drawBrain();
  drawReward();
  state.raf = requestAnimationFrame(loop);
}

async function start() {
  if (state.running) return;
  ui.start.disabled = true;
  setStatus(ui.gameStatus, 'starting', 'warn');
  try {
    await state.game.boot();
    state.gameReady = true;
    state.game.setPaused(false);
    state.running = true;
    state.episode = state.episode > 0 ? state.episode + 1 : 1;
    state.episodeReward = 0;
    state.previousPixels = null;
    state.adaptation = null;
    state.previousFeatures = null;
    state.actionIndex = 1;
    state.actionUntil = 0;
    state.lastControlAt = performance.now();
    ui.episode.textContent = state.episode.toLocaleString();
    ui.score.textContent = '0';
    ui.reward.textContent = '0.00';
    ui.overlay.hidden = true;
    setStatus(ui.gameStatus, TEST ? 'mock brain running' : (state.restored ? 'running · history restored' : 'running'), 'ok');
    ui.pause.disabled = false;
    if (brain && state.brainReady) brain.postMessage({ cmd: 'play' });
    persistExperiment();
    state.raf = requestAnimationFrame(loop);
  } catch (error) {
    setStatus(ui.gameStatus, 'start failed', 'error');
    ui.start.disabled = false;
    console.error(error);
  }
}

ui.start.addEventListener('click', start);
ui.fullscreen.addEventListener('click', enterFullscreen);
ui.fullscreenExit.addEventListener('click', exitFullscreen);
gameCanvas.addEventListener('dblclick', enterFullscreen);
document.addEventListener('fullscreenchange', () => {
  ui.fullscreen.textContent = document.fullscreenElement === gameWrap ? 'Fullscreen active' : 'Fullscreen game';
});

ui.pause.addEventListener('click', () => {
  state.running = !state.running;
  ui.pause.textContent = state.running ? 'Pause' : 'Resume';
  state.game.setPaused(!state.running);
  if (brain) brain.postMessage({ cmd: state.running ? 'play' : 'pause' });
  if (state.running) {
    state.lastControlAt = performance.now();
    state.raf = requestAnimationFrame(loop);
  } else {
    cancelAnimationFrame(state.raf);
    persistExperiment();
  }
});

ui.reset.addEventListener('click', () => {
  learner.reset();
  state.bestReward = 0;
  state.bestScore = 0;
  state.episode = 0;
  state.rewards = [];
  state.episodeScores = [];
  ui.bestReward.textContent = '0.00';
  ui.bestScore.textContent = '0';
  ui.episode.textContent = '0';
  ui.epsilon.textContent = learner.epsilon.toFixed(3);
  ui.updates.textContent = '0';
  try {
    localStorage.removeItem(EXPERIMENT_KEY);
    for (const key of LEGACY_EXPERIMENT_KEYS) localStorage.removeItem(key);
  } catch {}
  drawReward();
});

window.addEventListener('pagehide', persistExperiment);
window.addEventListener('beforeunload', persistExperiment);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistExperiment();
});
setInterval(() => { if (state.running) persistExperiment(); }, 4000);

setStatus(ui.gameStatus, TEST ? 'test mode' : (state.restored ? 'saved history ready' : 'game idle'));
drawBrain();
drawReward();
if (AUTO) setTimeout(() => ui.start.click(), 50);
