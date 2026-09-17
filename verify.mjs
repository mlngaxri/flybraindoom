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

if (!game.includes('export class FlappyGame')) throw new Error('Flappy benchmark environment is missing.');
if (!game.includes("{ name: 'flap' }") || !game.includes("{ name: 'coast' }")) throw new Error('Flap/coast action set is missing.');
if ((game.match(/name:/g) || []).length !== 2) throw new Error('Controller exposes more than two game actions.');
if (/\b(DoomGame|chocolate-doom|freedoom)\b/i.test(game)) throw new Error('Legacy Doom runtime remains in the game module.');
if (/state\.vision/.test(policy)) throw new Error('Policy module must not consume raw game vision.');
if (!app.includes('neuralFeatures(state.brainFrame)')) throw new Error('Policy is not driven by neural telemetry.');
if (!app.includes("brain.postMessage({ cmd: 'vision', vision: state.vision })")) throw new Error('Visual encoder is not connected to the brain worker.');
if (!app.includes('featureCtx.drawImage(gameCanvas, 0, 0, gameCanvas.width, gameCanvas.height')) throw new Error('Fly vision is not sampling the complete game frame.');
if (/height\s*-\s*6|usableH\s*=\s*h\s*-/.test(app)) throw new Error('A legacy sensory crop reappeared.');

if (!app.includes('reinforcementFromEvents')) throw new Error('Event-based reinforcement is missing.');
if (!app.includes("event.type === 'pipe'")) throw new Error('Pipe-pass reward is missing.');
if (!app.includes("event.type === 'death'")) throw new Error('Collision penalty is missing.');
if (!app.includes('reward += 12')) throw new Error('Pipe reward is not high-magnitude.');
if (!app.includes('reward -= 30')) throw new Error('Collision penalty is not high-magnitude.');
if (/rotation|loopScore|sceneNewness|forwardFlow/.test(app.split('function reinforcementFromEvents')[1].split('function resetEpisode')[0])) {
  throw new Error('Reward function is using visual-motion proxies instead of game events.');
}

if (!html.includes('id="fullscreen-button"') || !html.includes('id="fullscreen-exit"')) throw new Error('Fullscreen controls are missing.');
if (!app.includes('requestFullscreen') || !app.includes('exitFullscreen')) throw new Error('Fullscreen API wiring is missing.');
if (!styles.includes('.game-wrap:fullscreen')) throw new Error('Fullscreen contain styling is missing.');
if (!styles.includes('aspect-ratio: 9 / 16')) throw new Error('Portrait game presentation is not constrained correctly.');

if (!app.includes("EXPERIMENT_KEY = 'flybraindoom.experiment.v5'")) throw new Error('Experiment persistence is not on v5.');
if (!policy.includes("POLICY_KEY = 'flybraindoom.policy.v5'")) throw new Error('Learner persistence is not on v5.');
if (!app.includes('bestScore')) throw new Error('Best score persistence is missing.');
if (!html.includes('No original Flappy Bird sprites, audio or source code are redistributed.')) throw new Error('Asset provenance disclosure is missing.');

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
const prior = neuralActionPrior(frame, 2);
if (prior.length !== 2 || prior.some((v) => !Number.isFinite(v))) throw new Error('Two-action neural prior is invalid.');
const learner = new LinearQLearner(14, 2);
learner.update(x, 0, 12, x, false);
learner.update(x, 1, -30, x, true);
if (learner.updates !== 2 || learner.weights.some((row) => row.some((v) => !Number.isFinite(v)))) throw new Error('Learner update failed.');

console.log('verify: all Flappy benchmark checks passed');
