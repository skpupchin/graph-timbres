const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),core=fs.readFileSync(path.join(root,'hybrid-dsp.js'),'utf8'),html=fs.readFileSync(path.join(root,'hybrid-live.html'),'utf8');
const worklet=html.match(/<script id="worklet" type="text\/plain">([\s\S]*?)<\/script>/)[1];
const graph={nodes:[{type:'R',freq:220,damping:80,drive:4},{type:'N',freq:440,damping:80,drive:4},{type:'R',freq:440,damping:80,drive:4}],edges:[{a:0,b:1,m:1},{a:1,b:2,m:1}],input:0,output:2,delay:1.5,feedback:0.65,tone:10000};
function environment(rate){
 const messages=[];
 class AudioWorkletProcessor{constructor(){this.port={postMessage:message=>messages.push(message),onmessage:null};}}
 const sandbox={sampleRate:rate,AudioWorkletProcessor,registerProcessor(name,processor){assert.equal(name,'hybrid-live');sandbox.Processor=processor;}};
 vm.createContext(sandbox);vm.runInContext(core,sandbox);vm.runInContext(worklet,sandbox);
 return {sandbox,messages,processor:new sandbox.Processor({processorOptions:{graph}})};
}
function params(values){return Object.fromEntries(Object.entries({muted:0,...values}).map(([key,value])=>[key,new Float32Array([value])]))}
function processBlock(processor,input,parameters){const output=new Float32Array(input.length);assert.equal(processor.process([[input]],[[output]],parameters),true);return output;}
const parameters=params({inputDb:0,wetDb:18,mix:0.5,outputDb:-18,bypass:0});
for(const rate of [44100,48000]){
 const initial=environment(rate),quiet=params({inputDb:24,wetDb:48,mix:1,outputDb:-60,bypass:1});
 assert.ok(Math.abs(processBlock(initial.processor,new Float32Array([0.2]),quiet)[0]-0.0002)<1e-9,'initial bypass and volume apply from the first sample');
 const transport=environment(rate),linear={...graph,nodes:graph.nodes.map(node=>({...node,type:'N',drive:0}))};
 const delayed=transport.sandbox.createHybridStepper(linear,rate),arrival=2*Math.round(rate*graph.delay/1000);
 for(let i=0;i<arrival;i++)assert.equal(delayed.sample(i===0?1:0),0,'no arrival before two edge delays');
 assert.ok(delayed.sample(0)>0,'edge delay uses the actual sample rate');
 const {sandbox,messages,processor}=environment(rate),step=sandbox.createHybridStepper(graph,rate);
 const input=Float32Array.from({length:rate},(_,i)=>0.2*Math.sin(2*Math.PI*220*i/rate)+0.1*Math.sin(2*Math.PI*440*i/rate));
 let position=0;
 for(const size of Array.from({length:Math.ceil(rate/64)},(_,i)=>[64,128,256][i%3])){
  if(position>=input.length)break;
  const chunk=input.subarray(position,Math.min(input.length,position+size)),output=processBlock(processor,chunk,parameters);
  for(let i=0;i<chunk.length;i++){
   const expected=(chunk[i]*0.5+step.sample(chunk[i])*10**(18/20)*0.5)*10**(-18/20);
   assert.ok(Math.abs(output[i]-expected)<1e-7,'streaming matches continuous graph at '+rate+' Hz');
  }
  position+=chunk.length;
 }
 assert.equal(position,rate);assert(messages.some(message=>message.type==='meters'&&message.input>0));
 const bypass=params({inputDb:24,wetDb:48,mix:1,outputDb:-18,bypass:1});
 for(let i=0;i<100;i++)processBlock(processor,new Float32Array(128).fill(0.2),bypass);
 const bypassOutput=processBlock(processor,new Float32Array(128).fill(0.2),bypass);
 assert.ok(Math.abs(bypassOutput[127]-0.2*10**(-18/20))<1e-7,'bypass ignores input and wet gains');
 const next={...graph,nodes:[{type:'N',freq:440,damping:80,drive:0}],edges:[],input:0,output:0};
 processor.port.onmessage({data:{graph:next}});
 assert(messages.some(message=>message.type==='applied'));
 for(let i=0;i<20;i++)assert(processBlock(processor,new Float32Array(128).fill(0.1),parameters).every(Number.isFinite));
 assert.equal(processor.previous,null,'old graph released after crossfade');
 const limit=params({inputDb:24,wetDb:48,mix:1,outputDb:6,bypass:0});
 for(let i=0;i<100;i++)assert(processBlock(processor,new Float32Array(128).fill(1),limit).every(value=>Math.abs(value)<=0.980001));
 assert(messages.some(message=>message.type==='meters'&&message.output>0.98),'limiting reported');
 processor.port.onmessage({data:{graph:{...graph,delay:0}}});
 assert(messages.some(message=>message.type==='error'),'invalid graph error reported');
 assert(processBlock(processor,new Float32Array(128).fill(1),parameters).every(value=>value===0),'fault silences output');
 const broken=environment(rate);
 processBlock(broken.processor,new Float32Array([NaN]),parameters);
 assert(broken.messages.some(message=>message.type==='error'),'invalid audio error reported');
 assert(processBlock(broken.processor,new Float32Array(128).fill(1),parameters).every(value=>value===0));
 const disconnected=environment(rate),silent=new Float32Array(128);
 disconnected.processor.process([[]],[[silent]],parameters);assert(silent.every(value=>value===0),'missing input is silent');
}
for(const rate of [44100,48000]){
 const {sandbox,messages}=environment(rate),delayedGraph={...graph,nodes:graph.nodes.slice(0,2).map(node=>({...node,type:'N',drive:0})),edges:[{a:0,b:1,m:1}],input:0,output:1,delay:100,feedback:0.65};
 const processor=new sandbox.Processor({processorOptions:{graph:delayedGraph}}),wet=params({inputDb:0,wetDb:0,mix:1,outputDb:0,bypass:0,muted:0});
 const frames=rate/5,input=Float32Array.from({length:frames},(_,i)=>i===0?0.2:0),result=processBlock(processor,input,wet),arrival=Math.round(rate*0.1);
 assert(result.subarray(0,arrival).every(value=>value===0),'100% wet contains no immediate dry guitar');assert(result[arrival]>0,'100% wet contains delayed graph output');
 processor.port.onmessage({data:{graph:{...delayedGraph,nodes:[delayedGraph.nodes[0]],edges:[],output:0}}});
 for(let i=0;i<100;i++)processBlock(processor,new Float32Array(128).fill(0.2),wet);
 const muted=params({inputDb:0,wetDb:0,mix:1,outputDb:0,bypass:0,muted:1});
 for(let i=0;i<100;i++)processBlock(processor,new Float32Array(128).fill(0.2),muted);
 assert(processBlock(processor,new Float32Array(128).fill(0.2),muted).every(value=>Math.abs(value)<1e-9),'app mute silences processed output');
 assert(messages.some(message=>message.type==='meters'&&message.wet>0.1),'wet meter reports processed signal');
}
for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
for(const rate of [44100,48000]){
 const {sandbox,messages}=environment(rate),saturationGraph={...graph,nodes:[{type:'N',freq:440,damping:80,drive:4}],edges:[],input:0,output:0};
 assert.equal(sandbox.Processor.parameterDescriptors.find(parameter=>parameter.name==='inputDb').maxValue,60,'worklet accepts the full input gain range');
 const processor=new sandbox.Processor({processorOptions:{graph:saturationGraph}}),quiet=params({inputDb:0,wetDb:0,mix:1,outputDb:0,bypass:0}),boosted=params({inputDb:60,wetDb:0,mix:1,outputDb:0,bypass:0});
 const input=Float32Array.from({length:128},(_,i)=>0.005*Math.sin(2*Math.PI*440*i/rate));
 const clean=processBlock(processor,input,quiet);
 for(let i=0;i<100;i++)processBlock(processor,input,boosted);
 const driven=processBlock(processor,input,boosted);
 assert.ok(Math.max(...clean.map(Math.abs))<0.0051,'quiet capture remains nearly linear without boost');
 assert.ok(Math.max(...driven.map(Math.abs))>0.24,'input gain drives saturation with quiet guitar');
 for(let i=0;i<input.length;i++)assert.ok(Math.abs(driven[i]-Math.tanh(4*input[i]*1000)/4)<1e-6,'boost precedes saturation without clipping graph input');
 assert(messages.some(message=>message.type==='meters'&&message.graphInput>4&&message.input<0.0051),'raw and boosted input meters report separate levels');
}
console.log('hybrid live: OK; streaming at 44.1/48 kHz, bypass, crossfade, limiter, meters, errors, disconnect silence');

async function checkInputDiscovery(){
 const elements=new Map();
 function makeElement(id){return {
  id,value:'',textContent:'',innerHTML:'',options:[],children:[],dataset:{},listeners:{},disabled:false,classList:{toggle(){}},
  addEventListener(name,handler){(this.listeners[name]??=[]).push(handler);},
  dispatch(name,fields){const event={type:name,target:this,button:0,pointerId:1,clientX:0,clientY:0,preventDefault(){},stopPropagation(){},...fields};for(const handler of this.listeners[name]||[])handler(event);},
  click(){if(!this.disabled&&this.onclick)return this.onclick({target:this});},
  setAttribute(name,value){this[name]=value;if(name==='data-node')this.dataset.node=value;},
  appendChild(element){this.children.push(element);return element;},
  replaceChildren(...children){this.children=children;this.options=children;},add(option){this.options.push(option);},
  setPointerCapture(){},createSVGPoint(){return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}};},getScreenCTM(){return {inverse(){return {};}};}
 };}
 const get=id=>{
  if(!elements.has(id))elements.set(id,makeElement(id));
  return elements.get(id);
 };
 for(const match of html.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*value="([^"]+)"/g))get(match[1]).value=match[2];
 get('preset').value='';get('addType').value='R';
 let capturing=false,enumerationError=false;
 const track={label:'Default',getSettings:()=>({deviceId:'default',sampleRate:48000}),stop(){capturing=false;}};
 const mediaDevices={
  async getUserMedia(constraints){assert.equal(constraints.audio.echoCancellation,false);capturing=true;return{getTracks:()=>[track],getAudioTracks:()=>[track]};},
  async enumerateDevices(){assert.equal(capturing,true,'enumeration keeps capture permission active');if(enumerationError)throw new Error('Enumeration failed');return [{kind:'audioinput',deviceId:'default',label:'Default'},{kind:'videoinput',deviceId:'camera',label:'Camera'}];}
 };
 const ui={DOMException,document:{getElementById:get,createElementNS:()=>makeElement(''),addEventListener(){},activeElement:{tagName:'BODY'}},window:{isSecureContext:true,addEventListener(){}},navigator:{mediaDevices,userAgent:'SamsungBrowser/test'},Option:function(text,value){return{text,value};}};
 vm.createContext(ui);vm.runInContext(core,ui);vm.runInContext(fs.readFileSync(path.join(root,'hybrid-editor.js'),'utf8'),ui);vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1],ui);
 const drawing=get('graph'),vertex=i=>drawing.children.find(element=>element.dataset.node===String(i));
 const change=(id,value)=>{get(id).value=String(value);get(id).onchange({target:get(id)});};
 assert.equal(ui.graphSettings().nodes.length,3);
 const tap=(i,time,extra={})=>{const fields={pointerType:'touch',timeStamp:time,...extra};vertex(i).dispatch('pointerdown',fields);drawing.dispatch('pointerup',{...fields,timeStamp:time+30});};
 get('tool-add').click();drawing.dispatch('pointerdown',{clientX:900,clientY:450});
 assert.equal(ui.graphSettings().nodes[3].type,'R','new vertices default to R');
 tap(3,100);tap(3,250);
 assert.equal(ui.graphSettings().nodes.length,4);assert.equal(ui.graphSettings().nodes[3].type,'N');change('drive',9);
 get('tool-edge').click();vertex(2).dispatch('pointerdown',{});vertex(3).dispatch('pointerdown',{});
 assert.equal(ui.graphSettings().edges.length,3);get('outputNode').click();
 vertex(1).dispatch('pointerdown',{});get('inputNode').click();
 assert.equal(ui.graphSettings().input,1);assert.equal(ui.graphSettings().output,3);
 drawing.children[6].dispatch('pointerdown',{});change('edgeMultiplier',2.5);
 assert.equal(ui.graphSettings().edges[2].m,2.5);
 get('tool-select').click();vertex(0).dispatch('pointerdown',{});change('freq',330);change('damping',120);
 assert.equal(ui.graphSettings().nodes[0].freq,330);assert.equal(ui.graphSettings().nodes[0].damping,120);
 change('freq','E4');assert.ok(Math.abs(ui.graphSettings().nodes[0].freq-329.6275569128699)<1e-9);assert.match(get('selection').innerHTML,/value="E4"/);
 change('freq','Db3');assert.ok(Math.abs(ui.graphSettings().nodes[0].freq-138.59131548843604)<1e-9);assert.match(get('selection').innerHTML,/value="C#3"/);
 change('freq','H4');assert.ok(Math.abs(ui.graphSettings().nodes[0].freq-138.59131548843604)<1e-9);
 change('freq',330);
 change('damping',500);change('freq',50);
 assert.equal(ui.graphSettings().nodes[0].freq,330,'invalid damping/frequency pair rejected');change('damping',120);
 const delivered=[];ui.forwardGraph=message=>delivered.push(message);
 vm.runInContext('session={context:{sampleRate:48000},processor:{port:{postMessage:forwardGraph}}}',ui);
 get('apply').click();assert.equal(delivered.length,1);const submitted=delivered[0].graph;
 assert.equal(submitted.nodes.length,4);assert.equal(submitted.nodes[3].drive,9);assert.equal(submitted.edges[2].m,2.5);assert.equal(submitted.input,1);assert.equal(submitted.output,3);
 assert.equal(ui.graphPathDelay(submitted,48000),5.25,'custom IN/OUT and edge multipliers determine path delay');
 const engine=environment(48000);engine.processor.port.onmessage({data:delivered[0]});
 for(let i=0;i<20;i++)assert(processBlock(engine.processor,new Float32Array(128).fill(0.1),parameters).every(Number.isFinite),'edited drawing runs in the live audio processor');
 vm.runInContext('session=null',ui);
 vertex(3).dispatch('pointerdown',{});change('drive',11);assert.equal(delivered[0].graph.nodes[3].drive,9,'draft edits do not alter applied snapshot');
 vertex(0).dispatch('pointerdown',{});drawing.dispatch('pointermove',{clientX:990,clientY:600});drawing.dispatch('pointerup',{});
 assert.equal(ui.graphSettings().nodes[0].x,970);assert.equal(ui.graphSettings().nodes[0].y,510);
 vertex(3).dispatch('pointerdown',{});get('delete').click();
 assert.equal(ui.graphSettings().nodes.length,3);assert.equal(ui.graphSettings().output,0);assert.equal(ui.graphSettings().edges.length,2);
 get('undo').click();assert.equal(ui.graphSettings().nodes.length,4);assert.equal(ui.graphSettings().output,3);assert.equal(ui.graphSettings().nodes[3].drive,11);
 get('clear').click();assert.equal(ui.graphSettings().nodes.length,1);get('undo').click();assert.equal(ui.graphSettings().nodes.length,4);
 vertex(0).dispatch('dblclick',{});assert.equal(ui.graphSettings().nodes[0].type,'N');get('undo').click();
 tap(0,1000);tap(0,1150);assert.equal(ui.graphSettings().nodes[0].type,'N','double tap switches R to N');
 vertex(0).dispatch('dblclick',{timeStamp:1200});assert.equal(ui.graphSettings().nodes[0].type,'N','synthetic double click does not switch back');
 tap(0,1500);tap(0,1650);assert.equal(ui.graphSettings().nodes[0].type,'R','double tap switches N to R');
 get('undo').click();assert.equal(ui.graphSettings().nodes[0].type,'N','undo restores type');get('undo').click();
 tap(0,2000);tap(0,2500);assert.equal(ui.graphSettings().nodes[0].type,'R','slow taps do not toggle');
 tap(1,2600);assert.equal(ui.graphSettings().nodes[1].type,'N','taps on different vertices do not toggle');
 vertex(0).dispatch('pointerdown',{pointerType:'touch',timeStamp:3000});drawing.dispatch('pointercancel',{pointerType:'touch',timeStamp:3010});tap(0,3100);
 assert.equal(ui.graphSettings().nodes[0].type,'R','cancelled tap does not count');
 vertex(0).dispatch('pointerdown',{pointerType:'touch',timeStamp:3200});drawing.dispatch('pointermove',{clientX:600,clientY:400});drawing.dispatch('pointerup',{pointerType:'touch',timeStamp:3230});tap(0,3300);
 assert.equal(ui.graphSettings().nodes[0].type,'R','drag does not count as tap');
 // Pointer capture sends pointerup and the resulting click to the SVG root,
 // so a native dblclick listener on the vertex is insufficient on desktop.
 tap(0,4000,{pointerType:'mouse',clientX:600,clientY:400});
 tap(0,4200,{pointerType:'mouse',clientX:600,clientY:400});
 assert.equal(ui.graphSettings().nodes[0].type,'N','captured mouse double click switches type without a vertex dblclick event');
 vertex(0).dispatch('dblclick',{pointerType:'mouse',timeStamp:4250});
 assert.equal(ui.graphSettings().nodes[0].type,'N','native mouse dblclick does not toggle twice');
 get('undo').click();assert.equal(ui.graphSettings().nodes[0].type,'R','mouse type switch can be undone');
 tap(0,5000,{pointerType:'mouse',clientX:600,clientY:400});
 tap(0,5700,{pointerType:'mouse',clientX:600,clientY:400});
 assert.equal(ui.graphSettings().nodes[0].type,'R','separate mouse clicks do not toggle');
 for(let i=4;i<24;i++)drawing.dispatch('pointerdown',{clientX:500,clientY:280});
 assert.equal(ui.graphSettings().nodes.length,24);drawing.dispatch('pointerdown',{clientX:500,clientY:280});assert.equal(ui.graphSettings().nodes.length,24);assert.match(get('graphStatus').textContent,/Maximum 24/);
 get('clear').click();vertex(0).dispatch('pointerdown',{});get('delete').click();assert.equal(ui.graphSettings().nodes.length,1);assert.match(get('graphStatus').textContent,/at least one/);
 const beforePreset=ui.graphSettings();
 change('preset','drive');let preset=ui.graphSettings();
 assert.equal(preset.nodes.length,1);assert.equal(preset.nodes[0].type,'N');assert.equal(preset.nodes[0].drive,6);assert.equal(preset.edges.length,0);assert.equal(preset.input,0);assert.equal(preset.output,0);
 for(const [name,delay] of [['reverb',25],['echo',100]]){
  change('preset',name);preset=ui.graphSettings();assert.equal(preset.nodes.length,5);assert.equal(preset.edges.length,10);
  assert(preset.nodes.every(node=>node.type==='N'&&node.drive===0));assert(preset.edges.every(edge=>edge.m===1));
  assert.equal(preset.delay,delay);assert.equal(preset.feedback,.9);assert.equal(get('delayValue').textContent,delay+' ms');assert.equal(get('feedbackValue').textContent,'90%');
  const audio=environment(48000);audio.processor.port.onmessage({data:{type:'graph',graph:preset}});
  for(let i=0;i<100;i++)assert(processBlock(audio.processor,new Float32Array(128).fill(.1),parameters).every(Number.isFinite));
 }
 get('undo').click();assert.equal(ui.graphSettings().delay,25,'undo restores preset delay');
 get('undo').click();assert.equal(ui.graphSettings().nodes.length,1);assert.equal(ui.graphSettings().feedback,.65);
 get('undo').click();assert.deepEqual(ui.graphSettings(),beforePreset,'undo restores graph and network settings together');
 change('preset','irregular-reverb');preset=ui.graphSettings();
 assert.equal(preset.nodes.length,4);assert.equal(preset.edges.length,6);
 assert(preset.nodes.every(node=>node.type==='N'&&node.drive===0));
 assert.equal(new Set(preset.edges.map(edge=>edge.m)).size,6,'all irregular reverb edges have different delays');
 assert.equal(new Set(preset.edges.map(edge=>[edge.a,edge.b].sort().join(':'))).size,6,'complete four-vertex graph');
 assert.equal(preset.delay,70);assert.equal(preset.feedback,.9);
 for(const rate of [44100,48000]){
  const audio=environment(rate);audio.processor.port.onmessage({data:{graph:preset}});
  assert(audio.messages.some(message=>message.type==='applied'));
  for(let i=0;i<100;i++)assert(processBlock(audio.processor,new Float32Array(128).fill(.1),parameters).every(Number.isFinite));
 }
 get('undo').click();assert.deepEqual(ui.graphSettings(),beforePreset,'irregular preset can be undone');
 change('preset','mixed');preset=ui.graphSettings();assert.equal(preset.nodes.length,4);assert.equal(preset.edges.length,4);
 assert.equal(preset.nodes.filter(node=>node.type==='R').length,1);assert.equal(preset.nodes.find(node=>node.type==='R').freq,330);get('apply').click();
 assert.equal(ui.graphPathDelay({...ui.graphSettings(),edges:[]},48000),Infinity,'disconnected IN/OUT reported');
 console.log('hybrid editor: OK; add, connect, node/edge parameters, IN/OUT, live apply, drag, delete, undo, presets, limits');
 await ui.findInputs();
 assert.equal(capturing,false,'discovery releases capture afterwards');
 assert(get('device').options.some(option=>option.value==='__android_default__'),'system input remains explicitly selectable with a generic browser list');
 assert.equal(get('device').options.length,3,'camera excluded');
 assert.match(get('discovery').textContent,/SamsungBrowser\/test/);assert.match(get('discovery').textContent,/Default capture opened: Default/);
 assert.match(get('status').textContent,/did not list a named USB input/);
 assert.equal('deviceId' in ui.captureConstraints('__android_default__').audio,false,'system route omits a device constraint');
 assert.equal(ui.captureConstraints('spark-id').audio.deviceId.exact,'spark-id','named device stays an exact selection');
 const sinks=[],outputContext={async setSinkId(id){sinks.push(id);}};
 await ui.routeOutput(outputContext,'tablet-speaker');await ui.routeOutput(outputContext,'');
 assert.deepEqual(sinks,['tablet-speaker',''],'explicit speaker and system default use their actual IDs');
 await assert.rejects(ui.routeOutput({},'tablet-speaker'),{name:'NotSupportedError'});
 await assert.rejects(ui.routeOutput({async setSinkId(){throw new DOMException('Permission denied','NotAllowedError');}},'tablet-speaker'),{name:'NotAllowedError'});
 assert.match(get('outputStatus').textContent,/cannot select Web Audio speakers/);
 class RoutingContext{
  constructor(){this.state='suspended';this.audioWorklet={};}
  async resume(){this.state='running';}
  async setSinkId(){throw new DOMException('Speaker unavailable','NotFoundError');}
  async close(){this.state='closed';}
 }
 ui.AudioContext=RoutingContext;ui.window.AudioContext=RoutingContext;ui.window.AudioWorkletNode=function(){};
 get('device').value='__android_default__';get('outputDevice').value='tablet-speaker';
 await ui.startAudio();
 assert.equal(capturing,false,'routing failure releases input');assert.match(get('status').textContent,/Speaker unavailable/);
 get('outputDevice').value='';
 enumerationError=true;await ui.findInputs();
 assert.equal(capturing,false,'failed discovery releases capture');assert.match(get('status').textContent,/Enumeration failed/);
 console.log('hybrid live discovery: OK; active enumeration, explicit system route, named selection, diagnostics, output routing, routing errors, cleanup');
}
checkInputDiscovery().catch(error=>{console.error(error);process.exitCode=1;});
