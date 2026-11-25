import test from 'node:test';
import assert from 'node:assert/strict';
import { accountsFrom, checkKind, ciSummary, reviewLabel, canMerge } from './model.js';

const pr = (nodes, totalCount = nodes.length) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes, totalCount } } } }] } });
const eligible = () => ({
  ...pr([{ state: 'SUCCESS' }]), state: 'OPEN', isDraft: false, headRefOid: 'abc123',
  assignees: { nodes: [{ login: 'Me' }] }, reviewDecision: 'APPROVED',
  mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  repository: { mergeCommitAllowed: true, viewerPermission: 'WRITE' },
});
test('offers merge for any open non-draft PR regardless of author, assignment, reviews or checks', () => {
  assert.equal(canMerge(eligible(), 'me'), true);
  for (const patch of [
    { state: 'MERGED' }, { state: 'CLOSED' }, { isDraft: true }, { headRefOid: null },
  ]) assert.equal(canMerge({ ...eligible(), ...patch }, 'me'), false, JSON.stringify(patch));
  for (const patch of [
    { author: { login: 'someoneElse' } },
    { assignees: { nodes: [{ login: 'other' }] } }, { assignees: null },
    { reviewDecision: 'REVIEW_REQUIRED' }, { reviewDecision: 'CHANGES_REQUESTED' },
    { mergeable: 'CONFLICTING' }, { mergeable: 'UNKNOWN' },
    ...['BLOCKED', 'BEHIND', 'UNSTABLE', 'UNKNOWN', 'HAS_HOOKS', 'DRAFT'].map(mergeStateStatus => ({ mergeStateStatus })),
    { repository: { mergeCommitAllowed: false, viewerPermission: 'ADMIN' } },
    { repository: { mergeCommitAllowed: true, viewerPermission: 'READ' } },
    { commits: null },
    pr([{ state: 'PENDING' }]), pr([{ state: 'FAILURE' }]), pr([{ state: 'SUCCESS' }], 101),
  ]) assert.equal(canMerge({ ...eligible(), ...patch }, 'me'), true, JSON.stringify(patch));
  assert.equal(canMerge(eligible(), null), false);
  for (const viewerPermission of ['MAINTAIN', 'ADMIN']) {
    assert.equal(canMerge({ ...eligible(), repository: { mergeCommitAllowed: true, viewerPermission } }, 'ME'), true);
  }
});
test('normalizes accounts across hosts without credentials', () => {
  assert.deepEqual(accountsFrom([{ host: 'github.com', accounts: [{ login: 'one', active: true }] }]),
    [{ login: 'one', active: true, host: 'github.com', key: 'github.com/one' }]);
});
test('handles absent checks and commits', () => {
  assert.equal(ciSummary({}).label, 'No checks');
  assert.equal(ciSummary(pr([])).kind, 'none');
});
test('supports check runs and legacy status contexts', () => {
  for (const conclusion of ['SUCCESS', 'NEUTRAL', 'SKIPPED']) assert.equal(checkKind({ status: 'COMPLETED', conclusion }), 'passed');
  for (const conclusion of ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']) assert.equal(checkKind({ status: 'COMPLETED', conclusion }), 'failed');
  assert.equal(checkKind({ state: 'ERROR' }), 'failed');
  assert.equal(checkKind({ state: 'SUCCESS' }), 'passed');
  assert.equal(checkKind({ state: 'PENDING' }), 'pending');
  assert.equal(checkKind({ status: 'IN_PROGRESS' }), 'pending');
  assert.equal(checkKind({ status: 'QUEUED' }), 'pending');
  assert.equal(checkKind({ status: 'COMPLETED', conclusion: null }), 'pending');
});
test('failure takes precedence over pending; pending over success', () => {
  assert.equal(ciSummary(pr([{ state: 'SUCCESS' }, { state: 'PENDING' }])).kind, 'pending');
  assert.equal(ciSummary(pr([{ state: 'PENDING' }, { state: 'FAILURE' }])).kind, 'failed');
  assert.equal(ciSummary(pr([{ state: 'SUCCESS' }])).kind, 'passed');
});
test('does not report success when checks were truncated', () => {
  assert.equal(ciSummary(pr([{ state: 'SUCCESS' }], 101)).kind, 'none');
  assert.equal(ciSummary(pr([{ state: 'SUCCESS' }], 101)).label, 'CI partial · 1/101');
});
test('maps review decisions without claiming merge readiness', () => {
  assert.equal(reviewLabel({ reviewDecision: 'APPROVED' }), 'Approved');
  assert.equal(reviewLabel({ reviewDecision: 'CHANGES_REQUESTED' }), 'Changes requested');
  assert.equal(reviewLabel({ reviewDecision: 'REVIEW_REQUIRED' }), 'Review required');
  assert.equal(reviewLabel({}), 'Not reviewed');
});
