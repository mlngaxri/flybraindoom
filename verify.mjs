import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const jsFiles = [
  'app.js', 'arena.js', 'policy.js', 'brain-worker.js',
  'adapters/flygym-wasm.js', 'adapters/malecns-webgpu.js',
];
for (const file of jsFiles) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('source-manifest.json', 'utf8'));

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const arena = fs.readFileSync('arena.js', 'utf8');
const policy = fs.readFileSync('policy.js', 'utf8');
const worker = fs.readFileSync('brain-worker.js', 'utf8');
const flygym = fs.readFileSync('adapters/flygym-wasm.js', 'utf8');
const male = fs.readFileSync('adapters/malecns-webgpu.js', 'utf8');
const architecture = fs.readFileSync('ARCHITECTURE.md', 'utf8');

// DOM contract: every id passed through $('...') must exist in the page.
for (const id of [...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1])) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing DOM id: ${id}`);
}

if (!html.includes('<title>Fly Brain Arena</title>')) throw new Error('Arena title is missing.');
if (/Beat Saber|Fly Brain Saber|Doom|Flappy/i.test(html + app + arena + policy)) throw new Error('Legacy game identity leaked into active arena runtime.');
if (!html.includes('both independent connectome workers') && !html.includes('Two simulated fly nervous systems')) throw new Error('Two-brain scientific boundary is missing from UI.');
if (!html.includes('MaleCNS v1.0') || !html.includes('NeuroMechFly v2')) throw new Error('Target fidelity stack is not disclosed in UI.');

if ((app.match(/new Worker\('\.\/brain-worker\.js'/g) || []).length !== 1 || !app.includes("[0,1].map")) throw new Error('Two independent worker agents are not constructed through the agent array.');
if (!app.includes('await bootBrain(0)') || !app.includes('await bootBrain(1)')) throw new Error('Brain workers are not booted independently/sequentially.');
if (!policy.includes('flybrainarena.policy.v1.${id}')) throw new Error('Independent policy namespaces are missing.');
if (policy.includes("from './arena.js'") || policy.includes('FlyArena')) throw new Error('Policy must not import privileged arena state.');
if (!app.includes('neuralFeatures(a.frame)')) throw new Error('Policy is not driven from neural telemetry.');

for (const name of ['idle','forward','backward','turn-left','turn-right','lunge']) {
  if (!arena.includes(`{ name: '${name}' }`)) throw new Error(`Missing arena action: ${name}`);
}
if (!arena.includes('getSensory(i)') || !arena.includes('azimuth_deg') || !arena.includes('salience:loom')) throw new Error('Egocentric visual encoder is missing.');
if (!arena.includes("type:'contact'") || !arena.includes("type:'round-end'")) throw new Error('Contact/round event model is missing.');
if (!app.includes("cmd:'contact'") || !worker.includes("m.cmd==='contact'")) throw new Error('Modeled contact sensory feedback is not wired to the receiving brain.');
if (!architecture.includes('without implying pain or subjective experience')) throw new Error('Scientific aversive-signal boundary is missing.');

if (!worker.includes("26672e06427c12c61536ce1bd93dae7442944681")) throw new Error('Fruit Fly Lab baseline is not pinned.');
if (!male.includes('166700') || !male.includes('25582938')) throw new Error('MaleCNS target counts are missing.');
if (!male.includes("active:false")) throw new Error('MaleCNS adapter must not claim to be active before assets are validated.');
if (!flygym.includes('v2.1.0') || !flygym.includes('ca65a510c2afe6ac61c51df4f274c8d190c2f95f')) throw new Error('FlyGym release pin is missing.');
if (!flygym.includes('0884af08981994543634563d95e9b1eb49945082')) throw new Error('FlyGym generated-assets pin is missing.');
if (!flygym.includes("active:false")) throw new Error('FlyGym adapter must not claim shared-world physics is already active.');

if (manifest.active?.brain?.name !== 'Fruit Fly Lab browser simulator') throw new Error('Manifest does not identify the active baseline honestly.');
if (manifest.target?.brain?.neurons !== 166700) throw new Error('Manifest MaleCNS neuron count mismatch.');
if (manifest.target?.body?.physics !== 'MuJoCo 3.9.0 WebAssembly') throw new Error('Manifest target body mismatch.');

// Sanity-check the neural feature contract without a browser.
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k,v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
const { ACTIONS } = await import(pathToFileURL(`${process.cwd()}/arena.js`));
if (ACTIONS.length !== 6) throw new Error('Unexpected action count.');
const { LinearQLearner, neuralFeatures } = await import(pathToFileURL(`${process.cwd()}/policy.js`));
const x = neuralFeatures({
  active_neurons: 1200,
  mean_rate_hz: 4.2,
  channels: { turn_bias: .2, escape_takeoff: .1, escape_long_mode: .03, stop_freeze: .02, backward_walk: .01 },
  dn_rates: { DN_left: 12, DN_right: 19, DN_escape: 8 },
  proboscis_drive: 0,
  escape_laterality: .1,
});
if (x.length !== 14 || [...x].some((v) => !Number.isFinite(v))) throw new Error('Neural feature vector is invalid.');
const a = new LinearQLearner(14, 6, 'A-test');
const b = new LinearQLearner(14, 6, 'B-test');
if (a.key === b.key) throw new Error('Agents share a policy namespace.');
a.update(x, 1, 1, x, false);
if (a.updates !== 1 || a.weights[1].some((v) => !Number.isFinite(v))) throw new Error('Learner update failed.');

console.log('verify: Fly Brain Arena v0 checks passed');
