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
const styles = fs.readFileSync('styles.css', 'utf8');

const requiredIds = [...app.matchAll(/\$\('#([^']+)'\)/g)].map((m) => m[1]);
for (const id of new Set(requiredIds)) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing DOM id: ${id}`);
}

if (/\b(fire|shoot|attack)\b/i.test(game)) throw new Error('Navigation controller unexpectedly exposes a weapon action.');
if (/state\.vision/.test(policy)) throw new Error('Policy module must not consume raw game vision.');
if (!app.includes("brain.postMessage({ cmd: 'vision', vision: state.vision })")) throw new Error('Visual encoder is not connected to the brain worker.');
if (!app.includes('neuralFeatures(state.brainFrame)')) throw new Error('Policy is not driven from neural telemetry.');
if (!app.includes("gameViewCanvas.id = 'game-view-canvas'")) throw new Error('Dedicated centered game presentation canvas is missing.');
if (!app.includes('drawFullFrame(engineCanvas, featureCtx')) throw new Error('Fly vision is not sampling the complete centered framebuffer.');
if (/height\s*-\s*6|usableH\s*=\s*h\s*-/.test(app)) throw new Error('Legacy bottom-row sensory crop reappeared.');
if (!styles.includes('#game-view-canvas') || !styles.includes('#doom-canvas.engine-canvas')) throw new Error('Framebuffer presentation/isolation styles are missing.');
if (!game.includes("'aspect_ratio_correct 1'")) throw new Error('Chocolate Doom aspect correction is not explicit.');
if (!game.includes("'screenblocks 11'")) throw new Error('Doom full scene viewport is not enabled.');
if (!app.includes('EXPERIMENT_KEY') || !app.includes('persistExperiment')) throw new Error('Experiment persistence is missing.');

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
