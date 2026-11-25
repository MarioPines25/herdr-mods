export const GROUPS = [
  { key: "assigned", label: "Assigned", qualifier: "assignee" },
  { key: "authored", label: "Opened", qualifier: "author" },
  { key: "requested", label: "Review requested", qualifier: "review-requested" },
  { key: "whiteWalkers", label: "Team" },
];

// Optional team GitHub logins. Empty defaults to the selected account, never a global PR search.
// Example: [{ login: "YOUR_TEAMMATE" }]. No emails or credentials belong here.
export const WHITE_WALKERS = [];

export function groupQuery(group, login) {
  // GitHub combines repeated author qualifiers with OR, not AND.
  const qualifiers = group.key === "whiteWalkers"
    ? (WHITE_WALKERS.length ? WHITE_WALKERS.map(author => `author:${author.login}`).join(" ") : `author:${login}`)
    : `${group.qualifier}:${login}`;
  return `is:pr is:open ${qualifiers} sort:updated-desc`;
}

export const QUERY = `query($assigned: String!, $authored: String!, $requested: String!, $whiteWalkers: String!) {
  viewer { login }
  assigned: search(query: $assigned, type: ISSUE, first: 50) { ...Results }
  authored: search(query: $authored, type: ISSUE, first: 50) { ...Results }
  requested: search(query: $requested, type: ISSUE, first: 50) { ...Results }
  whiteWalkers: search(query: $whiteWalkers, type: ISSUE, first: 50) { ...Results }
}
fragment Results on SearchResultItemConnection {
  issueCount pageInfo { hasNextPage endCursor }
  nodes { ...PullRequestDetails }
}
fragment PullRequestDetails on PullRequest {
    id number title url isDraft updatedAt state headRefOid
    author { login } repository { nameWithOwner mergeCommitAllowed viewerPermission }
    assignees(first: 100) { nodes { login } }
    headRefName baseRefName reviewDecision mergeable mergeStateStatus
    commits(last: 1) { nodes { commit { statusCheckRollup {
      contexts(first: 100) { totalCount nodes {
        ... on CheckRun { name status conclusion detailsUrl }
        ... on StatusContext { context state targetUrl }
      } }
    } } } }
}`;

export const WHITE_WALKERS_PAGE_QUERY = `query($search: String!, $cursor: String!) {
  viewer { login }
  whiteWalkers: search(query: $search, type: ISSUE, first: 50, after: $cursor) { ...Results }
}
${QUERY.slice(QUERY.indexOf("fragment Results"))}`;

export function canMerge(pr, login) {
  return Boolean(login && pr.state === "OPEN" && !pr.isDraft && pr.headRefOid);
}

export function checks(pr) {
  const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts;
  return { rows: contexts?.nodes ?? [], total: contexts?.totalCount ?? 0 };
}

export function checkKind(check) {
  const state = check.conclusion || check.state;
  if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"].includes(state)) return "failed";
  if (check.status && check.status !== "COMPLETED") return "pending";
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) return "passed";
  return "pending";
}

export function ciSummary(pr) {
  const { rows, total } = checks(pr);
  if (!total) return { label: "No checks", kind: "none" };
  const failed = rows.filter(c => checkKind(c) === "failed").length;
  const pending = rows.filter(c => checkKind(c) === "pending").length;
  if (failed) return { label: `CI failed · ${failed}`, kind: "failed" };
  if (pending) return { label: `CI pending · ${pending}`, kind: "pending" };
  if (total > rows.length) return { label: `CI partial · ${rows.length}/${total}`, kind: "none" };
  return { label: `CI passed · ${total}`, kind: "passed" };
}

export function reviewLabel(pr) {
  return ({ APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Review required" })[pr.reviewDecision] || "Not reviewed";
}

export function accountsFrom(hosts) {
  return hosts.flatMap(h => h.accounts.map(a => ({ ...a, host: h.host, key: `${h.host}/${a.login}` })));
}
