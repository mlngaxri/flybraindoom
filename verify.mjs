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

const requiredIds = [...app.matchAll(/\$\('#([^']+)'\)/g)].map((m) => m[1]);
for (const id of new Set(requiredIds)) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing DOM id: ${id}`);
}

if (/\b(fire|shoot|attack)\b/i.test(game)) throw new Error('Navigation controller unexpectedly exposes a weapon action.');
if (/state\.vision/.test(policy)) throw new Error('Policy module must not consume raw game vision.');
if (!app.includes("brain.postMessage({ cmd: 'vision', vision: state.vision })")) throw new Error('Visual encoder is not connected to the brain worker.');
if (!app.includes('neuralFeatures(state.brainFrame)')) throw new Error('Policy is not driven from neural telemetry.');

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
const { LinearQLearner, neuralFeatures } = await import(pathToFileURL(`${process.cwd()}/policy.js`));
const frame = {
  active_neurons: 1200,
  mean_rate_hz: 4.2,
  channels: { turn_bias: .2, escape_takeoff: .1, escape_long_mode: .03, stop_freeze: .02, backward_walk: .01 },
  dn_rates: { DN_left: 12, DN_right: 19, DN_escape: 8 },
  proboscis_drive: 0,
};
const x = neuralFeatures(frame);
if (x.length !== 14 || [...x].some((v) => !Number.isFinite(v))) throw new Error('Neural feature vector is invalid.');
const learner = new LinearQLearner(14, 7);
learner.update(x, 0, 1, x, false);
if (learner.updates !== 1 || learner.weights[0].some((v) => !Number.isFinite(v))) throw new Error('Learner update failed.');

console.log('verify: all checks passed');
