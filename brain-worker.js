const SOURCE_COMMIT = '26672e06427c12c61536ce1bd93dae7442944681';
const MODULE_BASE = `https://cdn.jsdelivr.net/gh/vaibhavkedarisetti/fruit-fly-lab@${SOURCE_COMMIT}/web`;
const DATA_BASE = `https://raw.githubusercontent.com/vaibhavkedarisetti/fruit-fly-lab/${SOURCE_COMMIT}/web/data`;
const EXPECTED_BYTES = { connectome: 22951784, neurons: 3481375 };

let decodeConnectome;
let Session;
let session = null;
let meta = null;
let neurons = null;
let running = false;
let loopTimer = null;
let tickMs = 5;
let lastStimulusAt = -Infinity;
let aversiveUntil = -Infinity;
let aversiveSide = 0;
let aversiveStrength = 0;

const send = (type, payload = {}, transfer = undefined) => {
  const message = { type, ...payload };
  transfer ? self.postMessage(message, transfer) : self.postMessage(message);
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function loadModules() {
  const [engineMod, simMod] = await Promise.all([
    import(`${MODULE_BASE}/js/engine.js`),
    import(`${MODULE_BASE}/js/sim.js`),
  ]);
  decodeConnectome = engineMod.decodeConnectome;
  Session = simMod.Session;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

async function fetchBuffer(url, label, expectedBytes) {
  const response = await fetchWithTimeout(url, { mode: 'cors', cache: 'force-cache' });
  if (!response.ok) throw new Error(`${label} download failed: HTTP ${response.status}`);
  const headerTotal = Number(response.headers.get('content-length')) || 0;
  const total = expectedBytes || headerTotal;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    send('progress', { label, loaded: buffer.byteLength, total: total || buffer.byteLength });
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.byteLength;
    send('progress', { label, loaded, total });
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  if (expectedBytes && loaded !== expectedBytes) throw new Error(`${label} size mismatch: expected ${expectedBytes} bytes, received ${loaded}`);
  return out.buffer;
}

function decodeNeurons(buffer, n) {
  let offset = 0;
  const root = new BigInt64Array(buffer, offset, n); offset += n * 8;
  const pos = new Float32Array(buffer, offset, n * 3); offset += n * 12;
  const type = new Uint16Array(buffer, offset, n); offset += n * 2;
  const cls = new Uint8Array(buffer, offset, n); offset += n;
  const side = new Uint8Array(buffer, offset, n); offset += n;
  const sign = new Int8Array(buffer, offset, n);
  return { root, pos, type, cls, side, sign };
}

async function boot() {
  try {
    send('status', { message: 'loading simulator modules' });
    await loadModules();
    send('status', { message: 'loading connectome metadata' });
    const metaResponse = await fetchWithTimeout(`${DATA_BASE}/meta.json`, { mode: 'cors', cache: 'force-cache' }, 30000);
    if (!metaResponse.ok) throw new Error(`metadata download failed: HTTP ${metaResponse.status}`);
    meta = await metaResponse.json();
    send('status', { message: 'loading connectome graph' });
    const [connectomeBuffer, neuronBuffer] = await Promise.all([
      fetchBuffer(`${DATA_BASE}/connectome.bin`, 'connectome', EXPECTED_BYTES.connectome),
      fetchBuffer(`${DATA_BASE}/neurons.bin`, 'neurons', EXPECTED_BYTES.neurons),
    ]);
    send('status', { message: 'decoding 139k-neuron graph' });
    const connectivity = decodeConnectome(connectomeBuffer, meta.n, meta.nnz);
    neurons = decodeNeurons(neuronBuffer, meta.n);
    session = new Session(connectivity, meta, 7);
    const positions = neurons.pos.slice();
    send('ready', { n: meta.n, nnz: meta.nnz, dataset: meta.dataset, positions }, [positions.buffer]);
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'brain asset download timed out' : (error instanceof Error ? error.message : String(error));
    send('error', { message });
  }
}

function addAversiveOverlay(now) {
  if (!session || now >= aversiveUntil || aversiveStrength <= 0) return;
  const side = aversiveSide < 0 ? -34 : aversiveSide > 0 ? 34 : 0;
  const s = clamp(aversiveStrength, 0, 1);
  for (const azimuth_deg of [side, 0, -side * .45]) {
    session.addLooming({
      azimuth_deg,
      elevation_deg: 0,
      half_size_mm: 9 + s * 8,
      speed_mm_s: 620 + s * 760,
      start_distance_mm: 24,
      max_half_angle_deg: 82,
    });
  }
}

function applyAversive(message) {
  if (!session) return;
  const strength = clamp(Number(message.strength) || 1, 0, 1);
  aversiveStrength = Math.max(aversiveStrength, strength);
  aversiveSide = message.side === 'left' ? -1 : message.side === 'right' ? 1 : 0;
  aversiveUntil = session.engine.tMs + 240;
}

function applyVision(vision) {
  if (!session) return;
  const now = session.engine.tMs;
  if (now - lastStimulusAt < 18) return;
  lastStimulusAt = now;
  session.clearStimuli();

  const globalSalience = clamp(Number(vision.salience ?? vision.threat) || 0, 0, 1);
  const darkOnset = clamp(Number(vision.darkOnset) || 0, 0, 1);
  const candidates = Array.isArray(vision.stimuli)
    ? vision.stimuli.filter((s) => Number.isFinite(s?.strength) && s.strength > 0).sort((a,b) => b.strength - a.strength).slice(0, 18)
    : [];

  if (candidates.length) {
    for (const s of candidates) {
      const base = clamp(Number(s.strength) || 0, 0, 1);
      const local = clamp(Number(s.salience ?? s.threat) || 0, 0, 1);
      const intensity = clamp(base * (1 + globalSalience * .42 + local * .30), 0, 1);
      if (intensity < .025) continue;
      session.addLooming({
        azimuth_deg: clamp(Number(s.azimuth_deg) || 0, -88, 88),
        elevation_deg: clamp(Number(s.elevation_deg) || 0, -55, 55),
        half_size_mm: 3.0 + intensity * 11.5,
        speed_mm_s: 80 + intensity * 700 + globalSalience * 140 + darkOnset * 120,
        start_distance_mm: 30 + (1 - intensity) * 84,
        max_half_angle_deg: 78,
      });
    }
    addAversiveOverlay(now);
    return;
  }

  for (const sector of [
    { key: 'left', azimuth_deg: -36 },
    { key: 'center', azimuth_deg: 0 },
    { key: 'right', azimuth_deg: 36 },
  ]) {
    const motion = clamp(Number(vision[sector.key]) || 0, 0, 1);
    if (motion < .035) continue;
    const intensity = clamp(motion * 2.8 + globalSalience * .28, 0, 1);
    session.addLooming({
      azimuth_deg: sector.azimuth_deg,
      elevation_deg: 0,
      half_size_mm: 3.2 + intensity * 10.5,
      speed_mm_s: 80 + intensity * 650,
      start_distance_mm: 32 + (1 - intensity) * 72,
      max_half_angle_deg: 74,
    });
  }
  addAversiveOverlay(now);
}

function loop() {
  if (!running || !session) return;
  const started = performance.now();
  const frames = session.advance(tickMs);
  const wall = performance.now() - started;
  const frame = frames.at(-1);
  if (frame) {
    const active = [];
    const ws = session.windowSum;
    for (let i = 0; i < ws.length && active.length < 5000; i++) if (ws[i] > 0) active.push(i);
    send('frame', { frame: {
      t_ms: frame.t_ms,
      active_neurons: frame.active_neurons,
      mean_rate_hz: frame.mean_rate_hz,
      channels: frame.channels,
      dn_rates: frame.dn_rates,
      proboscis_drive: frame.proboscis_drive,
      escape_laterality: frame.escape_laterality,
      body: frame.body,
      active_idx: active,
      wall_ms: wall,
    }});
  }
  loopTimer = setTimeout(loop, Math.max(0, tickMs - wall));
}

self.onmessage = (event) => {
  const message = event.data || {};
  try {
    if (message.cmd === 'boot') return boot();
    if (message.cmd === 'play') { running = true; if (!loopTimer) loop(); return; }
    if (message.cmd === 'pause') { running = false; if (loopTimer) clearTimeout(loopTimer); loopTimer = null; return; }
    if (message.cmd === 'vision') { applyVision(message.vision || {}); return; }
    if (message.cmd === 'aversive') { applyAversive(message); return; }
    if (message.cmd === 'reset') {
      if (session) session.reset((message.seed ?? Date.now()) & 0xffff);
      lastStimulusAt = -Infinity;
      aversiveUntil = -Infinity;
      aversiveStrength = 0;
      aversiveSide = 0;
      return;
    }
    if (message.cmd === 'speed') tickMs = Math.max(1, Math.min(20, Number(message.value) || 5));
  } catch (error) {
    send('error', { message: error instanceof Error ? error.message : String(error) });
  }
};
