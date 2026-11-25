# Jira workspace bundle

Jira sprint browsing and issue editing with a custom workspace tab bar. Includes an optional example layout.

## Setup

- Install Atlassian CLI `acli`, authenticate it yourself, and ensure the GUI can find it.
- In mods/jira-sprint/main.js, set CLI to your executable if necessary, BOARD to your Jira board ID, and STORY_POINTS to the correct custom field ID.
- In mods/jira-sprint/issue-dialog.js replace YOUR_SITE.atlassian.net with your Jira Cloud hostname.
- Install jira-sprint and jira-tabs, then check both. Open jira-sprint as a tab, or wire both mods into a personal layout.
- The optional layouts/jira-workspace.json also requires ai-usage, files-icons, review-changes and all four PR mods from the sibling bundles. Copy those first; do not overwrite an existing layout. Configure AI usage before switching to the example layout.
- The template keeps required panel IDs so the Jira and AI usage toggles work. Standard Herdr chrome/spaces/agents/pane mods and icons come from Herdr itself.

## Access and actions

acli queries board sprints, work items and assignment/story-point details every minute. Explicit issue-save actions edit Jira summaries, descriptions and/or statuses. The editor converts between Markdown and Jira ADF with round-trip checks; unsupported content is rejected rather than silently lost. Browser actions currently use macOS /usr/bin/open. No Jira authentication or issue data is exported here.

The Jira logo/priority assets still require provenance clearance. See the root public-release checklist.
