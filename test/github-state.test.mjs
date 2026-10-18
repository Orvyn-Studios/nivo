import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyGithub,parseGithub,parseGithubConnection,parseGithubNotices} from '../src/github-state.ts';
const snapshot=()=>({...emptyGithub(),revision:3,status:'connected',options:{...emptyGithub().options,enabled:true,repositories:['Orvyn-Studios/nivo']},profile:{id:123,login:'fixture',avatar:null}});
test('GitHub IPC rejects malformed, excessive and unselected data; disabling removes private contents',()=>{
 const s=snapshot();assert.ok(parseGithub(s));assert.equal(parseGithub({...s,revision:-1}),null);
 assert.equal(parseGithub({...s,options:{...s.options,intervalSeconds:1}}),null);
 assert.equal(parseGithub({...s,profile:{...s.profile,avatar:'https://foreign/avatar.png'}}),null);
 assert.equal(parseGithub({...s,calendar:{total:1,days:[{date:'2026-10-18',count:1,level:5}]}}),null);
 assert.equal(parseGithub({...s,options:{...s.options,enabled:false}}).profile,null);
 assert.equal(parseGithub({...s,status:'disconnected'}).profile,null);
});
test('accessible org repos are selectable without owner-only filtering, and invalid repo names fail closed',()=>{
 const s=snapshot(),repository={id:42,fullName:'Orvyn-Studios/nivo',organization:true,private:true,defaultBranch:'main'};
 assert.equal(parseGithubConnection({snapshot:s,repositories:[repository],truncated:false}).repositories[0].organization,true);
 assert.equal(parseGithubConnection({snapshot:s,repositories:[{...repository,fullName:'o/../r'}],truncated:false}),null);
 assert.deepEqual(parseGithubNotices([{id:'n',title:'PR',body:'fixture',actionId:'pr:42',actionLabel:'Abrir PR',failure:false}]).map(n=>n.actionId),['pr:42']);
 assert.deepEqual(parseGithubNotices([{id:'n',title:'PR',body:'fixture',actionId:{url:'https://foreign'},actionLabel:'Abrir',failure:false}]),[]);
});
