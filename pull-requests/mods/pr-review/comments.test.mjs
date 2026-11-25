import test from 'node:test';
import assert from 'node:assert/strict';
import { diffRows, commentAnchor, inlineCommentError, inlineCommentArgs } from './model.js';

const pr = () => ({state:'open',draft:true,user:{login:'me'},head:{sha:'reviewed-sha'},base:{sha:'base'},changed_files:3});

test('anchors deletions to LEFT, additions and unchanged context to RIGHT', () => {
  const rows = diffRows('@@ -10,2 +20,2 @@\n same\n-old\n+new\n\\ No newline at end of file');
  assert.deepEqual(commentAnchor(rows[1], 'RIGHT'), {line:20,side:'RIGHT'});
  assert.deepEqual(commentAnchor(rows[2], 'LEFT'), {line:11,side:'LEFT'});
  assert.deepEqual(commentAnchor(rows[3], 'RIGHT'), {line:21,side:'RIGHT'});
  for (const [row, side] of [[rows[0],'RIGHT'],[rows[1],'LEFT'],[rows[2],'RIGHT'],[rows[3],'LEFT'],[rows[4],'RIGHT']]) {
    assert.equal(commentAnchor(row, side), null);
  }
});

test('rejects zero or nonnumeric anchors and invalid sides', () => {
  for (const line of [0,-1,NaN,Infinity,1.5,'3',undefined]) assert.equal(commentAnchor({kind:'+',next:line}, 'RIGHT'), null);
  assert.equal(commentAnchor({kind:'+',next:3}, 'MIDDLE'), null);
  assert.throws(() => inlineCommentArgs({}, 'sha', 'x', {line:0,side:'RIGHT'}, 'body'));
  assert.throws(() => inlineCommentArgs({}, 'sha', '', {line:1,side:'RIGHT'}, 'body'));
});

test('allows comments on own and draft PRs without implying approval', () => {
  assert.equal(inlineCommentError(pr(), pr(), 'ME', 'me', 'Comment'), null);
});

test('checks body, account, state and both revisions before posting', () => {
  assert.match(inlineCommentError(pr(),pr(),'me','me','  \n '), /Write a comment/);
  assert.match(inlineCommentError(pr(),pr(),'me','me','x'.repeat(65_537)), /too long/);
  assert.match(inlineCommentError(pr(),pr(),'other','me','body'), /account changed/);
  assert.match(inlineCommentError(pr(),pr(),null,'me','body'), /account changed/);
  for (const fresh of [{...pr(),head:{sha:'new'}},{...pr(),base:{sha:'new'}},{...pr(),changed_files:5}]) {
    assert.match(inlineCommentError(pr(),fresh,'me','me','body'), /PR changed/);
  }
  assert.match(inlineCommentError(pr(),{...pr(),state:'closed'},'me','me','body'), /Only open/);
});

test('uses REST line/side fields with a typed number and raw unmodified Markdown', () => {
  const body = '@reviewer\n**Question:** `$(not-a-shell-command)` — why?';
  assert.deepEqual(inlineCommentArgs({host:'github.example.com',repo:'org/repo',number:42}, 'reviewed-sha', 'dir/renamed file.ts', {line:21,side:'RIGHT'}, body), [
    'api','--hostname','github.example.com','--method','POST','repos/org/repo/pulls/42/comments',
    '-f','commit_id=reviewed-sha','-f','path=dir/renamed file.ts','-F','line=21',
    '-f','side=RIGHT','-f',`body=${body}`,
  ]);
  const args = inlineCommentArgs({host:'github.com',repo:'org/repo',number:1}, 'sha', 'deleted.ts', {line:10,side:'LEFT'}, 'why remove?');
  assert.ok(args.includes('side=LEFT'));
  assert.ok(args.includes('line=10'));
  assert.ok(!args.includes('event=APPROVE'));
});
