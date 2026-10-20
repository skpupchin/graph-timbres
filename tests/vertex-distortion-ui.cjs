const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'vertex-distortion.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements = new Map();
let downloads = 0, starts = 0, stops = 0;
class Element {
  constructor(id = '') {
    this.id = id; this.value = ''; this.valueAsNumber = 0; this.children = [];
    this.dataset = {}; this.attrs = {}; this.style = {}; this.files = []; this.disabled = false;
    this.hidden = false; this.listeners = {}; this.width = 900; this.height = 230;
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attrs[name] = value; if (name === 'data-node') this.dataset.node = value; }
  createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return this; } }; }
  getScreenCTM() { return { inverse() { return this; } }; }
  setPointerCapture() {}
  remove() {}
  click() { downloads++; }
  getContext() {
    return { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} };
  }
}
const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
for (const [id, value] of Object.entries({ drive: 4, width: 50, scale: 180, damping: .2,
  wet: 85, gain: 100, impulse: 1 })) get(id).value = String(value);
const document = {
  getElementById: get, createElement: () => new Element(), createElementNS: () => new Element(),
  body: { append() {} }
};
class AudioContext {
  constructor() { this.currentTime = 0; this.destination = {}; }
  async resume() {}
  createBuffer(channels, length) { return { length, copyToChannel(samples) { assert.equal(samples.length, length); } }; }
  createBufferSource() {
    return { connect() {}, start() { starts++; }, stop() { stops++; }, disconnect() {}, onended: null };
  }
  async decodeAudioData() {
    const samples = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / 22050));
    return { sampleRate: 22050, length: samples.length, duration: samples.length / 22050,
      numberOfChannels: 1, getChannelData: () => samples };
  }
}
const sandbox = { document, window: { AudioContext }, Blob,
  URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} },
  setTimeout: fn => { fn(); return 1; }, clearTimeout() {} };
vm.runInNewContext(script, sandbox);

(async () => {
  const graph = get('graph');
  const nodeTarget = index => ({ closest: () => ({ dataset: { node: String(index) } }) });
  const fire = (type, event) => graph.listeners[type][0](event);
  const waitForStart = async previous => {
    for (let attempt = 0; attempt < 200 && starts <= previous; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(starts > previous, 'impulse played automatically after choosing a vertex');
  };
  get('hearMode').onclick();
  let previousStarts = starts;
  fire('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 160, target: nodeTarget(1) });
  fire('pointerup', { pointerId: 1 });
  await waitForStart(previousStarts);
  assert.match(get('graphInfo').textContent, /вход 2, центр 3/);
  previousStarts = starts;
  fire('contextmenu', { preventDefault() {}, target: nodeTarget(0) });
  await waitForStart(previousStarts);
  assert.match(get('graphInfo').textContent, /вход 2, центр 1/);
  get('editMode').onclick();
  fire('pointerdown', { button: 0, pointerId: 2, clientX: 100, clientY: 160, target: nodeTarget(0) });
  fire('pointermove', { pointerId: 2, clientX: 130, clientY: 180 });
  fire('pointerup', { pointerId: 2 });
  const vertexX = () => graph.children.find(child => child.dataset.node === 0).children.find(child => child.attrs.r === 18).attrs.cx;
  assert.equal(vertexX(), 130, 'drag moved vertex');
  get('undo').onclick();
  assert.equal(vertexX(), 100, 'undo restored vertex');
  const slider = get('edgeRows').children[0].children[1];
  slider.value = '2.5';
  slider.oninput();
  assert.equal(get('edgeRows').children[0].children[2].value, '2.5', 'slider updates numeric value');
  slider.onchange();
  get('undo').onclick();
  assert.equal(get('edgeRows').children[0].children[2].value, '1', 'undo restored stiffness');
  await get('render').onclick();
  assert.ok(starts > 0, 'impulse played');
  assert.equal(get('replay').disabled, false);
  assert.equal(get('save').disabled, false);
  get('save').onclick();
  assert.equal(downloads, 1, 'impulse WAV exported');
  get('stop').onclick();
  assert.ok(stops > 0, 'Stop stopped audio');
  get('fileMode').onclick();
  get('audioFile').files = [{ name: 'tone.wav', arrayBuffer: async () => new ArrayBuffer(0) }];
  await get('audioFile').onchange();
  await get('render').onclick();
  assert.ok(starts > 1, 'file result played');
  get('save').onclick();
  assert.equal(downloads, 2, 'file WAV exported');
  assert.match(get('status').textContent, /WAV скачан/);
  get('stop').onclick();
  console.log('vertex-distortion UI: OK (selection, drag/undo, stiffness slider, impulse, file, Play/Stop, WAV)');
})().catch(error => { console.error(error); process.exitCode = 1; });
