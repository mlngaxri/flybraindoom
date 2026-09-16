const BASE = 'https://cdn.jsdelivr.net/gh/vaibhavkedarisetti/fruit-fly-lab@26672e06427c12c61536ce1bd93dae7442944681/web';

let decodeConnectome;
let Session;
let session = null;
let meta = null;
let neurons = null;
let running = false;
let loopTimer = null;
let tickMs = 5;
let lastStimulusAt = 0;

const send = (type, payload = {}, transfer = undefined) => {
  const message = { type, ...payload };
  transfer ? self.postMessage(message, transfer) : self.postMessage(message);
};

async function loadModules() {
  const [engineMod, simMod] = await Promise.all([
    import(`${BASE}/js/engine.js`),
    import(`${BASE}/js/sim.js`),
  ]);
  decodeConnectome = engineMod.decodeConnectome;
  Session = simMod.Session;
}

async function fetchBuffer(url, label) {
  const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    send('progress', { label, loaded, total });
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
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
    meta = await (await fetch(`${BASE}/data/meta.json`, { cache: 'force-cache' })).json();
    send('status', { message: 'loading connectome graph' });
    const [connectomeBuffer, neuronBuffer] = await Promise.all([
      fetchBuffer(`${BASE}/data/connectome.bin`, 'connectome'),
      fetchBuffer(`${BASE}/data/neurons.bin`, 'neurons'),
    ]);
    send('status', { message: 'decoding 139k-neuron graph' });
    const connectivity = decodeConnectome(connectomeBuffer, meta.n, meta.nnz);
    neurons = decodeNeurons(neuronBuffer, meta.n);
    session = new Session(connectivity, meta, 7);

    const positions = neurons.pos.slice();
    send('ready', {
      n: meta.n,
      nnz: meta.nnz,
      dataset: meta.dataset,
      positions,
    }, [positions.buffer]);
  } catch (error) {
    send('error', { message: error instanceof Error ? error.message : String(error) });
  }
}

function applyVision(vision) {
  if (!session) return;
  const now = session.engine.tMs;
  if (now - lastStimulusAt < 24) return;
  lastStimulusAt = now;

  session.clearStimuli();
  const sectors = [
    { key: 'left', azimuth_deg: -36 },
    { key: 'center', azimuth_deg: 0 },
    { key: 'right', azimuth_deg: 36 },
  ];

  for (const sector of sectors) {
    const motion = Math.max(0, Math.min(1, Number(vision[sector.key]) || 0));
    if (motion < 0.035) continue;
    const intensity = Math.min(1, motion * 2.5);
    session.addLooming({
      azimuth_deg: sector.azimuth_deg,
      elevation_deg: 0,
      half_size_mm: 3 + intensity * 9,
      speed_mm_s: 70 + intensity * 520,
      start_distance_mm: 32 + (1 - intensity) * 75,
      max_half_angle_deg: 65,
    });
  }
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
    for (let i = 0; i < ws.length && active.length < 5000; i++) {
      if (ws[i] > 0) active.push(i);
    }
    send('frame', {
      frame: {
        t_ms: frame.t_ms,
        active_neurons: frame.active_neurons,
        mean_rate_hz: frame.mean_rate_hz,
        channels: frame.channels,
        dn_rates: frame.dn_rates,
        proboscis_drive: frame.proboscis_drive,
        escape_laterality: frame.escape_laterality,
        active_idx: active,
        wall_ms: wall,
      },
    });
  }
  loopTimer = setTimeout(loop, 0);
}

self.onmessage = (event) => {
  const message = event.data || {};
  try {
    if (message.cmd === 'boot') return boot();
    if (message.cmd === 'play') {
      running = true;
      if (!loopTimer) loop();
      return;
    }
    if (message.cmd === 'pause') {
      running = false;
      if (loopTimer) clearTimeout(loopTimer);
      loopTimer = null;
      return;
    }
    if (message.cmd === 'vision') {
      applyVision(message.vision || {});
      return;
    }
    if (message.cmd === 'reset') {
      if (session) session.reset((message.seed ?? Date.now()) & 0xffff);
      return;
    }
    if (message.cmd === 'speed') {
      tickMs = Math.max(1, Math.min(20, Number(message.value) || 5));
    }
  } catch (error) {
    send('error', { message: error instanceof Error ? error.message : String(error) });
  }
};
