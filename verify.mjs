import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const files = ['app.js','game.js','policy.js','brain-worker.js'];
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
JSON.parse(fs.readFileSync('vercel.json','utf8'));

const html = fs.readFileSync('index.html','utf8');
const app = fs.readFileSync('app.js','utf8');
const game = fs.readFileSync('game.js','utf8');
const policy = fs.readFileSync('policy.js','utf8');
const worker = fs.readFileSync('brain-worker.js','utf8');

for (const id of new Set([...app.matchAll(/\$\('#([^']+)'\)/g)].map(m => m[1]))) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing DOM id: ${id}`);
}

if (/doom|freedoom|chocolate-doom|flappy/i.test(game + app + html)) throw new Error('Legacy game runtime leaked into active saber build.');
if (/audio|music|song/i.test(game)) throw new Error('Game runtime unexpectedly depends on music/audio.');
if (!game.includes("{ name: 'idle' }") || !game.includes("{ name: 'left-swing' }") || !game.includes("{ name: 'right-swing' }")) throw new Error('Three-action saber interface is missing.');
if (!game.includes("const BLUE = '#43a8ff'") || !game.includes("const RED = '#ff4f67'")) throw new Error('Requested saber colours are missing.');
if (!game.includes('freshSeed()') || !game.includes('spawnBlock()')) throw new Error('Random procedural block generation is missing.');
if (!game.includes('project(x, y, z)')) throw new Error('3D perspective projection is missing.');
if (!game.includes('drawAvatar()') || !game.includes('const eyeY = cy - 8')) throw new Error('Smiling cube avatar is missing.');
if (!game.includes('saberSweepPoint') || !game.includes('trySlice')) throw new Error('3D saber swing/collision path is missing.');
if (!app.includes("brain.postMessage({ cmd: 'vision', vision: state.vision })")) throw new Error('Visual encoder is not wired to the brain worker.');
if (!app.includes('neuralFeatures(state.brainFrame)')) throw new Error('Policy is not driven from neural telemetry.');
if (/state\.game|block(?:s)?|combo|miss(?:es)?|hit(?:s)?/i.test(policy)) throw new Error('Policy module must not consume game state.');
if (!app.includes('state.game.consumeEvents()')) throw new Error('Reward is not derived from environment events.');
if (!app.includes("EXPERIMENT_KEY = 'flybrainsaber.experiment.v2'")) throw new Error('Saber experiment persistence key is missing.');
if (!policy.includes("POLICY_KEY = 'flybrainsaber.policy.v2'")) throw new Error('Saber learner persistence key is missing.');
if (!/vision\.salience\s*\?\?\s*vision\.threat/.test(worker)) throw new Error('Generic visual salience is not supported by worker.');
if (!html.includes('left blue') || !html.includes('right red')) throw new Error('Left/right saber labels are missing.');
if (!html.includes('id="fullscreen-button"') || !app.includes('requestFullscreen')) throw new Error('Fullscreen support is missing.');

if (!game.includes('this.rearmDuration = .72') || !game.includes('getActionMask()')) throw new Error('Global saber rearm lockout is missing.');
if (!app.includes('const mask = state.game.getActionMask()') || !app.includes('learner.choose(x, prior, mask)')) throw new Error('Policy action masking during rearm is missing.');
if (!app.includes("e.wrongTarget ? .72 : .32") || !app.includes("e.type === 'impact'") || !app.includes('4.6')) throw new Error('Balanced impact/anti-spam reward is missing.');
if (!policy.includes('mirrorFeatures(x)') || !policy.includes('mirroredAction')) throw new Error('Left/right symmetry augmentation is missing.');
if (!game.includes('drawFlowField()') || !game.includes('this.flowSpeed = 9.2') || !game.includes('makeFlowParticle')) throw new Error('Forward optic-flow field is missing.');
if (!game.includes("type: 'impact'") || !game.includes('drawImpactOverlay()')) throw new Error('Block impact feedback is missing.');
if (!app.includes("cmd: 'aversive'") || !worker.includes("message.cmd === 'aversive'") || !worker.includes('addAversiveOverlay(now)')) throw new Error('Aversive connectome pulse wiring is missing.');

const memory = new Map();
globalThis.localStorage = { getItem:k=>memory.get(k)??null, setItem:(k,v)=>memory.set(k,String(v)), removeItem:k=>memory.delete(k) };
const { ACTIONS } = await import(pathToFileURL(`${process.cwd()}/game.js`));
if (ACTIONS.map(a => a.name).join(',') !== 'idle,left-swing,right-swing') throw new Error('Unexpected action ordering.');
const { LinearQLearner, neuralFeatures } = await import(pathToFileURL(`${process.cwd()}/policy.js`));
const x = neuralFeatures({ active_neurons:1200, mean_rate_hz:4.2, channels:{turn_bias:.2,escape_takeoff:.1,escape_long_mode:.03,stop_freeze:.02,backward_walk:.01}, dn_rates:{DN_left:12,DN_right:19,DN_escape:8}, proboscis_drive:0 });
if (x.length !== 14 || [...x].some(v => !Number.isFinite(v))) throw new Error('Neural feature vector is invalid.');
const learner = new LinearQLearner(14, 3);
learner.update(x, 1, 5, x, false);
if (learner.updates !== 1 || learner.weights[1].some(v => !Number.isFinite(v))) throw new Error('Learner update failed.');

console.log('verify: saber build checks passed');
