import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as model from './model.js';

const source=(await readFile(new URL('./main.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export default class PullRequests','class PullRequests')+'\nPullRequests;';

// Test the actual refresh arguments: Review is a pending-request inbox,
// not a retained list of previously reviewed PRs.
async function refreshFixture({requested=false,state='OPEN'}={}) {
  const pr={id:'pr1',title:'Pending review',state,repository:{nameWithOwner:'org/repo'}};
  const calls=[],tasks=[];
  const exec=async (_cmd,args)=>{
    calls.push(args);
    if(args[0]==='auth') return {code:0,stdout:JSON.stringify([{host:'github.com',accounts:[{login:'me',active:true,state:'success'}]}])};
    const variables=Object.fromEntries(args.filter((arg,i)=>args[i-1]==='-f' && !arg.startsWith('query=')).map(arg=>{
      const i=arg.indexOf('=');return [arg.slice(0,i),arg.slice(i+1)];
    }));
    const data={viewer:{login:'me'}};
    for(const [key,query] of Object.entries(variables)) {
      const eligible=state==='OPEN' && (query.includes('review-requested:me') ? requested : false);
      data[key]={nodes:eligible?[pr]:[],issueCount:eligible?1:0,pageInfo:{hasNextPage:false}};
    }
    return {code:0,stdout:JSON.stringify({data})};
  };
  const storage=new Map();
  const PullRequests=vm.runInNewContext(source,{View:class{},exec,...model,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
  const view=new PullRequests();
  Object.assign(view,{busy:false,merging:null,accounts:[],selected:null,data:null});
  const cx={notify(){},spawn(fn){tasks.push(fn(cx));}};
  view.refresh(cx); await Promise.all(tasks);
  assert.equal(view.error,null);
  return {view,calls};
}

test('all dashboard searches use open PRs and Review searches pending requests only',async()=>{
  const {calls}=await refreshFixture();
  const args=calls.find(args=>args[0]==='api');
  assert.ok(args.includes('assigned=is:pr is:open assignee:me sort:updated-desc'));
  assert.ok(args.includes('authored=is:pr is:open author:me sort:updated-desc'));
  assert.ok(args.includes('requested=is:pr is:open review-requested:me sort:updated-desc'));
  assert.ok(args.includes('whiteWalkers=is:pr is:open author:me sort:updated-desc'));
  assert.ok(!args.some(arg=>arg.includes('reviewed-by:') || arg.includes('is:unmerged')));
  assert.ok(!model.QUERY.includes('$reviewed'));
});

test('Review shows pending requests but does not retain completed reviews',async()=>{
  assert.equal((await refreshFixture({requested:true})).view.data.requested.nodes.length,1);
  assert.equal((await refreshFixture({requested:false})).view.data.requested.nodes.length,0);
});

test('closed and merged PRs are excluded even when a review was requested',async()=>{
  for(const state of ['CLOSED','MERGED']) {
    assert.equal((await refreshFixture({requested:true,state})).view.data.requested.nodes.length,0);
  }
});
