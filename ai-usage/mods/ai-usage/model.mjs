export function percentage(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

export function codexWindow(window) {
  if (!window) return null;
  const used = percentage(window.usedPercent);
  return { remaining: used === null ? null : 100 - used,
    minutes: window.windowDurationMins ?? null,
    resetsAt: typeof window.resetsAt === 'number' ? window.resetsAt * 1000 : null };
}

export function availableCredits(summary, now = Date.now()) {
  if (!Array.isArray(summary?.credits)) return [];
  return summary.credits.filter(c => c.id && c.status === 'available' && c.resetType === 'codexRateLimits'
    && (c.expiresAt == null || c.expiresAt * 1000 > now));
}

export function normalizeCodex(response, account) {
  const limits = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
  const summary = response.rateLimitResetCredits;
  return {
    // Bind reset controls to the quota response, never an independently fetched account.
    accountId: response.accountId || null,
    accountLabel: response.accountId
      ? `${account?.accountId === response.accountId && account?.email ? account.email : 'ChatGPT account'} · ${response.accountId}`
      : 'ChatGPT account (identity unavailable)',
    plan: limits?.planType || account?.planType || 'ChatGPT',
    primary: codexWindow(limits?.primary), secondary: codexWindow(limits?.secondary),
    ordinaryUsageAllowed: response.ordinaryUsageAllowed ?? null,
    resetsSupported: summary != null,
    resetCount: summary == null ? null : Number(summary.availableCount),
    credits: availableCredits(summary).map(c => ({
      id: c.id, title: c.title || 'Full reset · weekly + 5-hour',
      description: c.description || 'Reset your weekly and five-hour usage limits.',
      expiresAt: c.expiresAt == null ? null : c.expiresAt * 1000,
    })),
    creditsDetailed: Array.isArray(summary?.credits),
  };
}

export function normalizeCopilot(response, auth) {
  const snapshots = response?.quotaSnapshots;
  if (!snapshots || typeof snapshots !== 'object') throw new Error('Copilot returned no quota snapshots.');
  return {
    accountLabel: auth?.login || 'Copilot CLI account',
    quotas: Object.entries(snapshots).map(([id, q]) => ({
      id, unlimited: q.isUnlimitedEntitlement === true,
      remaining: percentage(q.remainingPercentage),
      tokenBasedBilling: q.tokenBasedBilling === true,
      used: typeof q.usedRequests === 'number' ? q.usedRequests : null,
      total: typeof q.entitlementRequests === 'number' ? q.entitlementRequests : null,
      // Copilot currently returns an unverified near-now resetDate. Do not infer a billing countdown.
      resetDate: q.resetDate || null,
    })),
  };
}

export function validateNewReset(snapshot, intent, now = Date.now()) {
  if (!snapshot.accountId || snapshot.accountId !== intent.accountId) throw new Error('Codex account changed or cannot be verified. Refresh before resetting.');
  const credit = snapshot.credits.find(c => c.id === intent.creditId);
  if (!credit || (credit.expiresAt != null && credit.expiresAt <= now)) throw new Error('That reset credit is no longer available. Refresh and select again.');
  return credit;
}

export const RESET_MESSAGES = {
  reset: 'Usage reset successfully.',
  nothingToReset: 'Your usage does not need a reset right now.',
  noCredit: 'No reset credit is available.',
  alreadyRedeemed: 'This reset credit was already redeemed.',
};
