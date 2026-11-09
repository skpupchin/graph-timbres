'use strict';
/** @typedef {{type: 'R'|'N', freq: number, damping: number, drive: number}} HybridNode */
/** @typedef {{a: number, b: number, m: number}} HybridEdge */
/** @typedef {{nodes: HybridNode[], edges: HybridEdge[], input: number, output: number, delay: number, feedback: number, tone: number}} HybridGraph */
/** @typedef {{sample: (input: number) => number}} HybridStepper */
/** @param {number} rate @returns {Record<'R'|'N', (node: HybridNode) => (input: number) => number>} */
function createHybridProcessors(rate){
return {
 N(node){const drive=node.drive;return u=>drive===0?u:Math.tanh(drive*u)/drive;},
 R(node){const w=2*Math.PI*node.freq,g=node.damping,dt=1/rate,wd=Math.sqrt(w*w-g*g),e=Math.exp(-g*dt),s=Math.sin(wd*dt)/wd,c=Math.cos(wd*dt),a=e*(c+g*s),b=e*w*s,d=e*(c-g*s);let x=0,v=0;return u=>{const equilibrium=2*g*u/w, dx=x-equilibrium,nx=equilibrium+a*dx+b*v,nv=-b*dx+d*v;x=nx;v=nv;return v;};}
};
}
/** @param {HybridGraph} p @param {number} rate @returns {HybridStepper} */
function createHybridStepper(p,rate){
 if(!Number.isFinite(rate)||rate<=36000)throw RangeError("Audio sample rate must exceed 36 kHz");
 const processors=createHybridProcessors(rate);
 if(!p.nodes.length||p.nodes.length>24||!Number.isInteger(p.input)||!Number.isInteger(p.output)||p.input<0||p.output<0||p.input>=p.nodes.length||p.output>=p.nodes.length||!(p.delay>=1&&p.delay<=150)||!(p.feedback>=0&&p.feedback<=.9)||!(p.tone>=500&&p.tone<=18000))throw Error('Недопустимые параметры сети');
 const n=p.nodes.length, degree=new Uint16Array(n),arrival=new Float64Array(n),filtered=new Float64Array(n),z=new Float64Array(n),links=[],seen=new Set();
 const nodes=p.nodes.map(v=>{if(!processors[v.type]||(v.type==='R'&&(!(v.freq>=50&&v.freq<=4000)||!(v.damping>=1&&v.damping<=500)||v.damping>=2*Math.PI*v.freq))||(v.type==='N'&&!(v.drive>=0&&v.drive<=20)))throw Error('Недопустимые параметры вершины');return processors[v.type](v);});
 for(const edge of p.edges){const {a,b,m}=edge,key=[Math.min(a,b),Math.max(a,b)].join(':');if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=n||b>=n||a===b||!(m>=.1&&m<=4)||seen.has(key))throw Error('Недопустимое ребро');seen.add(key);degree[a]++;degree[b]++;const length=Math.max(1,Math.round(rate*p.delay*m/1000));links.push({from:a,to:b,buf:new Float32Array(length),pos:0},{from:b,to:a,buf:new Float32Array(length),pos:0});}
 const alpha=Math.exp(-2*Math.PI*p.tone/rate);
 return {sample(input){if(!Number.isFinite(input))throw Error('Некорректный вход');arrival.fill(0);for(const l of links)arrival[l.to]+=l.buf[l.pos];for(let i=0;i<n;i++){filtered[i]=alpha*filtered[i]+(1-alpha)*(degree[i]?arrival[i]/degree[i]:0);z[i]=nodes[i](p.feedback*filtered[i]+(i===p.input?input:0));if(!Number.isFinite(z[i]))throw Error('Сеть потеряла устойчивость');}for(const l of links){l.buf[l.pos]=z[l.from];l.pos=(l.pos+1)%l.buf.length;}return z[p.output];}};
}
