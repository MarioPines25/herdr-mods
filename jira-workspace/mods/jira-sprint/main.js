import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, TextareaState } from "gpui-base";
import { checking, exec, theme, settings, openOverlay, props, shared, setShared } from "herdr";
import { dialogView } from "./issue-dialog.js";
import { adfToMarkdown, markdownToAdf, comparableAdf } from "./description-format.js";

// Atlassian-inspired semantic colors, with matching light/dark surfaces.
function jiraTheme() {
  const base = theme();
  return { ...base, ...(settings().dark ? {
    chrome: "#1D2125", background: "#161A1D", surface: "#22272B", raised: "#2C333A",
    hover: "#333C43", border: "#38414A", input: "#738496", foreground: "#DEE4EA",
    muted: "#B6C2CF", dim: "#9FADBC", accent: "#85B8FF", selected: "#1C3B61",
    done: "#7EE2B8", working: "#F5CD47", blocked: "#FD9891",
    blueFill: "#0C66E4", blueText: "#FFFFFF", doneBg: "#164B35", progressBg: "#1C3B61",
    avatarBg: "#352C63", avatarText: "#D8C7FF"
  } : {
    chrome: "#F7F8F9", background: "#F1F2F4", surface: "#FFFFFF", raised: "#F1F2F4",
    hover: "#EBECF0", border: "#DCDFE4", input: "#8590A2", foreground: "#172B4D",
    muted: "#44546F", dim: "#626F86", accent: "#0C66E4", selected: "#E9F2FF",
    done: "#216E4E", working: "#946F00", blocked: "#AE2A19",
    blueFill: "#0C66E4", blueText: "#FFFFFF", doneBg: "#DCFFF1", progressBg: "#E9F2FF",
    avatarBg: "#F3F0FF", avatarText: "#5E4DB2"
  }) };
}

// Configure these non-secret settings before installing this export.
const CLI = "acli";
const BOARD = "YOUR_BOARD_ID";
const STORY_POINTS = "customfield_10014";
const ISSUE_FIELDS = "summary,description,assignee,status,priority,issuetype,updated";

export default class JiraSprint extends View {
  init(_props, cx) {
    this.mode = "active";
    this.statusFilters = new Set();
    this.onlyMine = false;
    this.views = {
      active: this.newView(),
      future: this.newView(),
    };
    this.editors = new Map();
    this.dismissedFailures = new Set();
    const supplied = props()?.issueKey ? props() : _props;
    this.dialog = supplied?.issueKey ? supplied : null;
    // Pure initial rendering during native checks; test harnesses may omit host imports.
    if (typeof checking === "function" && checking()) return;
    if (this.dialog) this.loadEditor({ key: this.dialog.issueKey }, cx);
    else {
      this.savedIssue = shared("jira.issue.saved");
      cx.timer.every(60000, cx => this.refresh(cx));
      this.refresh(cx);
    }
  }

  newView() {
    return { sprints: [], loading: false, detailsLoading: false, mineLoading: false, mineError: null, error: null, detailError: null, updated: null, fetchedAt: null };
  }

  get currentView() { return this.views[this.mode]; }
  get sprints() { return this.currentView.sprints; }
  get loading() { return this.currentView.loading; }
  get error() { return this.currentView.error; }
  set error(value) { this.currentView.error = value; }
  get updated() { return this.currentView.updated; }
  set updated(value) { this.currentView.updated = value; }

  async query(args) {
    const r = await exec(CLI, ["jira", ...args, "--json"], { timeout: 60000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "acli failed. Check acli jira auth status in your terminal.");
    return JSON.parse(r.stdout);
  }

  refresh(cx) {
    const mode = this.mode, view = this.views[mode];
    if (view.loading || view.detailsLoading) return;
    view.loading = true;
    view.error = null;
    view.detailError = null;
    view.mineError = null;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const data = await this.query(["board", "list-sprints", "--id", BOARD, "--state", mode, "--paginate"]);
        const sprints = Array.isArray(data) ? data : data.sprints;
        if (!Array.isArray(sprints)) throw new Error("Unexpected sprint response from acli.");
        const next = [];
        for (const sprint of sprints) {
          const result = await this.query(["sprint", "list-workitems", "--board", BOARD, "--sprint", String(sprint.id), "--fields", "key,summary,status,priority,assignee", "--paginate", "--limit", "10000"]);
          const issues = Array.isArray(result) ? result : result.issues;
          if (!Array.isArray(issues)) throw new Error("Unexpected issue response from acli.");
          if (typeof result.total === "number" && issues.length < result.total) throw new Error("acli returned an incomplete issue list; refresh to retry.");
          next.push({ ...sprint, issues });
        }
        view.sprints = next;
        // Assignment lookup is optional: a slow/failing search must not hide issues.
        if (!view.mineLoading) {
          view.mineLoading = true;
          cx.spawn(async cx => {
            try {
              for (const sprint of next) {
                const mine = await this.query(["workitem", "search", "--jql", `sprint = ${Number(sprint.id)} AND assignee = currentUser()`, "--fields", "key,assignee", "--paginate"]);
                const assigned = Array.isArray(mine) ? mine : mine.issues;
                if (!Array.isArray(assigned) || assigned.some(i => !i?.key)) throw new Error("Invalid assignment response.");
                if (typeof mine.total === "number" && assigned.length < mine.total) throw new Error("Incomplete assignment response.");
                const mineKeys = new Set(assigned.map(i => i.key));
                // Ignore results for a list replaced by a newer refresh.
                if (view.sprints === next) {
                  for (const issue of sprint.issues) issue.assignedToMe = mineKeys.has(issue.key);
                }
                cx.notify();
              }
            } catch (e) {
              view.mineError = `Assigned-to-me lookup failed. Other issues remain available. ${String(e.message || e).slice(0, 200)}`;
            } finally { view.mineLoading = false; cx.notify(); }
          });
        }
        view.updated = new Date().toLocaleTimeString();
        view.fetchedAt = Date.now();
        // Optional details must not lock tabs, filters, or editing.
        view.loading = false;
        view.detailsLoading = next.some(s => s.issues.length > 0);
        cx.notify();
        for (const sprint of next) {
          const issues = sprint.issues;
          // acli's sprint/search output omits custom fields; view exposes them.
          for (let offset = 0; offset < issues.length; offset += 4) {
            await Promise.all(issues.slice(offset, offset + 4).map(async issue => {
              try {
                const detail = await this.query(["workitem", "view", issue.key, "--fields", STORY_POINTS]);
                if (!detail?.fields) throw new Error(`Could not read story points for ${issue.key}.`);
                issue.fields = { ...issue.fields, [STORY_POINTS]: detail.fields[STORY_POINTS] ?? null };
              } catch (e) {
                view.detailError = `Some story points could not be loaded: ${String(e.message || e).slice(0, 300)}`;
              }
            }));
            cx.notify();
          }
        }
      } catch (e) {
        view.error = String(e.message || e).slice(0, 400);
      } finally {
        view.loading = false;
        view.detailsLoading = false;
        cx.notify();
      }
    });
  }

  choose(mode, cx) {
    if (mode === this.mode) return;
    this.mode = mode;
    cx.notify();
    const view = this.currentView;
    // Revisit fresh tabs instantly; keep stale results visible during refresh.
    if (view.fetchedAt === null || Date.now() - view.fetchedAt >= 60000) this.refresh(cx);
  }

  open(url, cx) {
    cx.spawn(async cx => {
      try {
        const r = await exec("/usr/bin/open", [url]);
        if (r.code !== 0) throw new Error("Could not open Jira in your browser.");
      } catch (e) { this.error = String(e.message || e); cx.notify(); }
    });
  }

  edit(issue, _cx) {
    openOverlay({
      mod: "jira-sprint", kind: "dialog", modal: true, frame: "none",
      width: 0.78, height: 0.85,
      props: { issueKey: issue.key, statuses: [...new Set(this.sprints.flatMap(s => s.issues.map(i => i.fields?.status?.name)).filter(Boolean))] }
    });
  }

  loadEditor(issue, cx) {
    const existing = this.editors.get(issue.key);
    if (existing) { existing.hidden = false; cx.notify(); return; }
    const ed = {
      key: issue.key, busy: true, error: null, note: null, snapshot: null,
      assignee: InputState.new({ placeholder: "Unchanged · or email/account ID" }),
      status: InputState.new({ placeholder: "Exact Jira status name" }),
      summary: InputState.new({ placeholder: "Issue title" }),
      description: TextareaState.new({ placeholder: "Add a description…", rows: 10 }),
      editingDescription: false
    };
    this.editors.set(issue.key, ed);
    cx.notify();
    cx.spawn(async cx => {
      try {
        const current = await this.query(["workitem", "view", ed.key, "--fields", ISSUE_FIELDS]);
        if (!current.fields?.status?.name) throw new Error("Could not read the issue's current status.");
        ed.snapshot = current.fields;
        this.resetDraft(ed);
      } catch (e) { ed.error = String(e.message || e); }
      finally { ed.busy = false; cx.notify(); }
    });
  }

  async updateIssue(key, fields) {
    for (const view of Object.values(this.views)) {
      for (const sprint of view.sprints) {
        for (const issue of sprint.issues) {
          if (issue.key === key) issue.fields = { ...issue.fields, ...fields };
        }
      }
    }
  }

  async assigneeMatches(key, target, actual) {
    if (target === "unassigned") return !actual;
    if (actual?.accountId === target || actual?.emailAddress?.toLowerCase() === target.toLowerCase()) return true;
    if (!target.includes("@") || !actual?.accountId) return false;
    // Jira Cloud can hide emailAddress. Ask Jira to resolve the email in JQL,
    // then compare the account ID rather than treating a hidden email as failure.
    const result = await this.query(["workitem", "search", "--jql",
      `key = ${JSON.stringify(key)} AND assignee = ${JSON.stringify(target)}`,
      "--fields", "key,assignee", "--paginate"]);
    const issues = Array.isArray(result) ? result : result.issues;
    return Array.isArray(issues) && issues.some(issue => issue.key === key && issue.fields?.assignee?.accountId === actual.accountId);
  }

  apply(cx, ed) {
    if (!ed || ed.busy || !ed.snapshot) return;
    const assignee = ed.assignee.value().trim();
    const status = ed.status.value().trim();
    const summary = ed.summary.value().trim();
    const description = ed.description.value();
    const descriptionChanged = ed.editingDescription && description !== adfToMarkdown(ed.snapshot.description).trim();
    let descriptionDocument;
    if (descriptionChanged) {
      try { descriptionDocument = markdownToAdf(description); }
      catch (e) { ed.error = String(e.message || e); cx.notify(); return; }
    }
    if (!summary) { ed.error = "Issue title cannot be empty."; cx.notify(); return; }
    if (!status) { ed.error = "Enter a status name, or leave the current status unchanged."; cx.notify(); return; }
    ed.busy = true; ed.error = null; ed.note = null;
    cx.notify();
    cx.spawn(async cx => {
      let attempted = false;
      try {
        const before = await this.query(["workitem", "view", ed.key, "--fields", ISSUE_FIELDS]);
        if (!before.fields?.status?.name) throw new Error("Could not verify current issue state. Nothing was changed.");
        const previous = ed.snapshot;
        ed.snapshot = before.fields;
        await this.updateIssue(ed.key, before.fields);
        if (previous.updated !== before.fields.updated
          || previous.summary !== before.fields.summary
          || JSON.stringify(previous.description) !== JSON.stringify(before.fields.description)
          || (previous.assignee?.accountId || "") !== (before.fields.assignee?.accountId || "")
          || previous.status?.id !== before.fields.status?.id) {
          this.resetDraft(ed);
          throw new Error("This issue changed in Jira since you opened Edit. Inputs were reset to the latest state. Choose your changes again.");
        }
        let expectedAssigneeId = assignee ? before.fields.assignee?.accountId || null : undefined;
        const assignChange = assignee && (assignee === "unassigned" ? !!before.fields.assignee : assignee !== before.fields.assignee?.accountId && assignee !== before.fields.assignee?.emailAddress);
        if (assignChange) {
          let target = assignee;
          if (target === "@me") {
            const auth = await exec(CLI, ["jira", "auth", "status"], { timeout: 15000 });
            const email = /Email:\s*(\S+@\S+)/.exec(auth.stdout)?.[1];
            if (auth.code !== 0 || !email) throw new Error("Could not identify the authenticated Jira account. Enter your email instead.");
            target = email;
          }
          attempted = true;
          const args = ["jira", "workitem", "assign", "--key", ed.key, "--yes", "--json"];
          if (target === "unassigned") args.push("--remove-assignee");
          else args.push("--assignee", target);
          const r = await exec(CLI, args, { timeout: 60000 });
          if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || "Assignment failed.");
          const assigned = await this.query(["workitem", "view", ed.key, "--fields", ISSUE_FIELDS]);
          ed.snapshot = assigned.fields;
          await this.updateIssue(ed.key, assigned.fields);
          const actual = assigned.fields?.assignee;
          if (!await this.assigneeMatches(ed.key, target, actual)) {
            throw new Error("Jira did not confirm the requested assignee. Review the current value before retrying.");
          }
          expectedAssigneeId = actual?.accountId || null;
          ed.assignee.set_value("");
          ed.note = "Assignee updated and re-read from Jira.";
          if (assigned.fields.status?.id !== before.fields.status.id
            || assigned.fields.summary !== before.fields.summary
            || JSON.stringify(assigned.fields.description) !== JSON.stringify(before.fields.description)) {
            throw new Error("Issue content or status changed while saving the assignee. Review Jira's current state before continuing.");
          }
        }
        if (summary !== before.fields.summary || descriptionChanged) {
          attempted = true;
          const args = ["jira", "workitem", "edit", "--key", ed.key, "--yes", "--json", "--summary", summary];
          if (descriptionChanged) args.push("--description", JSON.stringify(descriptionDocument));
          const r = await exec(CLI, args, { timeout: 60000 });
          if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || "Issue update failed.");
        }
        if (status !== ed.snapshot.status.name) {
          attempted = true;
          const r = await exec(CLI, ["jira", "workitem", "transition", "--key", ed.key, "--status", status, "--yes", "--json"], { timeout: 60000 });
          if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || "Status change failed.");
        }
        const after = await this.query(["workitem", "view", ed.key, "--fields", ISSUE_FIELDS]);
        if (!after.fields?.status?.name) throw new Error("Could not verify the saved issue.");
        ed.snapshot = after.fields;
        await this.updateIssue(ed.key, after.fields);
        if (after.fields.summary !== summary) throw new Error("Jira did not confirm the requested title. Review the current values.");
        if (descriptionChanged && JSON.stringify(comparableAdf(after.fields.description)) !== JSON.stringify(comparableAdf(descriptionDocument))) throw new Error("Jira did not confirm the requested Markdown description. Review the current values.");
        if (after.fields.status.name !== status) throw new Error("Jira did not confirm the requested status. Review the current values.");
        if (expectedAssigneeId !== undefined && (after.fields.assignee?.accountId || null) !== expectedAssigneeId) throw new Error("Assignee changed during the save. Review the current values.");
        setShared("jira.issue.saved", { key: ed.key, fields: after.fields, savedAt: Date.now() });
        ed.note = "Changes saved and verified in Jira.";
        this.resetDraft(ed);
      } catch (e) {
        ed.error = `${String(e.message || e).slice(0, 400)}${attempted ? " Changes may be partial; no automatic retry was made." : ""}`;
        if (attempted) {
          try {
            const actual = await this.query(["workitem", "view", ed.key, "--fields", ISSUE_FIELDS]);
            if (!actual.fields?.status?.name) throw new Error("Invalid verification response");
            ed.snapshot = actual.fields;
            await this.updateIssue(ed.key, actual.fields);
            this.resetDraft(ed);
            setShared("jira.issue.saved", { key: ed.key, fields: actual.fields, savedAt: Date.now() });
            ed.note = "Re-read Jira. Review the current values before making another change.";
          } catch (_) {
            ed.snapshot = null;
            ed.note = "Could not verify the result. Close Edit and reopen it to read Jira before retrying.";
          }
        }
      } finally { ed.busy = false; cx.notify(); }
    });
  }

  resetDraft(ed) {
    ed.assignee.set_value("");
    ed.status.set_value(ed.snapshot.status.name);
    ed.summary.set_value(ed.snapshot.summary || "");
    ed.description.set_value(adfToMarkdown(ed.snapshot.description).trim());
    ed.editingDescription = false;
    ed.descriptionPreview = false;
  }

  visibleFailure(message) {
    return !!message && !this.dismissedFailures.has(message);
  }

  get displayedFailures() {
    const view = this.currentView;
    return [view.error, view.mineError, view.detailError,
      ...[...this.editors.values()].filter(ed => !ed.hidden).map(ed => ed.error)]
      .filter(message => this.visibleFailure(message));
  }

  dismissFailures(cx) {
    for (const message of this.displayedFailures) this.dismissedFailures.add(message);
    cx.notify();
  }

  button(id, label, action, t, selected = false) {
    return div().id(id).px(6).py(3).rounded(5).cursor_pointer().text_size(11)
      .bg(selected ? t.selected : t.chrome).text_color(selected ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).child(label).on_click(action);
  }

  priorityVisual(priority, t) {
    const hint = `${priority?.name || ""} ${priority?.iconUrl || ""}`.toLowerCase();
    if (/highest|blocker|critical|máxima|crítica/.test(hint)) return { icon: "highest", color: t.blocked };
    if (/lowest|mínima/.test(hint)) return { icon: "lowest", color: t.dim };
    if (/high|alta/.test(hint)) return { icon: "high", color: t.blocked };
    if (/medium|normal|media/.test(hint)) return { icon: "medium", color: t.working };
    if (/low|baja/.test(hint)) return { icon: "low", color: t.accent };
    return { icon: "unknown", color: t.muted };
  }

  matches(issue) {
    return (!this.onlyMine || issue.assignedToMe === true)
      && (!this.statusFilters.size || this.statusFilters.has(issue.fields?.status?.name || "Unknown"));
  }

  toggleStatus(name, cx) {
    if (this.statusFilters.has(name)) this.statusFilters.delete(name);
    else this.statusFilters.add(name);
    cx.notify();
  }

  render(cx) {
    if (this.dialog) return dialogView(this, jiraTheme());
    const t = theme();
    const saved = shared("jira.issue.saved");
    if (saved && saved !== this.savedIssue) {
      this.savedIssue = saved;
      this.updateIssue(saved.key, saved.fields);
      for (const view of Object.values(this.views)) view.fetchedAt = null;
      this.refresh(cx);
    }
    const allIssues = this.sprints.flatMap(s => s.issues);
    const count = allIssues.length;
    const shown = allIssues.filter(i => this.matches(i)).length;
    const statuses = [...new Set([...allIssues.map(i => i.fields?.status?.name || "Unknown"), ...this.statusFilters])].sort();
    const filtered = this.onlyMine || this.statusFilters.size > 0;
    return v_flex().size_full().min_w(0).bg(t.chrome).text_color(t.foreground).text_size(12)
      .child(v_flex().flex_none().px(10).py(8).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().items_center().justify_between().gap(8)
          .child(h_flex().items_center().gap(7)
            .child(svg("mods/jira-sprint/jira.svg").size(18).text_color(t.accent))
            .child(div().text_size(13).text_color(t.muted).child("Jira · Sprints")))
          .child(this.button("refresh", this.loading ? "…" : "↻", (_e, cx) => this.refresh(cx), t).tooltip("Refresh sprint issues")))
        .child(h_flex().gap(6)
          .child(this.button("current", "Current", (_e, cx) => this.choose("active", cx), t, this.mode === "active"))
          .child(this.button("upcoming", "Upcoming", (_e, cx) => this.choose("future", cx), t, this.mode === "future")))
        .child(v_flex().gap(7).pt(7).border_t(1).border_color(t.border)
          .child(h_flex().items_center().justify_between()
            .child(div().text_size(10).font_semibold().text_color(t.dim).child("FILTERS"))
            .when(filtered, row => row.child(this.button("filter-clear", "Reset", (_e, cx) => {
              this.onlyMine = false; this.statusFilters.clear(); cx.notify();
            }, t).accessibility_label("Clear all Jira filters").tooltip("Reset assignee and all status filters"))))
          .child(h_flex().gap(3).p(2).rounded(6).border(1).border_color(t.border)
            .child(this.button("filter-all", "All issues", (_e, cx) => {
              this.onlyMine = false; cx.notify();
            }, t, !this.onlyMine).flex_1().text_center())
            .child(this.button("filter-mine", "Assigned to me", (_e, cx) => {
              this.onlyMine = true; cx.notify();
            }, t, this.onlyMine).flex_1().text_center()))
          .child(h_flex().items_center().justify_between()
            .child(div().text_size(10).text_color(t.dim).child("Status · select one or more"))
            .child(div().text_size(10).text_color(t.muted).child(`${shown} / ${count}`)))
          .child(h_flex().flex_wrap().gap(4).children(statuses.map((name, index) => {
            const selected = this.statusFilters.has(name);
            const matching = allIssues.filter(i => (i.fields?.status?.name || "Unknown") === name && (!this.onlyMine || i.assignedToMe === true));
            return h_flex().id(`filter-status-${index}`).items_center().gap(5).px(6).py(3).rounded(5)
              .border(1).border_color(selected ? t.accent : t.border)
              .bg(selected ? t.selected : t.chrome).text_color(selected ? t.foreground : t.muted).text_size(10)
              .cursor_pointer().hover(s => s.bg(t.hover))
              .tooltip(`${selected ? "Remove" : "Include"} ${name} · Multiple statuses can be selected`)
              .accessibility_label(`${name}: ${matching.length} issues${selected ? ", selected" : ""}`)
              .on_click((_e, cx) => this.toggleStatus(name, cx))
              .when(selected, el => el.child(div().text_color(t.accent).child("✓")))
              .child(div().child(name))
              .child(div().text_color(t.dim).child(this.onlyMine && this.currentView.mineLoading ? "…" : String(matching.length)));
          }))))
        .when(this.loading, el => el.child(div().text_color(t.muted).child("Loading sprint issues… You can switch tabs.")))
        .when(this.currentView.detailsLoading, el => el.child(div().text_color(t.dim).child("Loading story points…")))
        .when(this.currentView.mineLoading, el => el.child(div().text_color(t.dim).child("Checking assignments…")))
        .when(this.displayedFailures.length > 0, el => el.child(this.button("dismiss-failures", "Dismiss errors", (_e, cx) => this.dismissFailures(cx), t)))
        .when(this.visibleFailure(this.currentView.mineError), el => el.child(div().text_color(t.blocked).child(this.currentView.mineError)))
        .when(this.visibleFailure(this.currentView.detailError), el => el.child(div().text_color(t.blocked).child(this.currentView.detailError)))
        .when(this.visibleFailure(this.error), el => el.child(div().text_color(t.blocked).child(`${this.error}${this.updated ? " · Showing last successful results." : ""}`))))
      .child(v_flex().id("jira-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(6).py(8).gap(10)
        .when(!this.loading && !this.error && !this.sprints.length, el => el.child(v_flex().p(8).gap(8)
          .child(div().font_semibold().child(this.mode === "active" ? "No active sprint" : "No upcoming sprints"))
          .child(div().text_color(t.muted).child(this.mode === "active" ? "Jira has no sprint marked active on this board. Try Upcoming to view planned work." : "No future sprints were returned by Jira."))))
        .when(filtered && count > 0 && shown === 0, el => el.child(div().p(8).text_color(t.muted).child(this.onlyMine && this.currentView.mineLoading ? "Checking your assignments… Clear filters to see all issues now." : this.onlyMine && this.currentView.mineError ? "Could not check your assignments. Clear filters to see all issues." : "No issues match these filters. Clear filters to see all sprint issues.")))
        .children(this.sprints.map(s => {
          const visible = s.issues.filter(i => this.matches(i));
          const done = s.issues.filter(i => i.fields?.status?.statusCategory?.key === "done").length;
          return v_flex().gap(3)
            .child(h_flex().items_center().justify_between().gap(6).px(4)
              .child(div().flex_1().min_w(0).truncate().text_color(t.muted).text_size(12).tooltip(s.name).child(s.name))
              .child(div().text_size(10)
                .text_color(s.state === "active" ? t.accent : t.dim)
                .child(s.state === "active" ? "ACTIVE" : "UPCOMING")))
            .child(div().px(4).pb(4).text_size(10).text_color(t.dim).child(`${done} of ${s.issues.length} completed${s.issues.length ? ` · ${Math.round(done / s.issues.length * 100)}%` : ""}`))
            .when(filtered, el => el.child(div().text_color(t.dim).child(`${visible.length} / ${s.issues.length} shown`)))
            .when(!s.issues.length, el => el.child(div().text_color(t.muted).child("This sprint has no issues.")))
            .children(visible.map(issue => {
              const f = issue.fields || {};
              const priority = this.priorityVisual(f.priority, t);
              const category = f.status?.statusCategory?.key;
              const color = category === "done" ? t.done : category === "indeterminate" ? t.accent : t.muted;
              const assignee = f.assignee?.displayName || "Unassigned";
              return v_flex().id(`issue-${s.id}-${issue.key}`).px(6).py(7).gap(4).rounded(6)
                .hover(style => style.bg(t.hover))
                .child(h_flex().items_center().justify_between().gap(8)
                  .child(div().id(`open-${s.id}-${issue.key}`).cursor_pointer().text_color(t.accent).font_semibold().child(issue.key)
                    .tooltip("Open issue details").on_click((_e, cx) => this.edit(issue, cx)))
                  .child(div().max_w(160).truncate().text_size(10)
                    .text_color(color).tooltip(f.status?.name || "Unknown").child((f.status?.name || "Unknown").toUpperCase())))
                .child(h_flex().items_start().gap(8)
                  .child(div().id(`summary-${s.id}-${issue.key}`).flex_1().min_w(0).text_size(12).cursor_pointer()
                    .hover(style => style.text_color(t.accent)).child(f.summary || "Untitled issue").on_click((_e, cx) => this.edit(issue, cx)))
                  .child(div().flex_none().text_size(10).text_color(t.dim).tooltip("Story points")
                    .child(String(f[STORY_POINTS] ?? "—"))))
                .child(h_flex().items_center().gap(6).text_size(10)
                  .child(div().flex_1().min_w(0).truncate().text_color(t.dim).tooltip(assignee).child(assignee))
                  .child(h_flex().flex_none().items_center().gap(4).text_color(priority.color)
                    .child(svg(`mods/jira-sprint/priority-${priority.icon}.svg`).size(12))
                    .child(div().child(f.priority?.name || "No priority"))));
            }));
        })))
      .child(div().flex_none().px(10).py(5).border_t(1).border_color(t.border).text_size(10).text_color(t.dim)
        .child(this.updated ? `Last synced ${this.updated} · acli` : "Connecting to Jira · acli"));
  }
}
