const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(require('node:path').join(__dirname,'../graph-timbres.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const sandbox={module:{exports:{}},console,Blob};vm.createContext(sandbox);vm.runInContext(code,sandbox);
const {eigen,partials,synth,buildGraphImpulseResponse,gyroMatrix,createGyroStepper,buildGyroImpulseResponse,graphLaplacian,replaceEdgeWeight,removeVertexEdges,wavBlob}=sandbox.module.exports;
const close=(actual,expected,tolerance=1e-9)=>assert(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const energy=stepper=>{
  const u=stepper.u,v=stepper.v,K=stepper.K;
  let E=0;for(let i=0;i<u.length;i++){E+=v[i]*v[i];for(let j=0;j<u.length;j++)E+=u[i]*K[i][j]*u[j];}
  return E/2;
};
const edges=[[0,1,1.3],[1,2,.8],[2,0,1.1]],L=graphLaplacian(3,edges),a=180,g=.7,rate=8000;
const G=gyroMatrix(3,edges,a,g);
for(let i=0;i<3;i++)for(let j=0;j<3;j++)close(G[i][j],-G[j][i]);
close(G[0][1],-2*Math.PI*a*g);close(G[1][0],2*Math.PI*a*g);

const undamped=createGyroStepper(L,edges,a,g,Infinity,rate,0),start=energy(undamped);
for(let n=0;n<4000;n++){undamped.step();close(energy(undamped),start,2e-10);}
const damped=createGyroStepper(L,edges,a,g,.4,rate,0);let previous=energy(damped);
for(let n=0;n<4000;n++){damped.step();const current=energy(damped);assert(current<=previous+2e-12);previous=current;}

const tau=.35,analyticRate=128000,zero=createGyroStepper(L,edges,a,0,tau,analyticRate,0),modes=eigen(L);
for(let n=0;n<40000;n++){
  if(n%1600===0){
    const t=n/analyticRate,analytic=modes.reduce((sum,mode)=>{
      const omega=2*Math.PI*a*Math.sqrt(mode.lambda+.01),alpha=1/tau,wd=Math.sqrt(omega*omega-alpha*alpha);
      return sum+mode.v[0]*mode.v[2]*Math.exp(-alpha*t)*Math.sin(wd*t)/wd;
    },0);
    close(zero.sample(2),analytic,2e-6);
  }
  zero.step();
}

const reversed=edges.map(([i,j,w])=>[j,i,w]),h02=buildGyroImpulseResponse(L,edges,a,g,.25,rate,0,2),h20=buildGyroImpulseResponse(L,reversed,a,g,.25,rate,2,0),h02reversed=buildGyroImpulseResponse(L,reversed,a,g,.25,rate,0,2);
let difference=0;
for(let n=0;n<h02.length;n++){close(h02[n],h20[n],2e-8);difference=Math.max(difference,Math.abs(h02[n]-h02reversed[n]));}
assert(difference>1e-5,`Обращение стрелок не изменило отклик: ${difference}`);

const changed=replaceEdgeWeight(edges,0,2.5);assert.deepEqual(Array.from(changed[0]),[0,1,2.5]);
const remapped=removeVertexEdges([[3,1,2],[2,3,.5],[0,2,1]],0);assert.deepEqual(Array.from(remapped,edge=>Array.from(edge)),[[2,0,2],[1,2,.5]]);
assert.deepEqual(JSON.parse(JSON.stringify({edges:reversed})).edges,[[1,0,1.3],[2,1,.8],[0,2,1.1]]);
const spring=partials(eigen(L),'response',0,2,a),legacy=buildGraphImpulseResponse(spring,rate,.25);
assert(legacy.some(value=>value!==0));assert(synth(spring,rate,.25).signal.some(value=>value!==0));
(async()=>{const wav=new DataView(await wavBlob(h02,rate).arrayBuffer());assert.equal(wav.getUint16(22,true),1);assert.equal(wav.getUint32(24,true),rate);assert.equal(wav.getUint32(40,true),h02.length*2);console.log('PASS: gyro energy, damping, analytic limit, reciprocity, direction, edge edits, legacy sound, WAV');})().catch(err=>{console.error(err);process.exitCode=1;});
