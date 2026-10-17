import test from 'node:test';
import assert from 'node:assert/strict';
import {actionFraction,parseActionProgress,parseActionResult,fileKind,formatBytes} from '../src/actions.ts';
test('native action messages expose only bounded file capabilities and measured progress',()=>{
 const p={operationId:'action:1',phase:'running',completed:50,total:100,cancellable:true};
 assert.equal(actionFraction(parseActionProgress(p)),.5);
 for(const total of [null,0,25])assert.equal(actionFraction({...p,total}),undefined);
 for(const invalid of [{...p,operationId:'C:/secret'},{...p,total:Infinity},{...p,completed:-1},{...p,phase:'fake'}])assert.equal(parseActionProgress(invalid),null);
 const r=parseActionResult({operationId:'action:1',outcome:'success',message:'ZIP listo.',file:{id:'drop:2:0',name:'diseño.zip',size:120,path:'private'}});
 assert.equal('path' in r.file,false);
 assert.throws(()=>parseActionResult({operationId:'action:1',outcome:'sent',message:'false'}));
 assert.equal(parseActionResult({...r,outcome:'cancelled',file:null}).file,null);
 assert.equal(fileKind('diseño.PDF').label,'Documento PDF');
 assert.equal(formatBytes(1024),'1 KB');
});
