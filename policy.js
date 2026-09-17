const POLICY_KEY = 'flybraindoom.policy.v4';

export class LinearQLearner {
  constructor(inputSize, actionCount) {
    this.inputSize = inputSize;
    this.actionCount = actionCount;
    this.alpha = 0.009;
    this.gamma = 0.97;
    this.epsilon = 0.10;
    this.minEpsilon = 0.02;
    this.decay = 0.99975;
    this.priorWeight = 0.34;
    this.updates = 0;
    this.weights = Array.from({ length: actionCount }, () => new Float64Array(inputSize));
    this.restore();
  }

  q(action, x) {
    let sum = 0;
    const w = this.weights[action];
    for (let i = 0; i < x.length; i++) sum += w[i] * x[i];
    return sum;
  }

  choose(x, prior = null) {
    if (Math.random() < this.epsilon) return Math.floor(Math.random() * this.actionCount);
    let best = 0, bestScore = -Infinity;
    for (let a = 0; a < this.actionCount; a++) {
      const biologicalPrior = prior && Number.isFinite(prior[a]) ? prior[a] : 0;
      const score = this.q(a, x) + this.priorWeight * biologicalPrior;
      if (score > bestScore) { best = a; bestScore = score; }
    }
    return best;
  }

  update(prevX, action, reward, nextX, terminal = false) {
    if (!prevX) return;
    let nextBest = 0;
    if (!terminal) {
      nextBest = -Infinity;
      for (let a = 0; a < this.actionCount; a++) nextBest = Math.max(nextBest, this.q(a, nextX));
    }
    const rawError = reward + (terminal ? 0 : this.gamma * nextBest) - this.q(action, prevX);
    const error = Math.max(-20, Math.min(20, rawError));
    const w = this.weights[action];
    for (let i = 0; i < w.length; i++) w[i] += this.alpha * error * prevX[i];
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.decay);
    this.updates++;
    if (this.updates % 20 === 0) this.persist();
  }

  persist() {
    try {
      localStorage.setItem(POLICY_KEY, JSON.stringify({
        version: 4,
        epsilon: this.epsilon,
        updates: this.updates,
        weights: this.weights.map((w) => Array.from(w)),
      }));
    } catch {}
  }

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(POLICY_KEY) || 'null');
      if (!saved || saved.version !== 4 || !Array.isArray(saved.weights) || saved.weights.length !== this.actionCount) return;
      const rows = saved.weights.map((row) => Array.isArray(row) ? row.slice(0, this.inputSize) : []);
      if (rows.some((row) => row.length !== this.inputSize || row.some((v) => !Number.isFinite(v)))) return;
      this.weights = rows.map((row) => Float64Array.from(row));
      if (Number.isFinite(saved.epsilon)) this.epsilon = Math.max(this.minEpsilon, saved.epsilon);
      if (Number.isFinite(saved.updates)) this.updates = Math.max(0, saved.updates | 0);
    } catch {}
  }

  reset() {
    this.weights = Array.from({ length: this.actionCount }, () => new Float64Array(this.inputSize));
    this.epsilon = 0.10;
    this.updates = 0;
    try { localStorage.removeItem(POLICY_KEY); } catch {}
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function neuralFeatures(frame = {}) {
  const ch = frame.channels || {};
  const entries = Object.entries(frame.dn_rates || {}).filter(([, value]) => Number.isFinite(value));
  const vals = entries.map(([, value]) => value);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const max = vals.length ? Math.max(...vals) : 0;
  const std = vals.length ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) : 0;
  const sideMean = (side) => {
    const sideVals = entries.filter(([name]) => name.toLowerCase().includes(side)).map(([, value]) => value);
    return sideVals.length ? sideVals.reduce((a, b) => a + b, 0) / sideVals.length : 0;
  };

  return Float64Array.from([
    1,
    clamp(Number(ch.turn_bias) || 0, -1, 1),
    clamp(Number(ch.escape_takeoff) || 0, 0, 1),
    clamp(Number(ch.escape_long_mode) || 0, 0, 1),
    clamp(Number(ch.stop_freeze) || 0, 0, 1),
    clamp(Number(ch.backward_walk) || 0, 0, 1),
    clamp((Number(frame.mean_rate_hz) || 0) / 25, 0, 2),
    clamp((Number(frame.active_neurons) || 0) / 25000, 0, 2),
    clamp(mean / 80, 0, 2),
    clamp(max / 150, 0, 2),
    clamp(std / 80, 0, 2),
    clamp(sideMean('left') / 80, 0, 2),
    clamp(sideMean('right') / 80, 0, 2),
    clamp(Number(frame.proboscis_drive) || 0, 0, 1),
  ]);
}

export function neuralActionPrior(frame = {}, actionCount = 7) {
  const ch = frame.channels || {};
  const turn = clamp(Number(ch.turn_bias) || 0, -1, 1);
  const freeze = clamp(Number(ch.stop_freeze) || 0, 0, 1);
  const escape = clamp(Math.max(Number(ch.escape_takeoff) || 0, Number(ch.escape_long_mode) || 0), 0, 1);
  const backward = clamp(Number(ch.backward_walk) || 0, 0, 1);
  const left = Math.max(0, -turn);
  const right = Math.max(0, turn);
  const move = clamp(0.12 + escape * 0.55 - freeze * 0.8 - backward * 0.35, 0, 1);
  const prior = [
    move,
    left,
    right,
    clamp(move * 0.7 + left * 0.7, 0, 1),
    clamp(move * 0.7 + right * 0.7, 0, 1),
    0,
    clamp(freeze + backward * 0.25, 0, 1),
  ];
  return prior.slice(0, actionCount);
}
