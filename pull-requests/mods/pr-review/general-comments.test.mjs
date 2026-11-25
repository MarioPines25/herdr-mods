import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGeneralComments, generalCommentArgs, commentTime } from './comments.js';
const target = {host:'github.example.com',repo:'org/repo',number:42};

test('comment timestamps handle recent, plural, invalid and future dates', () => {
  const now=Date.parse('2026-11-13T12:00:00Z');
  assert.equal(commentTime('2026-11-13T11:59:50Z',now),'just now');
  assert.equal(commentTime('2026-11-13T11:00:00Z',now),'1 hour ago');
  assert.equal(commentTime('2026-11-11T12:00:00Z',now),'2 days ago');
  assert.equal(commentTime('invalid',now),'at an unknown time');
  assert.equal(commentTime('2026-11-14T12:00:00Z',now),'just now');
});

test('loads discussion pages in order using issue comments, not inline review comments', async () => {
  const paths = [];
  const result = await loadGeneralComments(async path => {
    paths.push(path);
    return paths.length === 1 ? Array.from({length:100}, (_,i) => ({id:i})) : [{id:100}];
  }, target);
  assert.equal(result.comments.length,101); assert.equal(result.partial,false);
  assert.equal(paths[1], 'repos/org/repo/issues/42/comments?per_page=100&page=2');
});
test('caps loading and marks partial; malformed and failed pages reject', async () => {
  let calls=0;
  const result=await loadGeneralComments(async () => {calls++;return Array(100).fill({id:1});},target);
  assert.equal(calls,10); assert.equal(result.partial,true);
  await assert.rejects(loadGeneralComments(async()=>({}),target),/Unexpected/);
  await assert.rejects(loadGeneralComments(async()=>{throw new Error('HTTP 403');},target),/403/);
});
test('posting sends literal Markdown to the correct host issue endpoint with no review or merge mutation', () => {
  assert.deepEqual(generalCommentArgs(target,'Hello\n**world**'),[
    'api','--hostname','github.example.com','repos/org/repo/issues/42/comments','--method','POST','-f','body=Hello\n**world**',
  ]);
});
