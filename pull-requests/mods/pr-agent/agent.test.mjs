import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = (await readFile(new URL('./main.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export function evaluationTask','function evaluationTask').replace('export default class PRAgent','class PRAgent')+'\nPRAgent;';
function setup(fail=false) {
  const calls=[],closed=[],tasks=[];
  const agents=[{address:'t2',app:'claude',space:'work'},{address:'t1',app:'pi',space:'other'}];
  const C=vm.runInNewContext(source,{View:class{},URL,agents:()=>agents,spaces:()=>[{id:'work',active:true}],props:()=>({url:'https://github.example.com/org/repo/pull/42',overlay:'dialog'}),appHome:()=>'/app',readTextFile:async()=>JSON.stringify({bin:'/bin/gitview',hc:'/bin/hc'}),exec:async(cmd,args)=>{calls.push({cmd,args});return {code:fail?1:0,stdout:fail?'': '{}',stderr:fail?'transport failed':''};},closeOverlay:id=>closed.push(id)});
  const cx={notify(){},focus_handle:()=>({focus(){}}),spawn(fn){tasks.push(fn(cx));}};
  const view=new C();view.init({},cx);return {view,cx,calls,closed,tasks};
}
test('lists live agents with Pi first and does not launch anything on open',()=>{
 const s=setup();assert.equal(s.view.list()[0].address,'t1');assert.equal(s.calls.length,0);
});
for(const submit of [false,true]) test(`handoff to exact live terminal, submit=${submit}`,async()=>{
 const s=setup();const a=s.view.list()[0];s.view.choose(a,submit,s.cx);s.view.choose(a,submit,s.cx);await Promise.all(s.tasks);
 assert.equal(s.calls.length,1);const {cmd,args}=s.calls[0];assert.equal(cmd,'/usr/bin/env');
 assert.equal(args[args.indexOf('--terminal')+1],'t1');assert.equal(args.includes('--submit'),submit);
 assert.match(args.at(-1),/https:\/\/github.example.com\/org\/repo\/pull\/42/);assert.match(args.at(-1),/read-only analysis/);assert.match(args.at(-1),/untrusted data/);
 assert.deepEqual(s.closed,['dialog']);
});
test('failed transport keeps dialog open and allows retry',async()=>{
 const s=setup(true);s.view.choose(s.view.list()[0],true,s.cx);await Promise.all(s.tasks);
 assert.equal(s.view.busy,false);assert.match(s.view.error,/transport failed/);assert.equal(s.closed.length,0);
});
test('Enter places input and Shift+Enter submits',async()=>{
 for(const [key,submit] of [['enter',false],['shift-enter',true]]) {const s=setup();s.view.key(key,s.cx);await Promise.all(s.tasks);assert.equal(s.calls[0].args.includes('--submit'),submit);}
});
