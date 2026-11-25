# AI usage

Personal Herdr mod, embedded in `layouts/jira-workspace.json`. A toggleable 64px horizontal summary bar above the workspace tabs shows Codex Plus five-hour and weekly remaining allowance and Copilot premium allowance. It uses separate rounded provider groups, 20px icons and 18px color-coded percentages. Click **AI usage** in the workspace tab bar to show or hide the entire strip. The button stays available while the strip is hidden and is highlighted when visible. Herdr remembers the visibility as layout state.

The only top-bar button is **Details ↗**, which opens a 980px-wide modal with Codex and Copilot side by side. Copilot's premium allowance appears first, followed by Chat and Completions. Codex shows its usage windows, reset times, account identity and available reset credits with expiry. Premium allowance is a Copilot metric, not a Codex metric. Manual refresh and the protected credit redemption flow remain in the modal.

Usage refreshes automatically every 60 seconds. The summary groups scroll horizontally on narrow windows while Details stays accessible. The bar is independent of the sidebar and remains present across workspace tabs. Polling never redeems a credit.

Top-strip props are `{ topBar: true }`; its fixed height is defined in the personal layout. No shared collapse state is used. Details use `{ compact: false }`; legacy compact vertical embeds remain supported.

## Allowance colors

The dashboard uses rounded provider cards with icons, large percentage readouts in Details, slim progress tracks, and side-by-side five-hour/weekly Codex metrics. **Details ↗** opens credit details and the existing confirmation flow. Colors use the active theme's ANSI green/yellow/red palette. Each allowance is **Healthy** (green, above 50% remaining), **Low** (yellow, above 20% through 50%), or **Critical** (red, 20% or less). Percentages and status captions keep color from being the only indicator. Unknown readings show a neutral dash and empty bar; unlimited entitlements show an infinity symbol and explicit label, not a depleted allowance.

## Dependencies and account selection

`config.json` contains executable paths, not credentials:

- `node`: installed Node executable (currently Node 24).
- `codex`: private native Codex CLI under `runtime/`, pinned through `runtime/package.json` and its lockfile to `@openai/codex@0.167.0`. This does not replace the user's global CLI. To reinstall: `cd mods/ai-usage/runtime && npm ci`.
- `copilot`: existing Copilot CLI.
- `copilotSdk`: the SDK bundled with that CLI. No additional Copilot dependency is installed.

The helper uses each CLI's existing signed-in account. It does not scrape conversations, read credential files itself, store tokens, create chat sessions, or generate billable AI prompts. Provider clients may perform their own authentication maintenance. Usage reads reach provider services through the CLIs. API changes, CLI upgrades, organization policy or login expiry may make readings unavailable.

GUI launches may lack shell PATH; the helper prepends the configured Node executable's directory for Copilot's `env node` launcher.

Copilot is the allowance of the logged-in CLI user, **not enterprise-wide billing or organization analytics**. Percentages are preserved on the provider's 0–100 scale. Billing units and cycle-reset dates are deliberately not inferred: this version's Copilot endpoint reports token-based billing and a near-current `resetDate`, which is not a trustworthy monthly countdown.

Codex quota identity is taken from the rate-limit response. Account email is shown only when the separate account response explicitly matches that identity; otherwise the account ID is displayed instead. If identity cannot be verified, reset controls are disabled.

## Redeeming a Codex reset

1. Open Details and select a specific available, unexpired credit.
2. Review the fresh account identity, selected credit and expiry.
3. Click **Yes, use one reset**. This spends one credit to reset both weekly and five-hour usage limits. Merely viewing usage or opening the confirmation spends nothing.

No automatic reset, scheduled reset, purchased credit, or account switching is implemented. The result is re-read from the provider after the operation. Tests use fake providers and do not spend real credits.

Safety measures: disabled double clicks, fresh eligibility and account checks, a filesystem lock shared across mod copies, a journal persisted before the consume request, and provider idempotency keys. Completed spent-credit receipts prevent stale confirmations from sending another consume request even if a quota read is stale. No-op results are distinguished from successful resets.

If a request times out or its outcome is unknown, **do not start another reset elsewhere**. Refresh, choose **Review same attempt…**, verify the saved account and credit ID, and confirm **Retry same attempt**. This reuses the same credit ID and idempotency key; it never silently selects another credit. Switching accounts blocks recovery until the original account is restored.

### Crash/lock recovery

`.reset-attempt.json` contains account/credit IDs, idempotency keys and completion receipts, mode 0600. `.reset-lock/owner` identifies the helper holding the lock. These are local state, not credentials. Never delete the journal to bypass an uncertain result.

If the UI reports an abandoned lock, inspect `.reset-lock/owner` and verify that PID is no longer a running helper (and no other reset helper is active). Only after verifying it has stopped, remove `.reset-lock/owner` and the empty `.reset-lock` directory. Refresh and resolve the saved attempt with the same key. Do not clear a live lock. Corrupt journals fail closed and require manual recovery; don't overwrite one without resolving its provider result.

## Checks

From the Herdr home:

```sh
herdr-app check mods/ai-usage
node --test tests/ai-usage.test.mjs
```

`node mods/ai-usage/helper.mjs usage` is a read-only usage diagnostic. It returns account identifiers and allowance data, not authentication tokens. Do not invoke `reset` manually unless you intend to redeem a real credit.

To show or hide the panel, click **AI usage** in the tab bar, or run `herdr-app do layout.toggle --id ai-usage-panel`. No shipped layout or mod was modified.
