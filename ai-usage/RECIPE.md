# AI usage

A native allowance dashboard with a compact top strip and a detailed two-provider dialog. Preview pending; no live account screenshots are included.

## What you see
A 64px strip with rounded Codex and Copilot groups, provider icons, and remaining percentages. Details opens a 980×740 dialog: Codex five-hour/weekly windows and credits alongside Copilot premium, Chat and Completions. Theme green/yellow/red correspond to above 50%, above 20% through 50%, and 20% or less. Unknown is a dash; unlimited is infinity.

## How it behaves
Refresh every 60 seconds and manually in Details. The tab-bar AI usage button toggles the whole strip. Credit selection loads fresh eligibility, then requires explicit confirmation; polling never spends credits. Unknown outcomes retain the same recovery key. Working agent states are not displayed by this mod.

## Built from
ai-usage/main.js uses herdr exec/readTextFile/appHome and native overlays. Node helper.mjs talks to the configured Codex RPC and Copilot SDK; model.mjs normalizes quotas, rpc.mjs handles line-delimited RPC, reset.mjs owns durable reset safety. Props: topBar true for the strip; compact false for Details. Jira-tabs supplies the strip toggle in the example layout.

## Watch out
Copy config.example.json locally and set actual absolute executable/SDK paths. runtime npm ci supplies the pinned Codex package. Binary path is architecture-specific. Account state and reset recovery journals must remain local. Do not manually call reset or delete an uncertain attempt.

## Done when
Native check passes without launching helpers; fake-provider tests pass; configured accounts load quotas; narrow-strip scrolling works; hide/show preserves the tab-bar toggle; credit confirmation can be cancelled without spending.
