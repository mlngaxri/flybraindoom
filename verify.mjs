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
if (!app.includes('drawFullFrame(engineCanvas, featureCtx')) throw new Error('Fly vision is not sampling the complete framebuffer.');
if (/height\s*-\s*6|usableH\s*=\s*h\s*-/.test(app)) throw new Error('Legacy bottom-row sensory crop reappeared.');
if (!styles.includes('#game-view-canvas') || !styles.includes('#doom-canvas.engine-canvas')) throw new Error('Framebuffer presentation/isolation styles are missing.');
if (!game.includes("'aspect_ratio_correct 1'")) throw new Error('Chocolate Doom aspect correction is not explicit.');
if (!game.includes("'screenblocks 11'")) throw new Error('Doom full scene viewport is not enabled.');

if (!html.includes('id="fullscreen-button"') || !html.includes('id="fullscreen-exit"')) throw new Error('Fullscreen controls are missing.');
if (!app.includes('requestFullscreen') || !app.includes('exitFullscreen')) throw new Error('Fullscreen API wiring is missing.');
if (!styles.includes('.game-wrap:fullscreen')) throw new Error('Fullscreen contain styling is missing.');

if (!app.includes("EXPERIMENT_KEY = 'flybraindoom.experiment.v4'")) throw new Error('Experiment persistence is not on v4.');
if (!policy.includes("POLICY_KEY = 'flybraindoom.policy.v4'")) throw new Error('Learner persistence is not on v4.');
if (!app.includes('loopScore') || !app.includes("'circling-loss-proxy'")) throw new Error('Anti-circling detection is missing.');
if (!app.includes("? 50 : -30")) throw new Error('High-magnitude terminal reinforcement is missing.');
if (!app.includes('r -= .38 * circleEvidence')) throw new Error('Repeated-scene circle penalty is missing.');
if (!app.includes('r -= .16 * v.rotation')) throw new Error('Rotation penalty is missing.');
if (!policy.includes('Math.min(20, rawError)')) throw new Error('Learner error range does not support the stronger terminal signal.');

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
learner.update(x, 0, 50, x, true);
if (learner.updates !== 1 || learner.weights[0].some((v) => !Number.isFinite(v))) throw new Error('Learner update failed.');
if (!memory.has('flybraindoom.policy.v4') && learner.updates >= 20) throw new Error('v4 learner persistence failed.');

console.log('verify: all checks passed');
