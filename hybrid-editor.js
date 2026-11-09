'use strict';
/** @typedef {HybridNode & {x: number, y: number}} HybridVertex */
/** @typedef {{nodes: HybridVertex[], edges: HybridEdge[], input: number, output: number}} HybridDrawing */
/** @typedef {{kind: 'node'|'edge', i: number}} HybridSelection */
/** @typedef {{i: number, startX: number, startY: number, moved: boolean}} HybridDrag */
/** @typedef {{getGraph: () => HybridDrawing, replaceGraph: (graph: HybridDrawing) => void, refresh: () => void, refreshPanel: () => void}} HybridEditor */
const hybridEditorText={
 en:{parameters:'Parameters',choose:'Select a vertex or edge.',node:'Vertex',edge:'Edge',type:'Type',resonator:'resonator',nonlinear:'saturation',frequency:'Frequency, Hz',damping:'Damping, 1/s',drive:'Drive',linear:'Drive 0 is linear.',input:'Set IN',output:'Set OUT',multiplier:'Delay multiplier',delay:'Delay in each direction',second:'Select the second vertex to add or remove an edge.',maximum:'Maximum 24 vertices.',minimum:'Keep at least one vertex.',invalid:'Invalid parameter. Check the range and ensure damping is less than 2π × frequency.',hint:'Tap empty space to add; drag vertices to move. Connect: tap two vertices. Double-tap a vertex to switch R/N.',connect:'Tap two vertices to add or remove an edge.',cleared:'Selection cleared.'},
 ru:{parameters:'Параметры',choose:'Выберите вершину или ребро на графе.',node:'Вершина',edge:'Ребро',type:'Тип',resonator:'резонатор',nonlinear:'преобразователь',frequency:'Частота, Гц',damping:'Затухание, 1/с',drive:'Drive',linear:'Drive 0 — линейный режим.',input:'Сделать входом',output:'Сделать выходом',multiplier:'Множитель задержки',delay:'Задержка в каждую сторону',second:'Выберите вторую вершину для ребра.',maximum:'Максимум 24 вершины.',minimum:'Нужна хотя бы одна вершина.',invalid:'Недопустимый параметр. Проверьте диапазон; затухание должно быть меньше 2π × частота.',hint:'Пустое место: добавить вершину · перетаскивание: переместить · ребро: две вершины · двойной клик: R/N.',connect:'Нажмите на две вершины: добавить или убрать ребро.',cleared:'Выбор сброшен.'}
};
/** @param {'R'|'N'} type @param {number} x @param {number} y @param {number} freq @returns {HybridVertex} */
function createHybridVertex(type,x,y,freq){return {type,x,y,freq,damping:80,drive:4};}
/** @param {string} name @returns {HybridDrawing} */
function createHybridPreset(name){
 const r=(x,y,freq)=>createHybridVertex('R',x,y,freq),n=(x,y)=>createHybridVertex('N',x,y,440);
 const presets={
  r:()=>[r(210,280,220),r(500,280,440),r(790,280,660)],
  n:()=>[n(210,280),n(500,280),n(790,280)],
  rnr:()=>[r(210,280,220),n(500,280),r(790,280,440)],
  nrr:()=>[n(210,280),r(500,280,220),r(790,280,440)],
  loop:()=>[r(250,280,220),n(500,120),r(750,280,440),n(500,440)],
  'single-r':()=>[r(500,280,220)],'single-n':()=>[n(500,280)]
 };
 if(!Object.hasOwn(presets,name))throw new RangeError('Unknown graph preset: '+name);
 const nodes=presets[name](),edges=nodes.slice(1).map((_,i)=>({a:i,b:i+1,m:1}));
 if(name==='loop')edges.push({a:3,b:0,m:1});
 return {nodes,edges,input:0,output:name==='loop'?2:nodes.length-1};
}
/** @param {HybridDrawing} graph @returns {HybridDrawing} */
function copyHybridDrawing(graph){return {nodes:graph.nodes.map(node=>({...node})),edges:graph.edges.map(edge=>({...edge})),input:graph.input,output:graph.output};}
/**
 * Mount the graph editor used by the offline lab and live processor.
 * @param {(id: string) => HTMLElement} get
 * @param {HybridDrawing} initialGraph
 * @param {() => number} getDelay
 * @param {(graph: HybridDrawing) => void} onChange
 * @param {(message: string) => void} onStatus
 * @param {typeof hybridEditorText.en} text
 * @returns {HybridEditor}
 */
function createHybridEditor(get,initialGraph,getDelay,onChange,onStatus,text){
 let graph=copyHybridDrawing(initialGraph),tool='select',edgeStart=null;
 /** @type {HybridSelection|null} */
 let selection=null;
 /** @type {HybridDrag|null} */
 let drag=null;
 /** @type {HybridDrawing[]} */
 let history=[];
 const root=get('graph'),buttons=['select','add','edge'].map(name=>get('tool-'+name));
 function checkpoint(){history=[...history.slice(-59),copyHybridDrawing(graph)];}
 function changed(next){graph=copyHybridDrawing(next);onChange(copyHybridDrawing(graph));draw();}
 function commit(next){checkpoint();changed(next);}
 function selectNode(i){selection={kind:'node',i};for(const group of root.children)group.classList.toggle('selected',group.dataset.node!==undefined&&+group.dataset.node===i);get('delete').disabled=false;panel();}
 function connectNode(i){
  drag=null;selectNode(i);
  if(edgeStart===null){edgeStart=i;onStatus(text.second);draw();return;}
  if(edgeStart===i)return;
  const start=edgeStart,existing=graph.edges.some(edge=>(edge.a===start&&edge.b===i)||(edge.a===i&&edge.b===start));
  const edges=existing?graph.edges.filter(edge=>!((edge.a===start&&edge.b===i)||(edge.a===i&&edge.b===start))):[...graph.edges,{a:start,b:i,m:1}];
  edgeStart=null;commit({...graph,edges});
 }
 function svgElement(tag,attributes,parent,value){
  const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [name,attribute] of Object.entries(attributes))element.setAttribute(name,String(attribute));
  if(value!==null)element.textContent=String(value);
  parent.appendChild(element);return element;
 }
 function draw(){
  root.replaceChildren();
  graph.edges.forEach((edge,i)=>{
   const a=graph.nodes[edge.a],b=graph.nodes[edge.b],coordinates={x1:a.x,y1:a.y,x2:b.x,y2:b.y};
   const hit=svgElement('line',{...coordinates,class:'edge-hit'},root,null);
   const line=svgElement('line',{...coordinates,class:'edge'+(selection?.kind==='edge'&&selection.i===i?' selected':'')},root,null);
   const select=event=>{event.stopPropagation();drag=null;selection={kind:'edge',i};edgeStart=null;draw();};
   hit.addEventListener('pointerdown',select);line.addEventListener('pointerdown',select);
   svgElement('text',{x:(a.x+b.x)/2,y:(a.y+b.y)/2-9,class:'edge-label'},root,edge.m+'×');
  });
  graph.nodes.forEach((node,i)=>{
   const group=svgElement('g',{'data-node':i,class:'node'+(selection?.kind==='node'&&selection.i===i?' selected':'')+(edgeStart===i?' connecting':''),transform:`translate(${node.x} ${node.y})`},root,null);
   svgElement('circle',{r:25,fill:node.type==='R'?'#79c9e6':'#ffa876'},group,null);
   svgElement('text',{},group,node.type);
   svgElement('text',{y:43,class:'badge'},group,`${i+1}${graph.input===i?' · IN':''}${graph.output===i?' · OUT':''}`);
   group.addEventListener('pointerdown',event=>{
    event.stopPropagation();
    if(event.button===2){event.preventDefault();drag=null;selectNode(i);removeSelection();return;}
    if(event.button!=null&&event.button!==0)return;
    if(tool==='edge'||event.shiftKey){event.preventDefault();connectNode(i);return;}
    edgeStart=null;selectNode(i);
    if(tool==='select'){event.preventDefault();drag={i,startX:node.x,startY:node.y,moved:false};root.setPointerCapture(event.pointerId);}
   });
   group.addEventListener('dblclick',event=>{
    event.stopPropagation();if(event.shiftKey||tool==='edge'||(event.button!=null&&event.button!==0))return;
    event.preventDefault();drag=null;edgeStart=null;selection={kind:'node',i};
    commit({...graph,nodes:graph.nodes.map((vertex,index)=>index===i?{...vertex,type:vertex.type==='R'?'N':'R'}:vertex)});
   });
  });
  panel();get('undo').disabled=history.length===0;get('delete').disabled=selection===null;
 }
 function field(id,label,value,min,max,step){return `<label class="field"><span>${label}</span><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;}
 function panel(){
  const container=get('selection');
  if(!selection){container.innerHTML=`<h2>${text.parameters}</h2><p class="small">${text.choose}</p>`;return;}
  if(selection.kind==='edge'){
   const i=selection.i,edge=graph.edges[i];
   container.innerHTML=`<h2>${text.edge} ${edge.a+1} — ${edge.b+1}</h2>${field('edgeMultiplier',text.multiplier,edge.m,0.1,4,0.1)}<p class="small">${text.delay}: ${(edge.m*getDelay()).toFixed(1)} ms.</p>`;
   get('edgeMultiplier').onchange=event=>{
    const value=Number(event.target.value);
    if(event.target.value.trim()===''||!Number.isFinite(value)||value<0.1||value>4){onStatus(text.invalid);panel();return;}
    commit({...graph,edges:graph.edges.map((link,index)=>index===i?{...link,m:value}:link)});
   };return;
  }
  const i=selection.i,node=graph.nodes[i];
  container.innerHTML=`<h2>${text.node} ${i+1}</h2><label class="field"><span>${text.type}</span><select id="nodeType"><option value="R" ${node.type==='R'?'selected':''}>R · ${text.resonator}</option><option value="N" ${node.type==='N'?'selected':''}>N · ${text.nonlinear}</option></select></label>${node.type==='R'?field('freq',text.frequency,node.freq,50,4000,1)+field('damping',text.damping,node.damping,1,500,1):`<label class="field"><span>${text.drive} <output id="driveOut">${node.drive}</output></span><input id="drive" type="range" min="0" max="20" step="0.1" value="${node.drive}"></label><p class="small">${text.linear}</p>`}<div class="row"><button id="inputNode">${graph.input===i?'● IN':text.input}</button><button id="outputNode">${graph.output===i?'● OUT':text.output}</button></div>`;
  get('nodeType').onchange=event=>{
   const type=event.target.value;if(type!=='R'&&type!=='N'){onStatus(text.invalid);panel();return;}
   commit({...graph,nodes:graph.nodes.map((vertex,index)=>index===i?{...vertex,type}:vertex)});
  };
  for(const key of node.type==='R'?['freq','damping']:['drive'])get(key).onchange=event=>{
   const value=Number(event.target.value),limits={freq:[50,4000],damping:[1,500],drive:[0,20]}[key],next={...node,[key]:value};
   if(event.target.value.trim()===''||!Number.isFinite(value)||value<limits[0]||value>limits[1]||next.damping>=2*Math.PI*next.freq){onStatus(text.invalid);panel();return;}
   commit({...graph,nodes:graph.nodes.map((vertex,index)=>index===i?next:vertex)});
  };
  if(node.type==='N')get('drive').oninput=event=>{get('driveOut').textContent=event.target.value;};
  get('inputNode').onclick=()=>commit({...graph,input:i});get('outputNode').onclick=()=>commit({...graph,output:i});
 }
 function point(event){const point=root.createSVGPoint();point.x=event.clientX;point.y=event.clientY;return point.matrixTransform(root.getScreenCTM().inverse());}
 function removeSelection(){
  if(!selection)return;
  if(selection.kind==='node'&&graph.nodes.length===1){onStatus(text.minimum);return;}
  const i=selection.i;
  const next=selection.kind==='edge'?{...graph,edges:graph.edges.filter((_,index)=>index!==i)}:{
   nodes:graph.nodes.filter((_,index)=>index!==i),
   edges:graph.edges.filter(edge=>edge.a!==i&&edge.b!==i).map(edge=>({...edge,a:edge.a>i?edge.a-1:edge.a,b:edge.b>i?edge.b-1:edge.b})),
   input:graph.input===i?0:graph.input>i?graph.input-1:graph.input,
   output:graph.output===i?0:graph.output>i?graph.output-1:graph.output
  };
  selection=null;edgeStart=null;drag=null;commit(next);
 }
 root.addEventListener('contextmenu',event=>event.preventDefault());
 root.addEventListener('pointerdown',event=>{
  if(event.target!==root||(event.button!==0&&event.button!==2))return;
  event.preventDefault();drag=null;
  if(tool==='edge'){selection=null;edgeStart=null;draw();return;}
  if(graph.nodes.length>=24){onStatus(text.maximum);return;}
  const position=point(event),type=event.button===2?'N':get('addType').value;
  const vertex=createHybridVertex(type,Math.max(30,Math.min(970,position.x)),Math.max(30,Math.min(510,position.y)),440);
  selection={kind:'node',i:graph.nodes.length};edgeStart=null;commit({...graph,nodes:[...graph.nodes,vertex]});
 });
 root.addEventListener('pointermove',event=>{
  if(!drag)return;
  const position=point(event);
  if(!drag.moved&&Math.hypot(position.x-drag.startX,position.y-drag.startY)>3){checkpoint();drag={...drag,moved:true};}
  if(!drag.moved)return;
  const i=drag.i;
  graph={...graph,nodes:graph.nodes.map((vertex,index)=>index===i?{...vertex,x:Math.max(30,Math.min(970,position.x)),y:Math.max(30,Math.min(510,position.y))}:vertex)};
  draw();
 });
 const endDrag=()=>{if(drag?.moved)onChange(copyHybridDrawing(graph));drag=null;};
 root.addEventListener('pointerup',endDrag);root.addEventListener('pointercancel',endDrag);root.addEventListener('lostpointercapture',endDrag);
 for(const [index,name] of ['select','add','edge'].entries())buttons[index].onclick=()=>{
  tool=name;edgeStart=null;drag=null;
  buttons.forEach((button,i)=>{button.classList.toggle('active',i===index);button.setAttribute('aria-pressed',String(i===index));});
  get('hint').textContent=tool==='edge'?text.connect:text.hint;draw();
 };
 get('delete').onclick=removeSelection;
 get('undo').onclick=()=>{if(!history.length)return;const previous=history[history.length-1];history=history.slice(0,-1);selection=null;edgeStart=null;drag=null;changed(previous);};
 get('clear').onclick=()=>{selection=null;edgeStart=null;drag=null;commit(createHybridPreset('single-r'));};
 get('preset').onchange=event=>{if(!event.target.value)return;const next=createHybridPreset(event.target.value);selection=null;edgeStart=null;drag=null;event.target.value='';commit(next);};
 document.addEventListener('keydown',event=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)||document.activeElement.isContentEditable)return;
  if(event.key==='Escape'){edgeStart=null;selection=null;drag=null;draw();onStatus(text.cleared);}
  if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();removeSelection();}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();get('undo').click();}
 });
 get('hint').textContent=text.hint;draw();
 return {
  getGraph:()=>copyHybridDrawing(graph),
  replaceGraph(next){selection=null;edgeStart=null;drag=null;commit(copyHybridDrawing(next));},
  refresh:draw,refreshPanel:panel
 };
}
