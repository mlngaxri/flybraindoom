import { ACTIONS, DoomGame, MockGame } from './game.js';
import { LinearQLearner, neuralFeatures } from './policy.js';

const TEST = new URLSearchParams(location.search).get('test') === '1';
const AUTO = new URLSearchParams(location.search).get('autostart') === '1';
const $ = (s) => document.querySelector(s);
const canvas = $('#doom-canvas');
const featureCanvas = $('#feature-canvas');
const retinaCanvas = $('#retina-canvas');
const brainCanvas = $('#brain-canvas');
const rewardCanvas = $('#reward-canvas');
const featureCtx = featureCanvas.getContext('2d', { willReadFrequently: true });
const retinaCtx = retinaCanvas.getContext('2d');
const brainCtx = brainCanvas.getContext('2d');
const rewardCtx = rewardCanvas.getContext('2d');

const ui = {
  start: $('#start-button'), pause: $('#pause-button'), overlay: $('#game-overlay'),
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
  game: TEST ? new MockGame(canvas) : new DoomGame(canvas),
  running: false, gameReady: false, brainReady: false, brainFrame: {}, brainPositions: null, brainCount: 0,
  previousPixels: null, previousFeatures: null, vision: { left: 0, center: 0, right: 0, novelty: 0, brightness: 0 },
  episode: 0, episodeReward: 0, bestReward: 0, episodeStartedAt: 0, stillSince: 0,
  lastControlAt: 0, actionIndex: ACTIONS.length - 1, actionUntil: 0, rewards: [], raf: 0,
};
const learner = new LinearQLearner(14, ACTIONS.length);
let brain = null;

const setStatus = (el, text, tone = '') => {
  el.textContent = text;
  el.className = `status${tone ? ` status-${tone}` : ''}`;
};

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
      const pct = msg.total ? ` ${Math.round(msg.loaded / msg.total * 100)}%` : '';
      setStatus(ui.brainStatus, `${msg.label}${pct}`, 'warn');
    }
    if (msg.type === 'ready') {
      state.brainReady = true; state.brainCount = msg.n; state.brainPositions = msg.positions;
      setStatus(ui.brainStatus, `${msg.n.toLocaleString()} neurons ready`, 'ok');
      if (state.running) brain.postMessage({ cmd: 'play' });
    }
    if (msg.type === 'frame') { state.brainFrame = msg.frame; updateBrainUI(); }
    if (msg.type === 'error') { setStatus(ui.brainStatus, 'brain error', 'error'); console.error(msg.message); }
  };
  brain.postMessage({ cmd: 'boot' });
}
setupBrain();

function fakeBrain(now) {
  const t = now / 1000;
  const left = state.vision.left, right = state.vision.right, center = state.vision.center;
  const turn = Math.max(-1, Math.min(1, (right - left) * 5 + Math.sin(t) * .08));
  state.brainFrame = {
    t_ms: now, active_neurons: 700 + Math.round(center * 3000), mean_rate_hz: 2 + center * 20,
    channels: { turn_bias: turn, escape_takeoff: center * .4, escape_long_mode: center * .2, stop_freeze: 0.05, backward_walk: 0.03 },
    dn_rates: { DN_left: 18 + left * 90, DN_right: 18 + right * 90, DN_escape: center * 120 },
    proboscis_drive: 0,
    active_idx: Array.from({ length: 700 }, (_, i) => (i * 37 + Math.floor(t * 50)) % state.brainCount),
  };
  updateBrainUI();
}

function sampleVision() {
  if (!state.gameReady) return;
  try {
    featureCtx.drawImage(canvas, 0, 0, featureCanvas.width, featureCanvas.height);
    const data = featureCtx.getImageData(0, 0, featureCanvas.width, featureCanvas.height).data;
    const gray = new Uint8Array(featureCanvas.width * featureCanvas.height);
    let brightness = 0;
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      const g = Math.round(data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114);
      gray[p] = g; brightness += g / 255;
    }
    brightness /= gray.length;
    let left = 0, center = 0, right = 0, novelty = 0, lc = 0, cc = 0, rc = 0;
    if (state.previousPixels) {
      for (let y = 0; y < featureCanvas.height - 6; y++) for (let x = 0; x < featureCanvas.width; x++) {
        const p = y * featureCanvas.width + x;
        const d = Math.abs(gray[p] - state.previousPixels[p]) / 255;
        novelty += d;
        if (x < 16) { left += d; lc++; } else if (x < 32) { center += d; cc++; } else { right += d; rc++; }
      }
      left /= Math.max(1, lc); center /= Math.max(1, cc); right /= Math.max(1, rc);
      novelty /= Math.max(1, (featureCanvas.height - 6) * featureCanvas.width);
    }
    state.previousPixels = gray;
    state.vision = { left, center, right, novelty, brightness };
    retinaCtx.imageSmoothingEnabled = false;
    retinaCtx.drawImage(featureCanvas, 0, 0, retinaCanvas.width, retinaCanvas.height);
    retinaCtx.fillStyle = 'rgba(215,255,138,.65)';
    retinaCtx.fillRect(retinaCanvas.width / 3, 0, 1, retinaCanvas.height);
    retinaCtx.fillRect(retinaCanvas.width * 2 / 3, 0, 1, retinaCanvas.height);
    ui.ml.textContent = left.toFixed(3); ui.mc.textContent = center.toFixed(3); ui.mr.textContent = right.toFixed(3);
    ui.novelty.textContent = novelty.toFixed(3); ui.vision.textContent = `brightness ${brightness.toFixed(2)} · looming proxy`;
    if (brain && state.brainReady) brain.postMessage({ cmd: 'vision', vision: state.vision });
  } catch (error) { console.error('vision sample failed', error); }
}

function reward(now) {
  const v = state.vision;
  let r = .002 + Math.min(.025, v.novelty * .18) + Math.min(.012, (v.left + v.center + v.right) * .035);
  if (ACTIONS[state.actionIndex].name === 'idle') r -= .003;
  const motion = (v.left + v.center + v.right) / 3;
  if (motion < .008) {
    const still = now - state.stillSince;
    if (still > 1800) r -= Math.min(.035, (still - 1800) / 80000);
  } else state.stillSince = now;
  return r;
}

function terminal(now) {
  const elapsed = now - state.episodeStartedAt, still = now - state.stillSince;
  if (elapsed > 12000 && still > 5200 && (state.vision.brightness < .045 || state.vision.novelty < .003)) return 'loss-proxy';
  if (elapsed > 90000 && state.episodeReward > .5) return 'survival-win-proxy';
  return null;
}

function resetEpisode(kind) {
  ui.terminal.textContent = kind;
  state.bestReward = Math.max(state.bestReward, state.episodeReward); ui.best.textContent = state.bestReward.toFixed(2);
  state.episode++; state.episodeReward = 0; state.previousPixels = null; state.previousFeatures = null;
  state.episodeStartedAt = performance.now(); state.stillSince = performance.now(); ui.episode.textContent = state.episode;
  state.game.respawn(); if (brain) brain.postMessage({ cmd: 'reset', seed: state.episode * 17 });
  setTimeout(() => { ui.terminal.textContent = 'none'; }, 1200);
}

function setAction(index) {
  state.actionIndex = index; state.game.act(index); const name = ACTIONS[index].name; ui.action.textContent = name;
  for (const [key, bar] of Object.entries(ui.bars)) bar.style.width = (name.includes(key) || (key === 'forward' && name.startsWith('forward'))) ? '100%' : '0%';
}

function control(now) {
  sampleVision(); if (TEST) fakeBrain(now);
  const x = neuralFeatures(state.brainFrame);
  let r = reward(now); const end = terminal(now); if (end) r += end === 'loss-proxy' ? -2.5 : 4;
  if (state.previousFeatures) learner.update(state.previousFeatures, state.actionIndex, r, x, Boolean(end));
  state.previousFeatures = x; state.episodeReward += r; state.rewards.push(r); if (state.rewards.length > 2000) state.rewards.splice(0, 500);
  ui.step.textContent = r.toFixed(3); ui.reward.textContent = state.episodeReward.toFixed(2);
  ui.epsilon.textContent = learner.epsilon.toFixed(3); ui.updates.textContent = learner.updates.toLocaleString();
  if (end) return resetEpisode(end);
  if (now >= state.actionUntil) { setAction(learner.choose(x)); state.actionUntil = now + 180 + Math.random() * 220; }
}

function updateBrainUI() {
  const f = state.brainFrame, ch = f.channels || {};
  ui.active.textContent = Number(f.active_neurons || 0).toLocaleString(); ui.mean.textContent = `${Number(f.mean_rate_hz || 0).toFixed(2)} Hz`;
  ui.turn.textContent = Number(ch.turn_bias || 0).toFixed(3);
  ui.escape.textContent = Math.max(Number(ch.escape_takeoff || 0), Number(ch.escape_long_mode || 0)).toFixed(3);
  ui.freeze.textContent = Number(ch.stop_freeze || 0).toFixed(3); ui.sim.textContent = `${Math.round(f.t_ms || 0)} ms`;
}

function drawBrain() {
  const c = brainCtx, w = brainCanvas.width, h = brainCanvas.height; c.fillStyle = '#080b0a'; c.fillRect(0, 0, w, h);
  if (!state.brainPositions || !state.brainFrame.active_idx) { c.fillStyle = '#697570'; c.font = '12px monospace'; c.fillText('loading connectome…', 18, 28); return; }
  const p = state.brainPositions, n = state.brainCount, stride = Math.max(1, Math.floor(n / 4500));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i += stride) { const x = p[i * 3], y = p[i * 3 + 1]; if (!Number.isFinite(x + y)) continue; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const scale = Math.min((w - 40) / Math.max(1, maxX - minX), (h - 40) / Math.max(1, maxY - minY));
  const xy = (i) => [20 + (p[i * 3] - minX) * scale, 20 + (p[i * 3 + 1] - minY) * scale];
  c.fillStyle = 'rgba(158,171,166,.12)'; for (let i = 0; i < n; i += stride) { const [x, y] = xy(i); c.fillRect(x, y, 1, 1); }
  c.fillStyle = '#d7ff8a'; for (const i of state.brainFrame.active_idx) { if (i >= n) continue; const [x, y] = xy(i); c.fillRect(x - 1, y - 1, 2.5, 2.5); }
}

function drawReward() {
  const c = rewardCtx, w = rewardCanvas.width, h = rewardCanvas.height; c.fillStyle = '#090c0b'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#1f2825'; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
  const v = state.rewards.slice(-240); if (v.length < 2) return;
  let lo = Math.min(-.05, ...v), hi = Math.max(.05, ...v); if (hi - lo < 1e-6) hi = lo + 1;
  c.strokeStyle = '#d7ff8a'; c.lineWidth = 1.5; c.beginPath(); v.forEach((r, i) => { const x = i / (v.length - 1) * w, y = h - (r - lo) / (hi - lo) * h; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
}

function loop(now) {
  if (!state.running) return;
  if (state.gameReady && now - state.lastControlAt > 120) { state.lastControlAt = now; control(now); }
  drawBrain(); drawReward(); state.raf = requestAnimationFrame(loop);
}

async function start() {
  if (state.running) return; ui.start.disabled = true; setStatus(ui.gameStatus, 'booting', 'warn');
  try {
    await state.game.boot(); state.gameReady = true; state.running = true; state.episode = 1;
    state.episodeStartedAt = performance.now(); state.stillSince = performance.now(); ui.episode.textContent = '1'; ui.overlay.hidden = true;
    setStatus(ui.gameStatus, TEST ? 'mock running' : 'running', 'ok'); ui.pause.disabled = false;
    if (brain && state.brainReady) brain.postMessage({ cmd: 'play' }); state.raf = requestAnimationFrame(loop);
  } catch (error) { setStatus(ui.gameStatus, 'boot failed', 'error'); ui.start.disabled = false; console.error(error); }
}

ui.start.addEventListener('click', start);
ui.pause.addEventListener('click', () => {
  state.running = !state.running; ui.pause.textContent = state.running ? 'Pause' : 'Resume';
  if (brain) brain.postMessage({ cmd: state.running ? 'play' : 'pause' });
  if (state.running) state.raf = requestAnimationFrame(loop); else { cancelAnimationFrame(state.raf); setAction(ACTIONS.length - 1); }
});
ui.reset.addEventListener('click', () => { learner.reset(); state.bestReward = 0; ui.best.textContent = '0.00'; ui.epsilon.textContent = learner.epsilon.toFixed(3); ui.updates.textContent = '0'; });
window.addEventListener('beforeunload', () => learner.persist());
setStatus(ui.gameStatus, TEST ? 'test mode' : 'game idle'); ui.epsilon.textContent = learner.epsilon.toFixed(3); ui.updates.textContent = learner.updates.toLocaleString(); drawBrain(); drawReward();
if (AUTO) setTimeout(() => ui.start.click(), 50);
