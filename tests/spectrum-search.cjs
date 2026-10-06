const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const code=fs.readFileSync(require('node:path').join(__dirname,'../graph-timbres.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const context={module:{exports:{}},console,Blob};vm.createContext(context);vm.runInContext(code,context);
const {makeGraph,eigen,partials,synth,wavBlob,graphLaplacian,constructWeightedGraph,modalRatios,parseFrequencyRatios,makeSpectralMetric,connectedGraph,isomorphicGraphs,spectralWorkerSource}=context.module.exports;
for(const input of ['1:1.25:1.5','1 5/4 3/2','12,8,10'])assert.deepEqual(Array.from(parseFrequencyRatios(input)),[1,1.25,1.5]);
assert.deepEqual(Array.from(parseFrequencyRatios('2 2 4')),[1,1,2]);
assert.deepEqual(Array.from(parseFrequencyRatios('3')),[1]);
for(const input of ['', '1 0', '1 -2', '1 NaN', '1 1/0', '1 5//4', '1 9', '1 '.repeat(12)])assert.throws(()=>parseFrequencyRatios(input));
// Verify the physical edge model, including repeated frequencies and the maximum graph size.
for(const target of [[1],[1,1],[1,1.25,1.5],[1,2**(3/12),2**(7/12)],[1,2,3],[1,1.01,1.02],[1,1,2],[1,1.25,1.5,2],Array.from({length:11},(_,i)=>1+7*i/10)]){
  const built=constructWeightedGraph(Object.freeze(target)),L=graphLaplacian(built.n,built.edges);
  assert.equal(built.n,target.length+1);assert.equal(built.edges.length,built.n*(built.n-1)/2);
  assert(connectedGraph(built.n,built.edges));assert(built.edges.every(edge=>Number.isFinite(edge[2])&&edge[2]>0));
  L.forEach((row,i)=>{assert(Math.abs(row.reduce((sum,value)=>sum+value,0))<1e-10);row.forEach((value,j)=>assert.equal(value,L[j][i]));});
  const frequencies=eigen(L).filter(mode=>mode.lambda>1e-8).map(mode=>Math.sqrt(mode.lambda));
  assert.equal(frequencies.length,target.length);
  target.forEach((ratio,i)=>assert(Math.abs(1200*Math.log2(frequencies[i]/ratio))<1e-6));
  assert(built.maximumErrorCents<1e-6);
}
for(const target of [[],[0],[2],[1,NaN],[1,9],[1,2,1.5],Array(12).fill(1)])assert.throws(()=>constructWeightedGraph(target));
for(const edge of [[0,1,0],[0,1,-1],[0,1,NaN],[0,0,1],[0,2,1]])assert.throws(()=>graphLaplacian(2,[edge]));
const chain=makeGraph('path',4),cycle=makeGraph('cycle',4);
const target=modalRatios(4,chain.edges),metric=makeSpectralMetric(target,4);
assert(metric(target)<1e-12);
assert(metric(modalRatios(4,cycle.edges))>.01);
assert(connectedGraph(4,chain.edges));assert(!connectedGraph(4,[[0,1],[2,3]]));
assert(isomorphicGraphs(4,chain.edges,4,[[2,0],[0,3],[3,1]]));
assert(!isomorphicGraphs(4,chain.edges,4,cycle.edges));
assert(!isomorphicGraphs(4,chain.edges,3,[[0,1],[1,2]]));
assert(isomorphicGraphs(6,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]],6,[[3,1],[1,4],[4,0],[0,2],[2,5],[5,3]]));
// Same degree sequence, different topology: cycle vs two triangles.
assert(!isomorphicGraphs(6,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]],6,[[0,1],[1,2],[2,0],[3,4],[4,5],[5,3]]));
function workerSearch(input){return new Promise((resolve,reject)=>{
  const adapter=`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};parentPort.on('message',data=>self.onmessage({data}));\n`;
  const worker=new Worker(adapter+spectralWorkerSource(),{eval:true});
  const timer=setTimeout(()=>{worker.terminate();reject(new Error('Search timed out'));},5000);
  let last=Infinity;
  worker.on('error',reject);
  worker.on('message',data=>{
    if(data.best){assert(data.best.error<=last+1e-12);last=data.best.error;}
    if(data.type==='done'||data.type==='error'){clearTimeout(timer);worker.terminate();resolve(data);}
  });worker.postMessage(input);
});}
(async()=>{
  const built=constructWeightedGraph([1,1.25,1.5]),groups=partials(eigen(graphLaplacian(built.n,built.edges)),'spectrum',0,0,200);
  assert.equal(groups.length,3);groups.forEach((group,i)=>assert(Math.abs(group.f-[200,250,300][i])<1e-8));
  const {signal,peak}=synth(groups,44100,.2);assert(peak>0);
  const pcm=new DataView(await wavBlob(signal,44100).arrayBuffer());
  assert.equal(pcm.getUint32(24,true),44100);assert.equal(pcm.getUint16(34,true),16);
  // Measure the exported PCM at the requested frequencies and at the former incorrect peak.
  function magnitude(frequency){let real=0,imaginary=0;for(let i=0;i<signal.length;i++){const sample=pcm.getInt16(44+2*i,true)/32767,angle=2*Math.PI*frequency*i/44100;real+=sample*Math.cos(angle);imaginary+=sample*Math.sin(angle);}return Math.hypot(real,imaginary);}
  const unwanted=magnitude(200*Math.SQRT2);for(const frequency of [200,250,300])assert(magnitude(frequency)>3*unwanted);
  // Two connected unlabelled graphs exist on 3 nodes: path and triangle.
  const original={n:3,edges:[[0,1],[1,2]]};
  const result=await workerSearch({n:3,target:modalRatios(3,original.edges),seconds:1,original});
  assert.equal(result.type,'done');assert(result.best);assert.equal(result.best.edges.length,3);
  assert(!isomorphicGraphs(3,result.best.edges,3,original.edges));
  assert(connectedGraph(result.best.n,result.best.edges));
  assert(Math.abs(result.best.error-makeSpectralMetric(modalRatios(3,original.edges),3)(result.best.ratios))<1e-12);
  const fromTriangle=await workerSearch({n:3,target:[1,1],seconds:1,original:{n:3,edges:[[0,1],[1,2],[0,2]]}});
  assert.equal(fromTriangle.best.edges.length,2);
  // User-entered targets have no reference graph to exclude.
  const entered=await workerSearch({n:3,target:parseFrequencyRatios('1 1'),seconds:1,original:null});
  assert.equal(entered.type,'done');assert.equal(entered.best.edges.length,3);assert(entered.best.error<1e-9);
  const single=await workerSearch({n:2,target:parseFrequencyRatios('1'),seconds:1,original:null});
  assert.equal(single.type,'done');assert.equal(single.best.edges.length,1);assert(single.best.error<1e-9);
  const chordTarget=parseFrequencyRatios('1 5/4 3/2');
  const chord=await workerSearch({n:4,target:chordTarget,seconds:1,original:null});
  assert.equal(chord.type,'done');assert(connectedGraph(4,chord.best.edges));assert.equal(chord.best.ratios.length,3);
  assert(Math.abs(chord.best.error-makeSpectralMetric(chordTarget,4)(chord.best.ratios))<1e-12);
  for(const input of [{n:1,target:[1]}, {n:3,target:[2,3]}, {n:3,target:[1,9]}, {n:4,target:[1,2,1.5]}]){
    const invalid=await workerSearch({...input,seconds:1,original:null});assert.equal(invalid.type,'error');
  }
  console.log('PASS: exact weighted frequencies and multiplicity, positive spring weights, maximum graph size, exported audio frequencies, ratio validation, spectral metric, isomorphism, worker search, exclusion of original');
})().catch(err=>{console.error(err);process.exitCode=1;});
