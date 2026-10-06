const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const code=fs.readFileSync(require('node:path').join(__dirname,'../graph-timbres.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const context={module:{exports:{}},console};vm.createContext(context);vm.runInContext(code,context);
const {makeGraph,modalRatios,makeSpectralMetric,connectedGraph,isomorphicGraphs,spectralWorkerSource}=context.module.exports;
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
  // Two connected unlabelled graphs exist on 3 nodes: path and triangle.
  const original={n:3,edges:[[0,1],[1,2]]};
  const result=await workerSearch({n:3,target:modalRatios(3,original.edges),seconds:1,original});
  assert.equal(result.type,'done');assert(result.best);assert.equal(result.best.edges.length,3);
  assert(!isomorphicGraphs(3,result.best.edges,3,original.edges));
  assert(connectedGraph(result.best.n,result.best.edges));
  assert(Math.abs(result.best.error-makeSpectralMetric(modalRatios(3,original.edges),3)(result.best.ratios))<1e-12);
  const fromTriangle=await workerSearch({n:3,target:[1,1],seconds:1,original:{n:3,edges:[[0,1],[1,2],[0,2]]}});
  assert.equal(fromTriangle.best.edges.length,2);
  const invalid=await workerSearch({n:2,target:[1],seconds:1,original});assert.equal(invalid.type,'error');
  console.log('PASS: spectral distance, connectivity, graph isomorphism, worker search, monotonic best results, exclusion of original, input validation');
})().catch(err=>{console.error(err);process.exitCode=1;});
