const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const script=fs.readFileSync(require('node:path').join(__dirname,'../graph-timbres.html'),'utf8').split('<script>')[1].split('</script>')[0];
const elements=new Map();let downloads=0,lastBufferPeak=0;
class Element{
  constructor(id=''){this.id=id;this.dataset={};this.style={};this.attrs={};this.listeners={};this.children=[];this.value='';this.files=[];this.disabled=false;this.hidden=false;this.parentElement=this;}
  addEventListener(name,listener){(this.listeners[name]??=[]).push(listener);}
  async dispatch(name){for(const listener of this.listeners[name]||[])await listener({target:this});}
  setAttribute(name,value){this.attrs[name]=String(value);}
  getAttribute(name){return this.attrs[name]??null;}
  appendChild(child){this.children.push(child);return child;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  before(){}
  remove(){}
  querySelector(){return new Element();}
  querySelectorAll(){return [];}
  closest(){return new Element();}
  click(){downloads++;}
}
const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
for(const [id,value] of Object.entries({scale:'220',decay:'1',volume:'35',mix:'50',gyroStrength:'0',searchSource:'ratios',searchRatios:'1:1.25:1.5'}))get(id).value=value;
const document={getElementById:get,createElement:()=>new Element(),createElementNS:()=>new Element(),querySelector:()=>new Element(),activeElement:null};
class MockAudioContext{
  constructor(){this.sampleRate=8000;this.currentTime=0;this.destination={};}
  async resume(){}
  createBuffer(){return{copyToChannel(samples){lastBufferPeak=samples.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);}};}
  createBufferSource(){return{connect(node){return node;},start(){},stop(){},disconnect(){},onended:null};}
  createGain(){return{gain:{value:0,setTargetAtTime(){}},connect(node){return node;},disconnect(){}};}
  createConvolver(){return{connect(node){return node;},disconnect(){}};}
  createDynamicsCompressor(){return{threshold:{value:0},knee:{value:0},ratio:{value:0},connect(node){return node;},disconnect(){}};}
  async decodeAudioData(){return{sampleRate:8000,length:16,duration:.002,numberOfChannels:1};}
}
class MockOfflineAudioContext extends MockAudioContext{
  constructor(channels,frames,rate){super();this.sampleRate=rate;this.frames=frames;}
  async startRendering(){return{getChannelData:()=>new Float32Array(this.frames)};}
}
const sandbox={document,window:{AudioContext:MockAudioContext,OfflineAudioContext:MockOfflineAudioContext},console,Blob,URL:{createObjectURL:()=>`blob:test`,revokeObjectURL(){}},setTimeout:()=>1,clearTimeout:()=>{}};
vm.createContext(sandbox);vm.runInContext(script,sandbox);
(async()=>{
  await get('response').dispatch('click');await get('play').dispatch('click');
  assert.equal(get('stop').disabled,false);await get('stop').dispatch('click');assert.equal(get('stop').disabled,true);
  await get('gyroModel').dispatch('click');assert.equal(get('spectrum').disabled,true);
  await get('play').dispatch('click');assert.equal(get('stop').disabled,false);assert(lastBufferPeak*.35>.1,`Гироскопический удар слишком тихий: ${lastBufferPeak*.35}`);await get('stop').dispatch('click');
  await get('download').dispatch('click');assert.equal(downloads,1);
  await get('springModel').dispatch('click');await get('spectrum').dispatch('click');await get('play').dispatch('click');assert.equal(get('stop').disabled,false);await get('stop').dispatch('click');
  await get('download').dispatch('click');assert.equal(downloads,2);
  await get('resonator').dispatch('click');get('audioFile').files=[{name:'sample.wav',arrayBuffer:async()=>new ArrayBuffer(0)}];await get('audioFile').dispatch('change');
  await get('play').dispatch('click');assert.equal(get('stop').disabled,false);await get('stop').dispatch('click');
  await get('download').dispatch('click');assert.equal(downloads,3);
  await get('gyroModel').dispatch('click');await get('play').dispatch('click');assert.equal(get('stop').disabled,false);await get('stop').dispatch('click');
  await get('download').dispatch('click');assert.equal(downloads,4);
  console.log('PASS: spring and gyro Play/Stop, mode switch, response and resonator WAV export');
})().catch(err=>{console.error(err);process.exitCode=1;});
