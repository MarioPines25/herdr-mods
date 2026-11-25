import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { checking, exec, settings, openOverlay, shared } from "herdr";
import { githubColors } from "./colors.js";
import { GROUPS, QUERY, WHITE_WALKERS_PAGE_QUERY, groupQuery, accountsFrom, ciSummary, reviewLabel, canMerge } from "./model.js";

async function gh(args) {
  const r = await exec("gh", args, { timeout: 45000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `gh exited ${r.code}`).trim());
  return r.stdout;
}

export default class PullRequests extends View {
  init(props, cx) {
    this.compact = props?.compact !== false;
    this.accounts = []; this.selected = null; this.data = null; this.busy = false;
    this.error = null; this.updated = null; this.accountMenu = false;
    const savedGroup = localStorage.getItem("group");
    this.group = GROUPS.some(g => g.key === savedGroup) ? savedGroup : "assigned";
    this.filter = "";
    this.input = InputState.new({ placeholder: "Filter by title, repo or #number" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value().toLowerCase(); cx.notify(); });
    // Pure initial rendering during native checks; test harnesses may omit host imports.
    if (typeof checking === "function" && checking()) return;
    this.refresh(cx);
    cx.timer.every(60000, (cx) => this.refresh(cx));
  }

  refresh(cx, switchTo = null) {
    if (this.busy) return;
    this.busy = true; this.error = null; this.accountMenu = false;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (switchTo) {
          await gh(["auth", "switch", "--hostname", switchTo.host, "--user", switchTo.login]);
          this.selected = switchTo; this.data = null; this.updated = null;
          localStorage.setItem("account", switchTo.key);
        }
        const hosts = JSON.parse(await gh(["auth", "status", "--json", "hosts", "--jq",
          ".hosts | to_entries | map({host: .key, accounts: [.value[] | {login,active,state}]})"]));
        this.accounts = accountsFrom(hosts);
        const saved = localStorage.getItem("account");
        // Follow the CLI's active login on the chosen host, including external switches.
        const preferredHost = this.selected?.host || this.accounts.find(a => a.key === saved)?.host;
        const account = this.accounts.find(a => a.host === preferredHost && a.active) || this.accounts.find(a => a.active);
        if (!account) throw new Error("No GitHub account found. Run gh auth login in a terminal, then Refresh.");
        if (this.selected?.key !== account.key) { this.data = null; this.updated = null; }
        this.selected = account;
        if (account.state !== "success") throw new Error(`Authentication failed for ${account.login}. Run gh auth login --hostname ${account.host}.`);
        const args = ["api", "graphql", "--hostname", account.host, "-f", `query=${QUERY}`];
        for (const g of GROUPS) args.push("-f", `${g.key}=${groupQuery(g, account.login)}`);
        const result = JSON.parse(await gh(args));
        if (result.errors?.length) throw new Error(result.errors.map(e => e.message).join("; "));
        // An environment token or another gh process can override the selected identity.
        if (result.data?.viewer?.login?.toLowerCase() !== account.login.toLowerCase()) {
          this.data = null; this.updated = null;
          throw new Error("gh is using a different identity (possibly GH_TOKEN/GITHUB_TOKEN or an external account switch). Remove the override and Refresh.");
        }
        await this.loadWhiteWalkers(result.data.whiteWalkers, account);
        this.data = result.data; this.updated = new Date().toLocaleTimeString();
      } catch (e) { this.error = String(e).slice(0, 1400); }
      finally { this.busy = false; cx.notify(); }
    });
  }

  async loadWhiteWalkers(group, account) {
    if (!group) throw new Error('GitHub returned no Team results.');
    let fetched = group.nodes.length;
    const cursors = new Set();
    const search = groupQuery(GROUPS.find(g => g.key === 'whiteWalkers'), account.login);
    while (group.pageInfo?.hasNextPage && fetched < 1000) {
      const cursor = group.pageInfo.endCursor;
      if (!cursor || cursors.has(cursor)) throw new Error('Cannot paginate Team results. Refresh to retry.');
      cursors.add(cursor);
      const result = JSON.parse(await gh(['api', 'graphql', '--hostname', account.host,
        '-f', `query=${WHITE_WALKERS_PAGE_QUERY}`, '-f', `search=${search}`, '-f', `cursor=${cursor}`]));
      if (result.errors?.length) throw new Error(result.errors.map(e => e.message).join('; '));
      if (result.data?.viewer?.login?.toLowerCase() !== account.login.toLowerCase()) {
        this.data = null; this.updated = null;
        throw new Error('GitHub account changed while loading Team. Refresh to retry.');
      }
      const page = result.data.whiteWalkers;
      if (!Array.isArray(page?.nodes)) throw new Error('GitHub returned an invalid Team page.');
      fetched += page.nodes.length;
      group.nodes.push(...page.nodes);
      group.pageInfo = page.pageInfo;
    }
    // Search indexing can shift between pages. Never show the same PR twice.
    group.nodes = [...new Map(group.nodes.filter(p => p?.id).map(p => [p.id, p])).values()];
  }

  open(pr, cx) {
    cx.spawn(async (cx) => {
      try { await gh(["pr", "view", pr.url, "--web"]); }
      catch (e) { this.error = String(e); cx.notify(); }
    });
  }

  review(pr) {
    openOverlay({ mod: "pr-review", props: { url: pr.url }, kind: "dialog", modal: true, width: 0.94, height: 0.92 });
  }

  sendToAgent(pr) {
    openOverlay({ mod: "pr-agent", props: { url: pr.url }, kind: "dialog", modal: true, width: 560, height: 440 });
  }

  merge(pr) {
    if (this.busy || this.error || !canMerge(pr, this.selected?.login)) return;
    openOverlay({ mod: "pr-merge", kind: "dialog", modal: true, width: 680, height: 560,
      props: { host: this.selected.host, repo: pr.repository.nameWithOwner, number: pr.number,
        login: this.selected.login, head: pr.headRefOid, baseRef: pr.baseRefName } });
  }

  button(id, label, action, selected = false) {
    const t = githubColors(settings().dark);
    return div().id(id).px(8).py(7).cursor_pointer().text_size(12)
      .font_medium().text_color(selected ? t.foreground : t.muted)
      .border_b(2).border_color(selected ? "#fd8c73" : t.raised)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).child(label).on_click(action);
  }

  actionButton(id, label, action, primary = false, disabled = false, icon = null) {
    const dark = settings().dark;
    return div().id(id).px(10).py(5).rounded(6).border_1()
      .border_color(primary ? (dark ? "#3c914c" : "#1f7a39") : (dark ? "#30363d" : "#d1d9e0"))
      .bg(primary ? (dark ? "#238636" : "#1f883d") : (dark ? "#212830" : "#f6f8fa"))
      .text_color(primary ? "#ffffff" : (dark ? "#e6edf3" : "#1f2328"))
      .text_size(12).font_semibold().flex().items_center().gap(6)
      .when(Boolean(icon), e => e.child(svg(`mods/pr-status/icons/${icon}.svg`).size(16).flex_none()))
      .child(label)
      .when(!disabled, e => e.cursor_pointer().on_click(action))
      .when(disabled, e => e.tooltip(this.busy ? "Refreshing PRs — merge is temporarily unavailable" : "Refresh successfully before merging"));
  }

  badge(label, color) {
    const t = githubColors(settings().dark);
    return div().px(7).py(1).rounded(12).border_1().border_color(t.border).text_size(10).font_medium().text_color(color || t.muted).child(label);
  }

  row(pr) {
    const t = githubColors(settings().dark), ci = ciSummary(pr);
    // GitHub Primer fgColor.success/danger/attention/muted (standard light/dark).
    const colors = settings().dark
      ? { passed: "#3fb950", failed: "#f85149", pending: "#d29922", none: "#9198a1" }
      : { passed: "#1a7f37", failed: "#d1242f", pending: "#9a6700", none: "#59636e" };
    const ciIcon = { passed: "check", failed: "x", pending: "dot-fill", none: ci.label === "No checks" ? "skip" : "question" }[ci.kind];
    const stateColor = pr.isDraft ? t.draft : pr.state === "MERGED" ? t.closed : pr.state === "CLOSED" ? t.ansi1 : t.ansi2;
    return v_flex().id(`pr-${pr.id}`).flex_none().px(12).py(14).gap(7)
      .border_b(1).border_color(t.border).hover(s => s.bg(t.hover))
      .child(h_flex().items_center().gap(8)
        .child(svg("mods/pr-status/icons/git-pull-request-16.svg").size(16).flex_none().text_color(stateColor))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(`${pr.repository.nameWithOwner}  #${pr.number}`))
        .child(div().id(`ci-${pr.id}`).size(18).flex_none().flex().items_center().justify_center()
          .accessibility_label(ci.label).tooltip(ci.label)
          .child(svg(`mods/pr-status/icons/${ciIcon}-16.svg`).size(16).text_color(colors[ci.kind])))
        .child(this.button(`open-${pr.id}`, this.compact ? "↗" : "Open ↗", (_e, cx) => this.open(pr, cx))))
      .child(div().id(`title-${pr.id}`).font_semibold().text_size(13).text_color(t.foreground).cursor_pointer().hover(s => s.text_color(t.accent)).on_click((_e, cx) => this.open(pr, cx)).child(pr.title))
      .child(v_flex().gap(2).children([
        ["From", pr.headRefName], ["Into", pr.baseRefName]
      ].map(([label, branch]) => h_flex().gap(5).items_center()
        .child(div().w(30).flex_none().text_size(11).text_color(t.dim).child(label))
        .child(div().id(`branch-${label}-${pr.id}`).min_w(0).truncate().px(5).py(2).rounded(4).bg(t.branch).text_size(11).text_color(t.branchText)
          .tooltip(branch || "Unknown branch").child(branch || "Unknown branch")))))
      .child(h_flex().flex_wrap().gap(5)
        .when(pr.isDraft, e => e.child(this.badge("Draft")))
        .when(pr.state !== "OPEN", e => e.child(this.badge(pr.state, t.blocked)))
        .child(this.badge(reviewLabel(pr), pr.reviewDecision === "APPROVED" ? t.ansi2 : pr.reviewDecision === "CHANGES_REQUESTED" ? t.ansi1 : t.muted))
        .when(pr.mergeable === "CONFLICTING", e => e.child(this.badge("Conflicts", t.ansi1)))
        .when(pr.mergeStateStatus === "BLOCKED", e => e.child(this.badge("Merge blocked", t.blocked)))
        .when(pr.mergeStateStatus === "BEHIND", e => e.child(this.badge("Branch behind", t.blocked))))
      .child(div().id(`author-${pr.id}`).min_w(0).truncate().text_size(11).text_color(t.muted)
        .tooltip(`Author: @${pr.author?.login || "deleted"}`).child(`#${pr.number} by @${pr.author?.login || "deleted"}`))
      .child(h_flex().mt(6).gap(8).items_center().flex_wrap()
        .child(this.actionButton(`review-${pr.id}`, this.compact ? "Diff" : "Review changes", () => this.review(pr), false, false, "diff"))
        .child(this.actionButton(`agent-${pr.id}`, "Send to agent…", () => this.sendToAgent(pr), false, false, "agent"))
        .child(div().flex_1())
        .when(canMerge(pr, this.selected?.login), e =>
          e.child(this.actionButton(`merge-${pr.id}`, "Merge", () => this.merge(pr), true, Boolean(this.busy || this.error), "merge"))));
  }

  render() {
    const t = githubColors(settings().dark), group = this.data?.[this.group];
    const merged = shared("github.mergedPRs") || {};
    const rows = (group?.nodes || []).filter(p => p.id
      && !merged[`${this.selected?.host}/${p.repository.nameWithOwner}#${p.number}`]
      && `${p.title} ${p.repository.nameWithOwner} #${p.number}`.toLowerCase().includes(this.filter));
    return v_flex().size_full().min_w(0).min_h(0).bg(t.background).border_t(1).border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().flex_none().px(12).py(10).gap(6).items_center().bg(t.raised).border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_size(13).child("Pull requests"))
        .child(this.actionButton("accounts", this.selected ? `${this.selected.login} ▾` : "Accounts ▾", (_e, cx) => { this.accountMenu = !this.accountMenu; cx.notify(); }))
        .child(this.actionButton("refresh", this.compact ? (this.busy ? "…" : "↻") : (this.busy ? "Refreshing…" : "Refresh"), (_e, cx) => this.refresh(cx))))
      .when(this.accountMenu, e => e.child(v_flex().flex_none().px(14).pb(10).gap(5)
        .child(div().text_size(11).text_color(t.dim).child("Switches gh's active account for this host, including other CLI use."))
        .children(this.accounts.map(a => this.button(`account-${a.key}`, `${a.login} · ${a.host}${a.key === this.selected?.key ? " ✓" : ""}${a.state !== "success" ? " · auth error" : ""}`,
          (_e, cx) => this.refresh(cx, a), a.key === this.selected?.key)))))
      .child(h_flex().flex_none().px(4).gap(0).bg(t.raised).border_b(1).border_color(t.border).flex_wrap().children(GROUPS.map(g =>
        this.button(`group-${g.key}`, `${this.compact ? ({ assigned: "Assigned", authored: "Mine", requested: "Review" })[g.key] || g.label : g.label}${this.data ? ` (${this.data[g.key]?.issueCount ?? 0})` : ""}`, (_e, cx) => {
          this.group = g.key; localStorage.setItem("group", g.key); cx.notify();
        }, this.group === g.key))))
      .child(div().flex_none().mx(12).my(10).h(30).px(8).bg(t.background).rounded(6).border_1().border_color(t.border).child(Input.new(this.input).h_full().text_color(t.foreground)))
      .when(Boolean(this.error), e => e.child(div().flex_none().px(14).pb(10).text_size(12).text_color(t.ansi1).child(`${this.data ? "Refresh failed · showing previous results. " : ""}${this.error}`)))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("pr-list").absolute().inset_0().overflow_y_scroll().pb(8).gap(0)
          .children(rows.map(p => this.row(p)))
          .when(!rows.length, e => e.child(div().p(16).text_color(t.dim).child(this.busy && !this.data ? "Loading your pull requests…" : !this.data ? "No data yet. Check gh authentication and Refresh." : this.filter ? "No PRs match your filter." : "No open pull requests in this view.")))
          .when(Boolean(group?.pageInfo?.hasNextPage), e => e.child(div().text_color(t.blocked).text_size(11).child(this.group === 'whiteWalkers'
            ? 'GitHub search is limited to 1,000 results. More matching PRs may exist; narrow the search on GitHub.'
            : 'Showing the 50 most recently updated PRs. Narrow by repository on GitHub for more.'))))
        .child(Scrollbar.vertical("pr-list").absolute().inset_0()))
      .child(div().flex_none().px(this.compact ? 8 : 14).py(this.compact ? 4 : 8).border_t(1).border_color(t.border).text_size(this.compact ? 10 : 11).text_color(t.dim)
        .child(this.compact ? `↻ 60s${this.updated ? ` · ${this.updated}` : ""}` : `${this.selected?.host || "GitHub"} · Auto-refresh 60s${this.updated ? ` · Updated ${this.updated}` : ""} · CI from latest commit`));
  }
}
