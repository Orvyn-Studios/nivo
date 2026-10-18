import test from 'node:test';
import assert from 'node:assert/strict';
import {createChoreography} from '../src/choreography.ts';
function fixture(){
 const saved=new Map(['document','getComputedStyle'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 globalThis.document={hidden:false};globalThis.getComputedStyle=node=>({opacity:String(node.opacity)});
 const animations=[];
 const attributes=new Map();
 const styleKey=k=>k.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 const node={textContent:'Archivo',opacity:1,left:20,top:60,width:100,height:40,hidden:false,inert:false,dataset:{},style:{getPropertyValue(k){return this[styleKey(k)]??''},getPropertyPriority(){return''},setProperty(k,v){this[styleKey(k)]=v},removeProperty(k){delete this[styleKey(k)]}},
  getAttribute(k){return attributes.get(k)??null},setAttribute(k,v){attributes.set(k,v)},removeAttribute(k){attributes.delete(k)},
  getBoundingClientRect(){return{left:this.left,top:this.top,width:this.hidden?0:this.width,height:this.hidden?0:this.height}},
  animate(frames,options){let resolve,reject;const finished=new Promise((a,b)=>{resolve=a;reject=b});
   const a={frames,options,finished,cancelled:false,cancel(){this.cancelled=true;reject(new Error('cancel'))},finish:resolve};animations.push(a);return a;}};
 const nodes=[node];
 const root={scrollLeft:0,scrollTop:0,querySelectorAll:()=>nodes,getBoundingClientRect:()=>({width:352,left:0,top:0})};let reduced=false;
 return{node,nodes,animations,engine:createChoreography(root,()=>reduced),reduce(){reduced=true},restore(){for(const[k,v]of saved)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k]}};
}
test('shared content retargets from the composited position and cancels the previous leg',async()=>{
 const f=fixture();try{f.engine.change(()=>{f.node.top=90});assert.equal(f.animations[0].frames[0].transform,'translate(0px,-30px)');
  f.node.top=75;f.node.opacity=.8;f.engine.change(()=>{f.node.top=100});
  assert.equal(f.animations[0].cancelled,true);assert.equal(f.animations[1].frames[0].transform,'translate(0px,-25px)');assert.equal(f.animations[1].frames[0].opacity,.8);
  f.engine.dispose();assert.equal(f.animations[1].cancelled,true);await Promise.resolve();
 }finally{f.restore()}
});
test('fast result and cancellation mutate immediately without waiting for a visual promise',()=>{
 const f=fixture();try{f.engine.change(()=>{f.node.textContent='Progreso'});f.engine.change(()=>{f.node.textContent='Resultado'},'completion');
  assert.equal(f.node.textContent,'Resultado');assert.equal(f.animations[0].cancelled,true);assert.equal(f.animations[1].options.duration,260);
  f.engine.change(()=>{f.node.textContent='Cancelado'});assert.equal(f.node.textContent,'Cancelado');f.engine.dispose();
 }finally{f.restore()}
});
test('hidden, reduced and disposed choreography retains no animation work',()=>{
 const f=fixture();try{f.engine.change(()=>{f.node.top=80});f.reduce();f.engine.change(()=>{f.node.top=90});
  assert.equal(f.animations.length,1);assert.equal(f.animations[0].cancelled,true);
  document.hidden=true;f.engine.change(()=>{f.node.top=100});assert.equal(f.animations.length,1);
  f.engine.dispose();f.engine.change(()=>{f.node.top=200});assert.equal(f.node.top,100);
 }finally{f.restore()}
});
test('outgoing controls are inert, leave flow immediately and cannot hide a reversed state later',async()=>{
 const f=fixture();try{
  f.node.style.minHeight='100%';
  f.engine.change(()=>{f.node.hidden=true});assert.equal(f.node.hidden,false);assert.equal(f.node.inert,true);assert.equal(f.node.style.position,'absolute');
  assert.equal(f.node.style.minHeight,'0px','incoming height cannot recenter a departing notice');
  assert.equal(f.node.style.left,'calc(50% + -156px)','outgoing position follows the fixed surface centre, not the changing panel edge');
  assert.equal(f.node.getAttribute('aria-hidden'),'true');
  f.engine.change(()=>{f.node.hidden=false});await Promise.resolve();await Promise.resolve();
  assert.equal(f.node.hidden,false);assert.equal(f.node.inert,false);assert.equal(f.node.getAttribute('aria-hidden'),null);
  assert.equal(f.node.style.minHeight,'100%');
  f.engine.change(()=>{f.node.hidden=true});f.node.style.opacity='.42';f.engine.settle();assert.equal(f.node.hidden,true);assert.equal(f.node.inert,false);assert.equal(f.node.style.opacity,'.42','cleanup must not restore stale properties owned by the surface engine');
 }finally{f.engine.dispose();f.restore()}
});

test('replacement clears outgoing text before revealing the incoming panel without delaying mutation',()=>{
 const f=fixture();try{
  const incoming={...f.node,hidden:true,textContent:'Resultado',dataset:{}};f.nodes.push(incoming);
  f.engine.change(()=>{f.node.hidden=true;incoming.hidden=false});
  assert.equal(incoming.hidden,false,'real result is committed synchronously');
  assert.equal(f.animations[0].options.duration,60);
  assert.equal(f.animations[1].frames[0].opacity,0);
  assert.equal(f.animations[1].frames[1].opacity,0);
  assert.equal(f.animations[1].frames[1].offset*f.animations[1].options.duration,60);
  assert.equal(f.animations[1].options.easing,'linear','the handoff hold is wall time, not eased progress');
  assert.equal(f.animations[1].frames.at(-1).opacity,1);
 }finally{f.engine.dispose();f.restore()}
});
