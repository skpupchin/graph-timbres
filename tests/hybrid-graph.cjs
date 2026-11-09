const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','hybrid-graph.html'),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1],sandbox={module:{exports:{}},Blob,Float32Array,Float64Array,Uint16Array};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../hybrid-dsp.js'),'utf8'),sandbox);vm.runInContext(script,sandbox);const {RATE,renderWet,createStepper,mix,wav}=sandbox.module.exports;
const R=(f=440)=>({type:'R',freq:f,damping:80,drive:4}),N=(d=4)=>({type:'N',freq:440,damping:80,drive:d});
const base=(nodes,edges=[],extra={})=>({nodes,edges,input:0,output:nodes.length-1,delay:4,feedback:.7,tone:10000,wet:1,gain:1,...extra});
const sine=(f,sec=1)=>Float32Array.from({length:RATE*sec},(_,i)=>.8*Math.sin(2*Math.PI*f*i/RATE));
function amp(a,f,start=RATE/2,len=RATE/2){let x=0,y=0;for(let i=0;i<len;i++){let p=2*Math.PI*f*i/RATE;x+=a[start+i]*Math.cos(p);y+=a[start+i]*Math.sin(p);}return 2*Math.hypot(x,y)/len;}
let impulse=new Float32Array(RATE);impulse[0]=1;let response=renderWet(base([R()]),impulse);let early=0,late=0;for(let i=0;i<RATE/10;i++)early+=response[i]**2;for(let i=RATE/2;i<RATE*.6;i++)late+=response[i]**2;assert.ok(early>late*1e8,'damped response');
let on=amp(renderWet(base([R()]),sine(440)),440),off=amp(renderWet(base([R()]),sine(880)),880);assert.ok(on>off*10,`resonance ${on} ${off}`);
let linear=renderWet(base([N(0)]),sine(200)),nonlinear=renderWet(base([N(8)]),sine(200));assert.ok(amp(linear,600)<1e-7,'linear harmonics');assert.ok(amp(nonlinear,600)>.005,'nonlinear third harmonic');
let linearNetwork=renderWet(base([N(0),R(440),N(0)],[{a:0,b:1,m:1},{a:1,b:2,m:1}]),sine(200));assert.ok(amp(linearNetwork,600)<1e-6,'linear network adds no harmonics');
let edges=[{a:0,b:1,m:1},{a:1,b:2,m:1}],a=renderWet(base([R(220),N(8),R(440)],edges),sine(220)),b=renderWet(base([N(8),R(220),R(440)],edges),sine(220));assert.ok(a.some((v,i)=>Math.abs(v-b[i])>1e-4),'type order changes response');
let loop=base([R(220),N(8),R(440),N(0)],[...edges,{a:2,b:3,m:1},{a:3,b:0,m:1}],{feedback:.9}),st=createStepper(loop),peak=0;for(let i=0;i<RATE*5;i++){let x=st.sample(i<RATE?Math.sin(i*.1):0);assert.ok(Number.isFinite(x));peak=Math.max(peak,Math.abs(x));}assert.ok(peak<2,`bounded ${peak}`);
let mixed=mix(nonlinear,sine(200),1,2);assert.ok(Math.max(...mixed.slice(0,10000).map(Math.abs))<=.981);assert.equal((awaitBlob=wav(mixed)).size,44+mixed.length*2);
console.log(`hybrid: OK; resonance ratio ${(on/off).toFixed(1)}, third harmonic ${amp(nonlinear,600).toFixed(4)}, peak ${peak.toFixed(3)}`);

