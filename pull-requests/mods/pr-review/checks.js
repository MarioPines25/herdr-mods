// Checks are pinned to the displayed PR head, never to a moving branch name.
// Both APIs are needed: Actions/check runs and legacy commit status contexts.
export async function loadChecks(api, repo, sha) {
  const root = `repos/${repo}/commits/${sha}`;
  async function pages(endpoint, key) {
    const rows = [];
    let total = 0;
    for (let page = 1; page <= 10; page++) {
      const result = await api(`${root}/${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(result?.[key]) || !Number.isInteger(result.total_count)) {
        throw new Error('Unexpected GitHub checks response');
      }
      rows.push(...result[key]); total = result.total_count;
      if (result[key].length < 100 || rows.length >= total) break;
    }
    return { rows, partial: rows.length < total };
  }
  const [runs, statuses] = await Promise.all([
    pages('check-runs?filter=latest', 'check_runs'), pages('status', 'statuses'),
  ]);
  const rows = [
    ...runs.rows.map(run => {
      const result = run.conclusion?.toLowerCase();
      const kind = run.status !== 'completed' ? 'pending'
        : result === 'success' ? 'success'
        : result === 'skipped' ? 'skipped' : result === 'neutral' ? 'neutral'
        : ['failure', 'timed_out', 'cancelled', 'action_required', 'stale', 'startup_failure'].includes(result) ? 'failure' : 'unknown';
      const label = run.status === 'in_progress' ? 'In progress' : run.status === 'queued' ? 'Queued'
        : (run.status !== 'completed' ? run.status : result || 'Unknown')?.replaceAll('_', ' ');
      return { id: `run-${run.id}`, name: run.name || 'Check', app: run.app?.name || '', kind,
        label, description: run.output?.title || '', url: detailsUrl(run.html_url || run.details_url) };
    }),
    ...statuses.rows.map(status => ({
      id: `status-${status.id}`, name: status.context || 'Commit status', app: '',
      kind: status.state === 'success' ? 'success' : ['error', 'failure'].includes(status.state) ? 'failure'
        : status.state === 'pending' ? 'pending' : 'unknown',
      label: status.state || 'Unknown', description: status.description || '', url: detailsUrl(status.target_url),
    })),
  ];
  const order = { failure: 0, pending: 1, unknown: 2, success: 3, neutral: 4, skipped: 5 };
  rows.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  return { rows, partial: runs.partial || statuses.partial };
}

export function detailsUrl(value) {
  return typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value) ? value : null;
}

export function checksSummary(checks) {
  if (!checks) return { kind: 'unknown', title: 'Loading checks…', detail: '' };
  const counts = {};
  for (const row of checks.rows) counts[row.kind] = (counts[row.kind] || 0) + 1;
  const detail = ['failure', 'pending', 'success', 'neutral', 'skipped', 'unknown'].filter(k => counts[k])
    .map(k => `${counts[k]} ${{failure:'failing',pending:'pending',success:'successful',neutral:'neutral',skipped:'skipped',unknown:'unknown'}[k]}`).join(', ');
  if (counts.failure) return { kind: 'failure', title: 'Some checks were not successful', detail };
  if (checks.partial || counts.unknown) return { kind: 'unknown', title: 'Some check results are unavailable', detail };
  if (counts.pending) return { kind: 'pending', title: 'Some checks haven’t completed yet', detail };
  if (!checks.rows.length) return { kind: 'unknown', title: 'No checks reported', detail: 'No check runs or commit statuses for this commit.' };
  return { kind: counts.success ? 'success' : 'neutral', title: counts.skipped || counts.neutral ? 'All checks have completed' : 'All checks have passed', detail };
}
