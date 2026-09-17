import { ACTIONS, DoomGame, MockGame } from './game.js';
import { LinearQLearner, neuralActionPrior, neuralFeatures } from './policy.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const AUTO = params.get('autostart') === '1';
const EXPERIMENT_KEY = 'flybraindoom.experiment.v4';
const LEGACY_EXPERIMENT_KEY = 'flybraindoom.experiment.v3';
const GRID_COLS = 8;
const GRID_ROWS = 4;
const H_FOV_DEG = 90;
const V_FOV_DEG = 60;
const $ = (s) => document.querySelector(s);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const engineCanvas = $('#doom-canvas');
const gameWrap = engineCanvas.closest('.game-wrap');
const gameViewCanvas = document.createElement('canvas');
gameViewCanvas.id = 'game-view-canvas';
gameViewCanvas.width = 960;
gameViewCanvas.height = 720;
gameViewCanvas.setAttribute('aria-label', 'Centered full Freedoom game view');
gameWrap.insertBefore(gameViewCanvas, engineCanvas);
engineCanvas.classList.add('engine-canvas');
engineCanvas.setAttribute('aria-hidden', 'true');
engineCanvas.tabIndex = -1;

const featureCanvas = $('#feature-canvas');
featureCanvas.width = 64;
featureCanvas.height = 48;
const retinaCanvas = $('#retina-canvas');
retinaCanvas.width = 720;
retinaCanvas.height = 480;
const brainCanvas = $('#brain-canvas');
const rewardCanvas = $('#reward-canvas');

const gameViewCtx = gameViewCanvas.getContext('2d');
const featureCtx = featureCanvas.getContext('2d', { willReadFrequently: true });
const retinaCtx = retinaCanvas.getContext('2d');
const brainCtx = brainCanvas.getContext('2d');
const rewardCtx = rewardCanvas.getContext('2d');

gameViewCtx.imageSmoothingEnabled = false;
featureCtx.imageSmoothingEnabled = true;
retinaCtx.imageSmoothingEnabled = true;

const ui = {
  start: $('#start-button'), pause: $('#pause-button'), overlay: $('#game-overlay'),
  fullscreen: $('#fullscreen-button'), fullscreenExit: $('#fullscreen-exit'),
  brainStatus: $('#brain-status'), gameStatus: $('#game-status'), episode: $('#episode'),
  reward: $('#reward'), best: $('#best-reward'), action: $('#action-label'),
  active: $('#active-neurons'), mean: $('#mean-rate'), turn: $('#turn-bias'),
  escape: $('#escape-drive'), freeze: $('#freeze-drive'), sim: $('#sim-time'),
  ml: $('#motion-left'), mc: $('#motion-center'), mr: $('#motion-right'), novelty: $('#novelty'),
  vision: $('#vision-summary'), step: $('#step-reward'), epsilon: $('#epsilon'), updates: $('#updates'),
  terminal: $('#terminal-state'), reset: $('#reset-learning'),
  bars: { forward: $('#bar-forward'), left: $('#bar-left'), right: $('#bar-right'), use: $('#bar-use') },
};

const state = {
  game: TEST ? new MockGame(engineCanvas) : new DoomGame(engineCanvas),
  running: false,
  gameReady: false,
  brainReady: false,
  brainFrame: {},
  brainPositions: null,
  brainCount: 0,
  previousPixels: null,
  adaptation: null,
  previousFeatures: null,
  vision: {
    left: 0, center: 0, right: 0, novelty: 0, brightness: 0,
    rotation: 0, translation: 0, forwardFlow: 0, sceneNewness: 0,
    loopScore: 0, stimuli: [], cells: [],
  },
  episode: 0,
  episodeReward: 0,
  bestReward: 0,
  episodeStartedAt: 0,
  stillSince: 0,
  lastControlAt: 0,
  actionIndex: ACTIONS.length - 1,
  actionUntil: 0,
  rewards: [],
  raf: 0,
  sceneVisits: new Map(),
  recentSignatures: [],
  turnDirection: 0,
  turningSince: 0,
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
    if (!saved) saved = JSON.parse(localStorage.getItem(LEGACY_EXPERIMENT_KEY) || 'null');
    if (!saved) return;
    state.episode = Number.isFinite(saved.episode) ? Math.max(0, saved.episode | 0) : 0;
    state.bestReward = Number.isFinite(saved.bestReward) ? saved.bestReward : 0;
    state.rewards = Array.isArray(saved.rewards) ? saved.rewards.filter(Number.isFinite).slice(-500) : [];
    state.restored = true;
  } catch {}
}

function persistExperiment() {
  learner.persist();
  try {
    localStorage.setItem(EXPERIMENT_KEY, JSON.stringify({
      version: 4,
      episode: state.episode,
      bestReward: state.bestReward,
      rewards: state.rewards.slice(-500),
      savedAt: Date.now(),
    }));
  } catch {}
}

restoreExperiment();
ui.episode.textContent = state.episode.toLocaleString();
ui.best.textContent = state.bestReward.toFixed(2);
ui.epsilon.textContent = learner.epsilon.toFixed(3);
ui.updates.textContent = learner.updates.toLocaleString();

function drawFullFrame(source, ctx, targetW, targetH) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetW, targetH);
  const sw = Math.max(1, source.width || 320);
  const sh = Math.max(1, source.height || 200);
  const rawAspect = sw / sh;
  const intendedAspect = Math.abs(rawAspect - 1.6) < 0.12 ? 4 / 3 : rawAspect;
  const targetAspect = targetW / targetH;
  let dw = targetW;
  let dh = targetH;
  if (intendedAspect > targetAspect) dh = targetW / intendedAspect;
  else dw = targetH * intendedAspect;
  const dx = (targetW - dw) / 2;
  const dy = (targetH - dh) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, sw, sh, dx, dy, dw, dh);
  ctx.restore();
  return { dx, dy, dw, dh, sw, sh };
}

function renderGameView() {
  if (!state.gameReady) {
    gameViewCtx.fillStyle = '#000';
    gameViewCtx.fillRect(0, 0, gameViewCanvas.width, gameViewCanvas.height);
    return;
  }
  drawFullFrame(engineCanvas, gameViewCtx, gameViewCanvas.width, gameViewCanvas.height);
}

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
      pos[i * 3] = Math.sin(i * 0.17) * 80 + Math.sin(i * .013) * 25;
      pos[i * 3 + 1] = Math.cos(i * 0.11) * 55 + Math.cos(i * .021) * 18;
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
  const left = state.vision.left, right = state.vision.right, center = state.vision.center;
  const turn = clamp((right - left) * 5 + Math.sin(t) * .08, -1, 1);
  state.brainFrame = {
    t_ms: now,
    active_neurons: 700 + Math.round(center * 3000),
    mean_rate_hz: 2 + center * 20,
    channels: { turn_bias: turn, escape_takeoff: center * .4, escape_long_mode: center * .2, stop_freeze: .05, backward_walk: .03 },
    dn_rates: { DN_left: 18 + left * 90, DN_right: 18 + right * 90, DN_escape: center * 120 },
    proboscis_drive: 0,
    active_idx: Array.from({ length: 700 }, (_, i) => (i * 37 + Math.floor(t * 50)) % state.brainCount),
  };
  updateBrainUI();
}

function bestHorizontalShift(current, previous, x0, x1, maxShift = 3) {
  const w = featureCanvas.width;
  const h = featureCanvas.height;
  let bestDx = 0;
  let bestError = Infinity;
  for (let dx = -maxShift; dx <= maxShift; dx++) {
    let error = 0;
    let count = 0;
    const start = Math.max(x0, -dx);
    const end = Math.min(x1, w - dx);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = start; x < end; x++) {
        error += Math.abs(current[row + x] - previous[row + x + dx]) / 255;
        count++;
      }
    }
    error /= Math.max(1, count);
    if (error < bestError) { bestError = error; bestDx = dx; }
  }
  return { dx: bestDx, error: bestError };
}

function sceneSignature(gray) {
  const w = featureCanvas.width;
  const h = featureCanvas.height;
  const cols = 6;
  const rows = 4;
  let out = '';
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor(gx * w / cols), x1 = Math.floor((gx + 1) * w / cols);
      const y0 = Math.floor(gy * h / rows), y1 = Math.floor((gy + 1) * h / rows);
      let sum = 0, count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) { sum += gray[y * w + x]; count++; }
      }
      out += Math.min(7, Math.floor((sum / Math.max(1, count)) / 32)).toString(8);
    }
  }
  return out;
}

function renderFlyView(cells, stimuli, rotation, forwardFlow) {
  const w = retinaCanvas.width;
  const h = retinaCanvas.height;
  retinaCtx.fillStyle = '#020403';
  retinaCtx.fillRect(0, 0, w, h);
  const fieldAspect = H_FOV_DEG / V_FOV_DEG;
  const targetAspect = w / h;
  let fw = w, fh = h;
  if (fieldAspect > targetAspect) fh = w / fieldAspect;
  else fw = h * fieldAspect;
  const ox = (w - fw) / 2;
  const oy = (h - fh) / 2;
  const cellW = fw / GRID_COLS;
  const cellH = fh / GRID_ROWS;

  for (const cell of cells) {
    const cx = ox + (cell.gx + .5) * cellW;
    const cy = oy + (cell.gy + .5) * cellH;
    const base = Math.round(clamp(cell.adapted * 255, 0, 255));
    const drive = clamp(cell.drive, 0, 1);
    const radius = Math.min(cellW, cellH) * .38;
    retinaCtx.beginPath();
    retinaCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    retinaCtx.fillStyle = `rgb(${Math.round(base * .45)}, ${Math.round(base * .55 + drive * 130)}, ${Math.round(base * .45)})`;
    retinaCtx.fill();
    retinaCtx.strokeStyle = 'rgba(220,255,230,.08)';
    retinaCtx.stroke();
  }

  for (const s of stimuli) {
    const x = ox + (s.azimuth_deg / H_FOV_DEG + .5) * fw;
    const y = oy + (.5 - s.elevation_deg / V_FOV_DEG) * fh;
    const r = 4 + s.strength * 18;
    retinaCtx.beginPath();
    retinaCtx.arc(x, y, r, 0, Math.PI * 2);
    retinaCtx.strokeStyle = `rgba(215,255,138,${.25 + s.strength * .7})`;
    retinaCtx.lineWidth = 2 + s.strength * 3;
    retinaCtx.stroke();
  }

  retinaCtx.strokeStyle = 'rgba(220,230,226,.15)';
  retinaCtx.strokeRect(ox + .5, oy + .5, fw - 1, fh - 1);
  retinaCtx.fillStyle = 'rgba(220,230,226,.72)';
  retinaCtx.font = '18px ui-monospace, monospace';
  retinaCtx.fillText(`rot ${rotation.toFixed(2)}  forward ${forwardFlow.toFixed(2)}`, ox + 12, oy + fh - 14);
}

function sampleVision() {
  if (!state.gameReady) return;
  try {
    const w = featureCanvas.width;
    const h = featureCanvas.height;
    drawFullFrame(engineCanvas, featureCtx, w, h);
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

    let left = 0, center = 0, right = 0, novelty = 0, rotation = 0, forwardFlow = 0, translation = 0;
    let stimuli = [];
    const cells = [];

    if (state.previousPixels) {
      const global = bestHorizontalShift(gray, state.previousPixels, 0, w, 3);
      const zero = bestHorizontalShift(gray, state.previousPixels, 0, w, 0);
      const leftShift = bestHorizontalShift(gray, state.previousPixels, 0, Math.floor(w / 2), 2);
      const rightShift = bestHorizontalShift(gray, state.previousPixels, Math.floor(w / 2), w, 2);
      const coherence = zero.error > .001 ? clamp((zero.error - global.error) / zero.error, 0, 1) : 0;
      rotation = clamp(Math.abs(global.dx) / 3 * coherence, 0, 1);
      forwardFlow = clamp(Math.max(0, leftShift.dx - rightShift.dx) / 4 * (1 - rotation * .75), 0, 1);

      const sums = new Float64Array(GRID_COLS * GRID_ROWS);
      const adaptedSums = new Float64Array(GRID_COLS * GRID_ROWS);
      const counts = new Uint32Array(GRID_COLS * GRID_ROWS);
      let residualTotal = 0, residualCount = 0;
      let lsum = 0, lcount = 0, csum = 0, ccount = 0, rsum = 0, rcount = 0;

      for (let y = 0; y < h; y++) {
        const gy = Math.min(GRID_ROWS - 1, Math.floor(y * GRID_ROWS / h));
        for (let x = 0; x < w; x++) {
          const prevX = x + global.dx;
          if (prevX < 0 || prevX >= w) continue;
          const p = y * w + x;
          const motion = Math.abs(gray[p] - state.previousPixels[y * w + prevX]) / 255;
          const current = gray[p] / 255;
          const temporalContrast = Math.abs(current - state.adaptation[p]);
          const residual = motion * .78 + temporalContrast * .22;
          state.adaptation[p] += (current - state.adaptation[p]) * .055;
          const gx = Math.min(GRID_COLS - 1, Math.floor(x * GRID_COLS / w));
          const gi = gy * GRID_COLS + gx;
          sums[gi] += residual;
          adaptedSums[gi] += current;
          counts[gi]++;
          residualTotal += residual;
          residualCount++;
          if (x < w / 3) { lsum += residual; lcount++; }
          else if (x < w * 2 / 3) { csum += residual; ccount++; }
          else { rsum += residual; rcount++; }
        }
      }

      left = lsum / Math.max(1, lcount);
      center = csum / Math.max(1, ccount);
      right = rsum / Math.max(1, rcount);
      novelty = residualTotal / Math.max(1, residualCount);
      translation = clamp((novelty * 2.2 + forwardFlow * .8) * (1 - rotation * .7), 0, 1);
      const rotationGate = 1 - rotation * .88;

      for (let gy = 0; gy < GRID_ROWS; gy++) {
        for (let gx = 0; gx < GRID_COLS; gx++) {
          const gi = gy * GRID_COLS + gx;
          const local = sums[gi] / Math.max(1, counts[gi]);
          const adapted = adaptedSums[gi] / Math.max(1, counts[gi]);
          const drive = clamp(((local - .009) * 7.5 + forwardFlow * .28) * rotationGate, 0, 1);
          cells.push({ gx, gy, adapted, drive });
          if (drive < .04) continue;
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

    const signature = sceneSignature(gray);
    const priorVisits = state.sceneVisits.get(signature) || 0;
    const recentMatches = state.recentSignatures.reduce((n, s) => n + (s === signature ? 1 : 0), 0);
    state.sceneVisits.set(signature, priorVisits + 1);
    state.recentSignatures.push(signature);
    if (state.recentSignatures.length > 90) state.recentSignatures.shift();
    const sceneNewness = priorVisits === 0 ? 1 : 1 / Math.sqrt(priorVisits + 1);
    const loopScore = clamp((recentMatches - 2) / 8, 0, 1);

    state.previousPixels = gray;
    state.vision = {
      left, center, right, novelty, brightness, rotation, translation, forwardFlow,
      sceneNewness, loopScore, stimuli, cells,
    };

    renderFlyView(cells, stimuli, rotation, forwardFlow);
    ui.ml.textContent = left.toFixed(3);
    ui.mc.textContent = center.toFixed(3);
    ui.mr.textContent = right.toFixed(3);
    ui.novelty.textContent = forwardFlow.toFixed(3);
    ui.vision.textContent = `full-frame LC4/LPLC2 drive · ${stimuli.length} active receptive fields`;
    if (brain && state.brainReady) brain.postMessage({ cmd: 'vision', vision: state.vision });
  } catch (error) {
    console.error('vision sample failed', error);
  }
}

function reward(now) {
  const v = state.vision;
  const action = ACTIONS[state.actionIndex].name;
  const turning = action.includes('left') || action.includes('right');
  const forward = action.startsWith('forward');
  const progress = clamp(v.forwardFlow * (1 - v.rotation), 0, 1);
  const usefulTranslation = clamp(v.translation * (1 - v.rotation), 0, 1);
  const turnDuration = turning && state.turningSince ? now - state.turningSince : 0;

  let r = .002;
  r += progress * .18;
  r += usefulTranslation * .045;
  if (forward && progress > .025) r += .035 * progress;
  if (progress > .03 && v.sceneNewness > .55 && v.rotation < .22) {
    r += .09 * v.sceneNewness * progress;
  }

  r -= .16 * v.rotation;
  if (turning) {
    const spinWithoutProgress = clamp(v.rotation * 1.6, 0, 1) * (1 - progress);
    r -= .22 * spinWithoutProgress;
    if (turnDuration > 700) {
      r -= Math.min(.28, ((turnDuration - 700) / 5000) * .28) * (1 - progress);
    }
  }

  const circleEvidence = v.loopScore * clamp(v.rotation * 1.4 + (turning ? .35 : 0), 0, 1) * (1 - progress);
  r -= .38 * circleEvidence;
  if (v.loopScore > .55 && progress < .02) r -= .10;
  if (action === 'idle') r -= .018;

  const usefulMotion = Math.max(progress, usefulTranslation);
  if (usefulMotion < .012) {
    const still = now - state.stillSince;
    if (still > 1200) r -= Math.min(.25, (still - 1200) / 14000 * .25);
  } else {
    state.stillSince = now;
  }

  return clamp(r, -.65, .35);
}

function terminal(now) {
  const elapsed = now - state.episodeStartedAt;
  const still = now - state.stillSince;
  const action = ACTIONS[state.actionIndex].name;
  const turning = action.includes('left') || action.includes('right');
  const turnDuration = turning && state.turningSince ? now - state.turningSince : 0;
  if (turnDuration > 7000 && state.vision.loopScore > .45 && state.vision.forwardFlow < .025) return 'circling-loss-proxy';
  if (elapsed > 12000 && still > 5000 && state.vision.translation < .01) return 'loss-proxy';
  if (elapsed > 120000 && state.episodeReward > 4) return 'survival-win-proxy';
  return null;
}

function resetEpisode(kind) {
  ui.terminal.textContent = kind;
  state.bestReward = Math.max(state.bestReward, state.episodeReward);
  ui.best.textContent = state.bestReward.toFixed(2);
  state.episode++;
  state.episodeReward = 0;
  state.previousPixels = null;
  state.adaptation = null;
  state.previousFeatures = null;
  state.sceneVisits.clear();
  state.recentSignatures = [];
  state.turnDirection = 0;
  state.turningSince = 0;
  state.episodeStartedAt = performance.now();
  state.stillSince = performance.now();
  ui.episode.textContent = state.episode.toLocaleString();
  state.game.respawn();
  if (brain) brain.postMessage({ cmd: 'reset', seed: state.episode * 17 });
  persistExperiment();
  setTimeout(() => { ui.terminal.textContent = 'none'; }, 1200);
}

function setAction(index) {
  state.actionIndex = index;
  state.game.act(index);
  const name = ACTIONS[index].name;
  const direction = name.includes('left') ? -1 : name.includes('right') ? 1 : 0;
  if (direction === 0) {
    state.turnDirection = 0;
    state.turningSince = 0;
  } else if (direction !== state.turnDirection) {
    state.turnDirection = direction;
    state.turningSince = performance.now();
  }
  ui.action.textContent = name;
  for (const [key, bar] of Object.entries(ui.bars)) {
    bar.style.width = (name.includes(key) || (key === 'forward' && name.startsWith('forward'))) ? '100%' : '0%';
  }
}

function control(now) {
  sampleVision();
  if (TEST) fakeBrain(now);
  if (!TEST && (!state.brainReady || !Number.isFinite(state.brainFrame.t_ms) || state.brainFrame.t_ms <= 0)) return;

  const x = neuralFeatures(state.brainFrame);
  let r = reward(now);
  const end = terminal(now);
  if (end) r += end === 'survival-win-proxy' ? 50 : -30;
  if (state.previousFeatures) learner.update(state.previousFeatures, state.actionIndex, r, x, Boolean(end));
  state.previousFeatures = x;
  state.episodeReward += r;
  state.rewards.push(r);
  if (state.rewards.length > 2000) state.rewards.splice(0, 500);

  ui.step.textContent = r.toFixed(3);
  ui.reward.textContent = state.episodeReward.toFixed(2);
  ui.epsilon.textContent = learner.epsilon.toFixed(3);
  ui.updates.textContent = learner.updates.toLocaleString();

  if (end) return resetEpisode(end);
  if (now >= state.actionUntil) {
    const prior = neuralActionPrior(state.brainFrame, ACTIONS.length);
    setAction(learner.choose(x, prior));
    state.actionUntil = now + 120 + Math.random() * 140;
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
  c.fillStyle = '#080b0a'; c.fillRect(0, 0, w, h);
  if (!state.brainPositions || !state.brainFrame.active_idx) {
    c.fillStyle = '#697570'; c.font = '12px monospace'; c.fillText('loading connectome…', 18, 28); return;
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
  for (let i = 0; i < n; i += stride) { const [x, y] = xy(i); c.fillRect(x, y, 1, 1); }
  c.fillStyle = '#d7ff8a';
  for (const i of state.brainFrame.active_idx) {
    if (i >= n) continue;
    const [x, y] = xy(i); c.fillRect(x - 1, y - 1, 2.5, 2.5);
  }
}

function drawReward() {
  const c = rewardCtx, w = rewardCanvas.width, h = rewardCanvas.height;
  c.fillStyle = '#090c0b'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#1f2825'; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
  const v = state.rewards.slice(-240);
  if (v.length < 2) return;
  let lo = Math.min(-.25, ...v), hi = Math.max(.25, ...v);
  if (hi - lo < 1e-6) hi = lo + 1;
  c.strokeStyle = '#d7ff8a'; c.lineWidth = 1.5; c.beginPath();
  v.forEach((r, i) => {
    const x = i / (v.length - 1) * w;
    const y = h - (r - lo) / (hi - lo) * h;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.stroke();
}

function loop(now) {
  if (!state.running) return;
  renderGameView();
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
  setStatus(ui.gameStatus, 'booting', 'warn');
  try {
    await state.game.boot();
    state.gameReady = true;
    renderGameView();
    state.running = true;
    state.episode = state.episode > 0 ? state.episode + 1 : 1;
    state.episodeReward = 0;
    state.previousPixels = null;
    state.adaptation = null;
    state.previousFeatures = null;
    state.sceneVisits.clear();
    state.recentSignatures = [];
    state.turnDirection = 0;
    state.turningSince = 0;
    state.episodeStartedAt = performance.now();
    state.stillSince = performance.now();
    ui.episode.textContent = state.episode.toLocaleString();
    ui.reward.textContent = '0.00';
    ui.overlay.hidden = true;
    setStatus(ui.gameStatus, TEST ? 'mock running' : (state.restored ? 'running · saved history restored' : 'running'), 'ok');
    ui.pause.disabled = false;
    if (brain && state.brainReady) brain.postMessage({ cmd: 'play' });
    persistExperiment();
    state.raf = requestAnimationFrame(loop);
  } catch (error) {
    setStatus(ui.gameStatus, 'boot failed', 'error');
    ui.start.disabled = false;
    console.error(error);
  }
}

ui.start.addEventListener('click', start);
ui.fullscreen.addEventListener('click', enterFullscreen);
ui.fullscreenExit.addEventListener('click', exitFullscreen);
gameViewCanvas.addEventListener('dblclick', enterFullscreen);
document.addEventListener('fullscreenchange', () => {
  ui.fullscreen.textContent = document.fullscreenElement === gameWrap ? 'Fullscreen active' : 'Fullscreen gameplay';
  requestAnimationFrame(renderGameView);
});

ui.pause.addEventListener('click', () => {
  state.running = !state.running;
  ui.pause.textContent = state.running ? 'Pause' : 'Resume';
  if (brain) brain.postMessage({ cmd: state.running ? 'play' : 'pause' });
  if (state.running) {
    state.lastControlAt = performance.now();
    state.raf = requestAnimationFrame(loop);
  } else {
    cancelAnimationFrame(state.raf);
    renderGameView();
    setAction(ACTIONS.length - 1);
    persistExperiment();
  }
});

ui.reset.addEventListener('click', () => {
  learner.reset();
  state.bestReward = 0;
  state.episode = 0;
  state.rewards = [];
  state.sceneVisits.clear();
  state.recentSignatures = [];
  ui.best.textContent = '0.00';
  ui.episode.textContent = '0';
  ui.epsilon.textContent = learner.epsilon.toFixed(3);
  ui.updates.textContent = '0';
  try {
    localStorage.removeItem(EXPERIMENT_KEY);
    localStorage.removeItem(LEGACY_EXPERIMENT_KEY);
  } catch {}
  drawReward();
});

window.addEventListener('pagehide', persistExperiment);
window.addEventListener('beforeunload', persistExperiment);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistExperiment();
});
setInterval(() => { if (state.running) persistExperiment(); }, 5000);

setStatus(ui.gameStatus, TEST ? 'test mode' : (state.restored ? 'saved history ready' : 'game idle'));
renderGameView();
drawBrain();
drawReward();
if (AUTO) setTimeout(() => ui.start.click(), 50);
