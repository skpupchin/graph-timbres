const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(require('node:path').join(__dirname,'../graph-timbres.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const sandbox={module:{exports:{}},console,Blob};vm.createContext(sandbox);vm.runInContext(code,sandbox);
const {makeGraph,eigen,partials,buildGraphImpulseResponse,wavBlobChannels}=sandbox.module.exports;
const rate=8000,tau=.2;
function response(shape,i=0,j=2){const graph=makeGraph(shape,4);return buildGraphImpulseResponse(partials(eigen(graph.L),'response',i,j,220),rate,tau);}
function distance(a,b){let sum=0;for(let n=0;n<a.length;n++)sum+=(a[n]-b[n])**2;return Math.sqrt(sum/a.length);}
const chain=response('path'),cycle=response('cycle'),star=response('star');
assert(distance(chain,cycle)>1e-7);
assert(distance(chain,star)>1e-7);
assert(distance(response('path',0,2),response('path',0,1))>1e-7);
const shorter=buildGraphImpulseResponse(partials(eigen(makeGraph('path',4).L),'response',0,2,220),rate,.2);
const longer=buildGraphImpulseResponse(partials(eigen(makeGraph('path',4).L),'response',0,2,220),rate,.5);
assert(longer.length>shorter.length);
assert(longer.every(Number.isFinite));
assert.equal(buildGraphImpulseResponse([],rate,2).length,8*rate);
assert(buildGraphImpulseResponse([],rate,2).every(value=>value===0));
const original=partials(eigen(makeGraph('path',4).L),'response',0,2,220);
const doubled=original.map(group=>({...group,amplitude:group.amplitude*2}));
const a=buildGraphImpulseResponse(original,rate,tau),b=buildGraphImpulseResponse(doubled,rate,tau);
assert(a.some(value=>value!==0));
for(let n=0;n<a.length;n++)assert(Math.abs(b[n]-2*a[n])<1e-7);
(async()=>{
  const pcm=new DataView(await wavBlobChannels([new Float32Array([.5,-1]),new Float32Array([-.5,1])],rate).arrayBuffer());
  assert.equal(pcm.getUint16(22,true),2);
  assert.equal(pcm.getUint32(24,true),rate);
  assert.equal(pcm.getUint32(28,true),rate*4);
  assert.equal(pcm.getUint32(40,true),8);
  assert.deepEqual([0,1,2,3].map(n=>pcm.getInt16(44+n*2,true)),[16383,-16383,-32767,32767]);
  assert.throws(()=>wavBlobChannels([new Float32Array(2),new Float32Array(1)],rate));
  console.log('PASS: distinct graph and vertex responses, decay duration, zero response, fixed gain, stereo WAV');
})().catch(err=>{console.error(err);process.exitCode=1;});
