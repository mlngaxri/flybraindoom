import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const files = ['app.js', 'game.js', 'policy.js', 'brain-worker.js'];
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const game = fs.readFileSync('game.js', 'utf8');
const policy = fs.readFileSync('policy.js', 'utf8');
const worker = fs.readFileSync('brain-worker.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

const requiredIds = [...app.matchAll(/\$\('#([^']+)'\)/g)].map((m) => m[1]);
for (const id of new Set(requiredIds)) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing DOM id: ${id}`);
}

if (/\b(fire|shoot|attack)\b/i.test(game)) throw new Error('Navigation controller unexpectedly exposes a weapon action.');
if (/state\.vision/.test(policy)) throw new Error('Policy module must not consume raw game vision.');
if (!app.includes("brain.postMessage({ cmd: 'vision', vision: state.vision })")) throw new Error('Visual encoder is not connected to the brain worker.');
if (!app.includes('neuralFeatures(state.brainFrame)')) throw new Error('Policy is not driven from neural telemetry.');
if (!app.includes('neuralActionPrior(state.brainFrame')) throw new Error('Descending-neuron action prior is not connected.');
if (!app.includes('pagehide') || !app.includes('visibilitychange') || !app.includes('setInterval')) throw new Error('Learning persistence hooks are incomplete.');
if (!game.includes("'screenblocks 11'")) throw new Error('Doom viewport is not forced to fullscreen scene rendering.');
if (!css.includes('aspect-ratio: 4 / 3')) throw new Error('Doom display is not corrected to 4:3.');
if (!worker.includes('vision.stimuli') || !worker.includes('azimuth_deg') || !worker.includes('elevation_deg')) throw new Error('Spatial LC4/LPLC2 drive is missing.');
if (!app.includes('forwardFlow') || !app.includes('rotation')) throw new Error('Optic-flow decomposition is missing.');

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

const { LinearQLearner, neuralFeatures, neuralActionPrior } = await import(pathToFileURL(`${process.cwd()}/policy.js`));
const frame = {
  active_neurons: 1200,
  mean_rate_hz: 4.2,
  channels: { turn_bias: .2, escape_takeoff: .1, escape_long_mode: .03, stop_freeze: .02, backward_walk: .01 },
  dn_rates: { DN_left: 12, DN_right: 19, DN_escape: 8 },
  proboscis_drive: 0,
};
const x = neuralFeatures(frame);
if (x.length !== 14 || [...x].some((v) => !Number.isFinite(v))) throw new Error('Neural feature vector is invalid.');
const prior = neuralActionPrior(frame, 7);
if (prior.length !== 7 || prior.some((v) => !Number.isFinite(v))) throw new Error('Neural action prior is invalid.');

const learner = new LinearQLearner(14, 7);
learner.update(x, 0, 1, x, false);
learner.persist();
if (learner.updates !== 1 || learner.weights[0].some((v) => !Number.isFinite(v))) throw new Error('Learner update failed.');
const restored = new LinearQLearner(14, 7);
if (restored.updates !== 1 || restored.weights[0].some((v, i) => v !== learner.weights[0][i])) throw new Error('Learner persistence restore failed.');

console.log('verify: all checks passed');
