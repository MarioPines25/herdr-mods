import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalError, approvalArgs } from './model.js';

const pr = () => ({state:'open',draft:false,user:{login:'author'},head:{sha:'reviewed-sha'},base:{sha:'base'},changed_files:3});

test('allows approval only for unchanged open non-draft PRs by another author', () => {
  const snapshot = pr();
  assert.equal(approvalError(snapshot, pr(), 'Reviewer', 'reviewer'), null);
  for (const fresh of [
    {...pr(),state:'closed'}, {...pr(),draft:true}, {...pr(),head:{sha:'new'}},
    {...pr(),base:{sha:'new'}}, {...pr(),changed_files:4}, {...pr(),user:{login:'REVIEWER'}},
  ]) assert.ok(approvalError(snapshot, fresh, 'reviewer', 'reviewer'));
});

test('rejects missing or switched identities before submitting', () => {
  assert.match(approvalError(pr(), pr(), 'other', 'reviewer'), /account changed/);
  assert.match(approvalError(pr(), pr(), null, 'reviewer'), /account changed/);
});

test('approval is an explicit POST pinned to the reviewed commit, never a merge', () => {
  assert.deepEqual(approvalArgs({host:'github.example.com',repo:'org/repo',number:42}, 'reviewed-sha'), [
    'api','--hostname','github.example.com','--method','POST',
    'repos/org/repo/pulls/42/reviews','-f','event=APPROVE','-f','commit_id=reviewed-sha',
  ]);
});
