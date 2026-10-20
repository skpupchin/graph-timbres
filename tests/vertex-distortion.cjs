const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'vertex-distortion.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'standalone script exists');
class TestBlob extends Blob {
  constructor(parts, options) { super(parts, options); this.bytes = Buffer.from(parts[0]); }
}
const sandbox = { module: { exports: {} }, Blob: TestBlob, Float32Array, Float64Array };
vm.runInNewContext(script, sandbox, { filename: 'vertex-distortion.html' });
const { RATE, readoutWeights, vertexReadout, pooledReadout, createLinearStepper, renderWet, combine, wav } = sandbox.module.exports;

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
}
function base(overrides = {}) {
  return { n: 4, edges: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [0, 2, 1]], strike: 0, listen: 2,
    scale: 180, tau: 0.9, drive: 0, width: 55, impulse: 1, mode: 'file', wet: 1, gain: 1, ...overrides };
}
function sine(hz, seconds, amplitude = 0.8) {
  return Float32Array.from({ length: RATE * seconds }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / RATE));
}
function harmonic(samples, hz, start, length) {
  let real = 0, imaginary = 0;
  for (let i = 0; i < length; i++) {
    const phase = 2 * Math.PI * hz * i / RATE;
    real += samples[start + i] * Math.cos(phase);
    imaginary -= samples[start + i] * Math.sin(phase);
  }
  return Math.hypot(real, imaginary) * 2 / length;
}

const p = base();
const input = sine(197, 1);
const linear = renderWet(p, input);
const stepper = createLinearStepper(p), q = new Float64Array(p.n);
const weights = readoutWeights(p.n, p.edges, p.listen, p.width);
for (let i = 0; i < input.length; i++) {
  stepper.sample(input[i], q);
  close(linear[i], q.reduce((sum, value, j) => sum + value * weights[j], 0), 2e-9);
}
close(weights.reduce((sum, value) => sum + value, 0), 1);
assert.deepEqual(Array.from(readoutWeights(4, p.edges, 2, 0)), [0, 0, 1, 0]);
assert.deepEqual(Array.from(readoutWeights(4, p.edges, 2, 100)), [0.25, 0.25, 0.25, 0.25]);
assert.ok(weights[2] > weights[1] && Math.abs(weights[1] - weights[0]) < 1e-12);
const pathWeights = readoutWeights(4, [[0, 1], [1, 2], [2, 3]], 0, 50);
assert.ok(pathWeights[0] > pathWeights[1] && pathWeights[1] > pathWeights[2] && pathWeights[2] > pathWeights[3]);

const nonlinear = renderWet(base({ drive: 4 }), input);
const start = RATE / 2, length = RATE / 2;
const fundamental = harmonic(nonlinear, 197, start, length);
const thirdLinear = harmonic(linear, 591, start, length);
const thirdNonlinear = harmonic(nonlinear, 591, start, length);
assert.ok(thirdNonlinear > thirdLinear * 5, `third harmonic: ${thirdNonlinear} vs ${thirdLinear}`);
assert.ok(thirdNonlinear / fundamental > 0.005, `third harmonic ratio: ${thirdNonlinear / fundamental}`);

const qExample = [0.006, -0.002], cExample = [0.6, 0.4];
assert.ok(Math.abs(vertexReadout(qExample, cExample, 5) - pooledReadout(qExample, cExample, 5)) > 1e-5);
close(vertexReadout(qExample, cExample, 0), pooledReadout(qExample, cExample, 0));
const stepperNonlinear = createLinearStepper(base({ drive: 4 }));
const qNonlinear = new Float64Array(4);
let separateVsPooled = 0;
for (let i = 0; i < input.length; i++) {
  stepperNonlinear.sample(input[i], qNonlinear);
  separateVsPooled = Math.max(separateVsPooled, Math.abs(nonlinear[i] - pooledReadout(qNonlinear, weights, 4)));
}
assert.ok(separateVsPooled > 1e-5, `separate vs pooled: ${separateVsPooled}`);

const alternative = renderWet(base({ drive: 4, edges: [[0, 1, 1], [1, 2, 1], [2, 3, 1]] }), input);
let topologyDifference = 0;
for (let i = 0; i < input.length; i++) topologyDifference = Math.max(topologyDifference, Math.abs(nonlinear[i] - alternative[i]));
assert.ok(topologyDifference > 1e-6, `topology difference: ${topologyDifference}`);

const mixed = combine(base({ drive: 4 }), nonlinear, input).audio;
assert.ok(mixed.every(Number.isFinite));
let peak = 0;
for (const sample of mixed) peak = Math.max(peak, Math.abs(sample));
assert.ok(peak <= .981, `clipping protection: ${peak}`);
const buffer = wav(mixed).bytes;
assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
assert.equal(buffer.toString('ascii', 8, 12), 'WAVE');
assert.equal(buffer.readUInt32LE(40), mixed.length * 2);

const longInput = new Float32Array(RATE * 31);
assert.equal(renderWet(base({ n: 1, edges: [], strike: 0, listen: 0 }), longInput).length, longInput.length);

console.log(`vertex-distortion: OK (3rd harmonic ratio ${(thirdNonlinear / fundamental).toFixed(3)}, topology Δ ${topologyDifference.toExponential(2)})`);
