export const CHECK_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    mergeCommitAllowed squashMergeAllowed viewerPermission
    pullRequest(number: $number) {
      id number title state isDraft headRefOid baseRefOid headRefName baseRefName
      author { login }
      mergeable mergeStateStatus reviewDecision
    }
  }
}`;

export const MERGE_MUTATION = `mutation($id: ID!, $head: GitObjectID!, $method: PullRequestMergeMethod!) {
  mergePullRequest(input: {pullRequestId: $id, expectedHeadOid: $head, mergeMethod: $method}) {
    pullRequest { id state }
  }
}`;

export const MERGE_METHODS = [
  { value: 'MERGE', field: 'mergeCommitAllowed', label: 'Create a merge commit', description: 'All commits will be added to the base branch with a merge commit.' },
  { value: 'SQUASH', field: 'squashMergeAllowed', label: 'Squash and merge', description: 'All commits will be combined into one commit on the base branch.' },
];

export function allowedMergeMethods(repo) {
  return MERGE_METHODS.filter(method => repo?.[method.field] === true);
}

export function isOtherAuthor(pr, login) {
  return !pr?.author?.login || pr.author.login.toLowerCase() !== login?.toLowerCase();
}

// Only revision, identity and basic ability are preflight gates. GitHub alone
// decides whether checks, reviews, branch protection and mergeability allow it.
export function mergeError(data, expected, method = null) {
  const repo = data?.repository, pr = repo?.pullRequest, login = data?.viewer?.login;
  if (!login || login.toLowerCase() !== expected.login?.toLowerCase()) return 'GitHub account changed. Refresh before merging.';
  if (!pr || pr.state !== 'OPEN' || pr.isDraft) return 'Only open, non-draft pull requests can be merged.';
  if (!expected.head || pr.headRefOid !== expected.head) return 'New commits were pushed. Refresh and review the latest version before merging.';
  if ((expected.base && pr.baseRefOid !== expected.base) || (expected.baseRef && pr.baseRefName !== expected.baseRef)) return 'The base branch changed. Refresh and review before merging.';
  const methods = allowedMergeMethods(repo);
  if (!methods.length) return 'Neither merge commits nor squash merging is enabled for this repository.';
  if (method !== null && !methods.some(option => option.value === method)) return 'The selected merge method is not enabled for this repository. Close and reopen Merge.';
  if (!['WRITE', 'MAINTAIN', 'ADMIN'].includes(repo.viewerPermission)) return 'The active account does not have permission to merge.';
  return null;
}
