import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { CHECK_QUERY, MERGE_MUTATION, mergeError, isOtherAuthor, MERGE_METHODS, allowedMergeMethods } from './model.js';
import { mergeColors } from './colors.js';

const expected = {login:'me',head:'head',base:'base',baseRef:'main'};
const eligible = () => ({viewer:{login:'Me'},repository:{mergeCommitAllowed:true,viewerPermission:'WRITE',pullRequest:{
  id:'PR_1',number:42,title:'Test PR',author:{login:'me'},state:'OPEN',isDraft:false,headRefOid:'head',baseRefOid:'base',baseRefName:'main',headRefName:'feature',
  mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',reviewDecision:'APPROVED',assignees:{nodes:[{login:'me'}]},
  commits:{nodes:[{commit:{statusCheckRollup:{contexts:{totalCount:1,nodes:[{status:'COMPLETED',conclusion:'SUCCESS'}]}}}}]},
}}});

test('merge checks identity, revision and permission but allows any author, reviews, assignment or checks', () => {
  assert.equal(mergeError(eligible(),expected),null);
  for (const patch of [{state:'MERGED'},{isDraft:true},{headRefOid:'new'},{baseRefOid:'new'},
    {baseRefName:'release'}]) {
    const data=eligible(); Object.assign(data.repository.pullRequest,patch);
    assert.ok(mergeError(data,expected),JSON.stringify(patch));
  }
  for (const patch of [{mergeCommitAllowed:false},{viewerPermission:'READ'}]) {
    const data=eligible(); Object.assign(data.repository,patch); assert.ok(mergeError(data,expected));
  }
  const switched=eligible(); switched.viewer.login='other'; assert.match(mergeError(switched,expected),/account changed/);
  const partial=eligible(); partial.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.totalCount=101;
  assert.equal(mergeError(partial,expected),null);
  for (const patch of [{author:{login:'someoneElse'}},{assignees:{nodes:[]}},{reviewDecision:'CHANGES_REQUESTED'},
    {mergeable:'UNKNOWN'},{mergeStateStatus:'BLOCKED'},{commits:null}]) {
    const data=eligible(); Object.assign(data.repository.pullRequest,patch);
    assert.equal(mergeError(data,expected),null);
  }
});

const source=(await readFile(new URL('./main.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export default class MergeConfirmation','class MergeConfirmation')+'\nMergeConfirmation;';
async function harness({initial=eligible(),fresh=initial,mutationError=false,dark=true}={}) {
  const calls=[],tasks=[],state={},closed=[],text=[],actions={};
  function element() {
    let id;
    const proxy=new Proxy({}, {get(_target,name) {
      if(name==='id') return value=>{id=value;return proxy;};
      if(name==='when') return (condition,fn)=>condition?fn(proxy):proxy;
      if(name==='on_click') return fn=>{actions[id]=fn;return proxy;};
      if(name==='child') return value=>{if(typeof value==='string')text.push(value);return proxy;};
      return ()=>proxy;
    }});
    return proxy;
  }
  const target={host:'github.com',repo:'org/repo',number:42,...expected,overlay:'merge-dialog'};
  const context={MERGE_METHODS,allowedMergeMethods,View:class{},div:element,v_flex:element,h_flex:element,svg:element,Scrollbar:{vertical:element},mergeColors,settings:()=>({dark}),props:()=>target,CHECK_QUERY,MERGE_MUTATION,mergeError,isOtherAuthor,
    shared:key=>state[key],setShared:(key,value)=>{state[key]=value;},closeOverlay:id=>closed.push(id),
    exec:async (_cmd,args)=>{
      calls.push(args);
      if (args.includes(`query=${MERGE_MUTATION}`)) {
        if (mutationError) throw new Error('Connection lost');
        return {code:0,stdout:JSON.stringify({data:{mergePullRequest:{pullRequest:{id:'PR_1',state:'MERGED'}}}})};
      }
      return {code:0,stdout:JSON.stringify({data:calls.length===1?initial:fresh})};
    }};
  const Merge=vm.runInNewContext(source,context),view=new Merge();
  const cx={notify(){},spawn(fn){tasks.push(fn(cx));}};
  view.init({},cx); await Promise.all(tasks);
  return {view,cx,calls,tasks,state,closed,text,actions};
}

test('opening only reads; explicit confirmation rechecks then sends exactly one pinned merge',async()=>{
  const h=await harness();
  assert.equal(h.calls.length,1); assert.equal(h.view.done,false);
  h.view.confirm(h.cx); h.view.confirm(h.cx); await Promise.all(h.tasks);
  assert.equal(h.calls.length,3);
  assert.ok(h.calls[2].includes('head=head')); assert.ok(h.calls[2].includes('id=PR_1'));
  assert.match(MERGE_MUTATION,/expectedHeadOid: \$head, mergeMethod: \$method/);
  assert.ok(h.calls[2].includes('method=MERGE'));
  assert.equal(h.view.done,true); assert.equal(h.state['github.mergedPRs']['github.com/org/repo#42'],true);
  h.view.confirm(h.cx); assert.equal(h.calls.length,3);
});

test('another author or unknown author requires explicit acknowledgment before confirmation can submit', async () => {
  for (const author of [{login:'someoneElse'},null]) {
    const initial=eligible(); initial.repository.pullRequest.author=author;
    const h=await harness({initial});
    assert.equal(isOtherAuthor(h.view.pr, 'me'), true);
    h.view.confirm(h.cx); await Promise.all(h.tasks);
    assert.equal(h.calls.length,1);
    h.view.acknowledged=true;
    h.view.confirm(h.cx); await Promise.all(h.tasks);
    assert.equal(h.view.done,true); assert.equal(h.calls.length,3);
  }
  assert.equal(isOtherAuthor({author:{login:'ME'}},'me'),false);
});

test('warning is prominent in both palettes, confirmation needs acknowledgment, and Cancel never merges', async () => {
  for(const dark of [true,false]) {
    const initial=eligible(); initial.repository.pullRequest.author={login:'other'};
    const h=await harness({initial,dark}); h.view.render();
    assert.ok(h.text.includes('You are merging a pull request you did not author.'));
    assert.ok(h.text.some(t=>t.includes('Author: @other. You are @me.')));
    assert.equal(h.actions['merge-confirm'],undefined);
    h.actions['merge-acknowledge']({},h.cx); h.view.render();
    assert.equal(typeof h.actions['merge-confirm'],'function');
    h.actions['merge-cancel']();
    assert.deepEqual(h.closed,['merge-dialog']); assert.equal(h.calls.length,1);
  }
});

test('dialog selects enabled methods and locks submission controls', async () => {
  for (const dark of [true, false]) {
    const initial = eligible(); Object.assign(initial.repository, {squashMergeAllowed:true,rebaseMergeAllowed:true});
    const h = await harness({initial,dark}); h.view.render();
    assert.equal(typeof h.actions['merge-method-MERGE'], 'function');
    assert.equal(typeof h.actions['merge-method-SQUASH'], 'function');
    assert.equal(h.actions['merge-method-REBASE'], undefined);
    assert.ok(h.text.includes('Create a merge commit'));
    assert.ok(h.text.includes('Squash and merge'));
    h.actions['merge-method-SQUASH']({}, h.cx);
    assert.equal(h.view.method, 'SQUASH');
    h.view.render();
    assert.ok(h.text.includes('Confirm squash and merge'));
    h.view.submitting=true;
    for (const key of Object.keys(h.actions)) delete h.actions[key];
    h.view.render();
    for (const key of ['merge-confirm','merge-cancel','merge-close','merge-method-MERGE','merge-method-SQUASH','merge-method-REBASE']) {
      assert.equal(h.actions[key],undefined,`${key} unavailable during submission`);
    }
    assert.ok(h.text.includes('Merging… Waiting for GitHub.'));
    assert.equal(h.calls.length,1);
  }
});

test('error and success states render without another merge action in both palettes', async () => {
  for (const dark of [true,false]) {
    const h = await harness({dark}); h.view.error='GitHub is unavailable'; h.view.render();
    assert.ok(h.text.includes('Unable to merge')); assert.equal(h.actions['merge-confirm'],undefined);
    h.view.error=''; h.view.done=true; h.view.render();
    assert.ok(h.text.includes('Pull request successfully merged and closed'));
    assert.equal(h.actions['merge-confirm'],undefined); assert.equal(h.calls.length,1);
  }
});

test('squash-only repositories default to squash; unsupported repositories are blocked', async () => {
  const initial=eligible(); Object.assign(initial.repository,{mergeCommitAllowed:false,squashMergeAllowed:true});
  const h=await harness({initial});
  assert.equal(h.view.error,''); assert.equal(h.view.method,'SQUASH');
  h.view.confirm(h.cx); await Promise.all(h.tasks);
  assert.ok(h.calls[2].includes('method=SQUASH')); assert.equal(h.view.done,true);
  const blocked=eligible(); Object.assign(blocked.repository,{mergeCommitAllowed:false,rebaseMergeAllowed:true});
  const b=await harness({initial:blocked});
  assert.match(b.view.error,/Neither merge commits nor squash/);
  b.view.confirm(b.cx); assert.equal(b.calls.length,1);
});

test('selected squash method is submitted, pinned before async work, and revalidated', async () => {
  const initial=eligible(); initial.repository.squashMergeAllowed=true;
  const h=await harness({initial}); h.view.render();
  h.actions['merge-method-SQUASH']({},h.cx); h.view.confirm(h.cx);
  h.actions['merge-method-MERGE']({},h.cx);
  assert.equal(h.view.method,'SQUASH');
  await Promise.all(h.tasks);
  assert.ok(h.calls[2].includes('method=SQUASH'));
  const fresh=eligible(); fresh.repository.squashMergeAllowed=false;
  const changed=await harness({initial,fresh}); changed.view.method='SQUASH';
  changed.view.confirm(changed.cx); await Promise.all(changed.tasks);
  assert.equal(changed.calls.length,2); assert.match(changed.view.error,/selected merge method/);
  const invalid=await harness({initial}); invalid.view.method='REBASE';
  invalid.view.confirm(invalid.cx); assert.equal(invalid.calls.length,1);
  assert.match(mergeError(initial,expected,'REBASE'),/selected merge method/);
  const disabled=await harness(); disabled.view.render();
  assert.equal(disabled.actions['merge-method-SQUASH'],undefined);
});

test('new commits or changed account after opening prevent any mutation',async()=>{
  for (const field of ['head','account','base']) {
    const fresh=eligible();
    if(field==='account') fresh.viewer.login='other';
    else fresh.repository.pullRequest[field==='head'?'headRefOid':'baseRefOid']='changed';
    const h=await harness({fresh}); h.view.confirm(h.cx); await Promise.all(h.tasks);
    assert.equal(h.calls.length,2); assert.ok(h.view.error); assert.equal(h.view.done,false);
    assert.equal(h.state['github.mergedPRs'],undefined);
  }
});

test('uncertain submission warns to check GitHub and cannot be accidentally retried',async()=>{
  const h=await harness({mutationError:true}); h.view.confirm(h.cx); await Promise.all(h.tasks);
  assert.match(h.view.error,/may have reached GitHub/);
  h.view.confirm(h.cx); assert.equal(h.calls.length,3); assert.equal(h.view.done,false);
});
