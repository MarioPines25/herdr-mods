import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, h_resizable, resizable_panel, Scrollbar, v_virtual_list, TextareaState, Textarea, TextView } from "gpui-base";
import { labelColors } from "./description.js";
import { loadGeneralComments, generalCommentArgs, commentTime } from "./comments.js";
import { checking, exec, settings, props, closeOverlay, openOverlay, shared } from "herdr";
import { githubColors } from "./colors.js";
import { loadChecks, checksSummary } from "./checks.js";
import { targetFrom, diffRows, patchNotice, sameRevision, previewFile, approvalError, approvalArgs, commentAnchor, inlineCommentError, inlineCommentArgs } from "./model.js";

export default class PRReview extends View {
  init(_props, cx) {
    const config = props();
    this.overlay = config?.overlay || null;
    this.url = config?.url; this.files = []; this.rows = []; this.selected = null;
    this.meta = null; this.busy = false; this.error = ""; this.browserError = "";
    this.activeTab = "files";
    this.collapsedFolders = new Set();
    this.viewer = null; this.confirmApproval = false; this.approving = false;
    this.approvalError = ""; this.approvalNotice = ""; this.approvedHead = null;
    this.draft = null; this.postingComment = false; this.commentError = ""; this.commentNotice = "";
    this.checks = null; this.checksError = ""; this.checksBusy = false; this.checkGeneration = 0;
    this.commentInput = TextareaState.new({ placeholder: "Write an inline comment… Markdown is supported.", rows: 4 });
    this.commentInput.on("change", (_e, cx) => cx.notify());
    this.generalComments = []; this.generalLoaded = false; this.generalBusy = false; this.generalPartial = false;
    this.generalError = ""; this.generalNotice = ""; this.postingGeneral = false;
    this.generalInput = TextareaState.new({ placeholder: "Write a general PR comment… Markdown is supported.", rows: 4 });
    this.generalPreview = false; this.confirmDiscardGeneral = false;
    this.generalInput.on("change", (_e, cx) => { this.confirmDiscardGeneral = false; cx.notify(); });
    // Pure initial rendering during native checks; test harnesses may omit host imports.
    if (typeof checking === "function" && checking()) return;
    cx.timer.every(30000, cx => this.refreshChecks(cx));
    try { this.target = targetFrom(config); this.refresh(cx); }
    catch (e) { this.error = String(e); }
  }

  async api(path) {
    const r = await exec("gh", ["api", "--hostname", this.target.host, path], { timeout: 45000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || `gh exited ${r.code}`).slice(0, 1400));
    return JSON.parse(r.stdout);
  }

  refresh(cx) {
    if (this.busy || this.approving || this.postingComment || this.postingGeneral || !this.target) return;
    if (this.draft) { this.commentError = "Post or discard your inline comment draft before refreshing."; cx.notify(); return; }
    this.confirmApproval = false; this.approvalError = ""; this.approvalNotice = "";
    this.busy = true; this.error = ""; this.files = []; this.rows = []; this.file = null; this.meta = null;
    this.checkGeneration++; this.checks = null; this.checksError = ""; this.checksBusy = false;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const { repo, number } = this.target, path = `repos/${repo}/pulls/${number}`;
        const viewer = await this.api("user");
        const before = await this.api(path), files = [];
        let remaining = 8_000_000;
        // GitHub caps this endpoint at 3,000 files. Bounded sequential requests
        // also avoid an unbounded --paginate response in the host command buffer.
        for (let page = 1; page <= 30; page++) {
          const batch = await this.api(`${path}/files?per_page=100&page=${page}`);
          if (!Array.isArray(batch)) throw new Error("Unexpected GitHub files response");
          for (const raw of batch) {
            const file = previewFile(raw, remaining);
            remaining -= file.patch?.length || 0;
            files.push(file);
          }
          if (batch.length < 100 || files.length >= before.changed_files) break;
        }
        const after = await this.api(path);
        if (!sameRevision(before, after)) throw new Error("PR changed while loading. Refresh to fetch a consistent revision.");
        this.meta = after; this.files = files; this.viewer = viewer.login;
        this.pick(files.find(f => f.filename === this.selected) || files[0], cx);
      } catch (e) { this.error = String(e).slice(0, 1400); }
      finally { this.busy = false; this.refreshChecks(cx); cx.notify(); }
    });
  }

  refreshChecks(cx) {
    if (!this.meta || this.busy || this.checksBusy || !this.target) return;
    const snapshot = this.meta, generation = ++this.checkGeneration;
    this.checksBusy = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const checks = await loadChecks(path => this.api(path), this.target.repo, snapshot.head.sha);
        if (this.meta !== snapshot || this.checkGeneration !== generation) return;
        this.checks = checks; this.checksError = "";
      } catch (e) {
        if (this.meta === snapshot && this.checkGeneration === generation) this.checksError = String(e).slice(0, 1000);
      } finally {
        if (this.meta === snapshot && this.checkGeneration === generation) { this.checksBusy = false; cx.notify(); }
      }
    });
  }

  refreshGeneralComments(cx) {
    if (!this.target || this.generalBusy || this.postingGeneral) return;
    this.generalBusy = true; this.generalError = ""; cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await loadGeneralComments(path => this.api(path), this.target);
        this.generalComments = result.comments; this.generalPartial = result.partial; this.generalLoaded = true;
      } catch (e) { this.generalError = `${String(e).slice(0, 1400)} Previous comments, if any, may be outdated.`; }
      finally { this.generalBusy = false; cx.notify(); }
    });
  }

  postGeneralComment(cx) {
    if (!this.meta || !this.viewer || this.busy || this.postingGeneral || this.postingComment || this.approving || this.generalBusy) return;
    const body = this.generalInput.value(), login = this.viewer;
    if (!body.trim() || body.length > 65536) {
      this.generalError = "Enter a comment of at most 65,536 characters."; cx.notify(); return;
    }
    this.postingGeneral = true; this.generalError = ""; this.generalNotice = ""; cx.notify();
    cx.spawn(async cx => {
      let submitted = false;
      try {
        const viewer = await this.api("user");
        if (viewer.login?.toLowerCase() !== login.toLowerCase()) throw new Error("GitHub account changed. Refresh the PR before posting.");
        submitted = true;
        const r = await exec("gh", generalCommentArgs(this.target, body), { timeout: 45000 });
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || `gh exited ${r.code}`);
        const comment = JSON.parse(r.stdout);
        if (!comment.id || comment.body !== body || comment.user?.login?.toLowerCase() !== login.toLowerCase()) throw new Error("GitHub returned an unexpected comment response.");
        this.generalComments = [...this.generalComments.filter(c => c.id !== comment.id), comment];
        this.generalInput.set_value(""); this.generalPreview = false; this.confirmDiscardGeneral = false;
        this.generalNotice = `Comment posted as @${login}.`;
      } catch (e) {
        this.generalError = `${String(e).slice(0, 1400)}${submitted ? " Submission may have reached GitHub; refresh comments and check the PR before retrying to avoid a duplicate." : ""}`;
      } finally { this.postingGeneral = false; cx.notify(); }
    });
  }

  commentAvatar(login, t) {
    return div().w(32).h(32).flex_none().rounded(16).bg(t.selected).text_color(t.accent)
      .flex().items_center().justify_center().text_size(13).font_semibold().tooltip(login || "Deleted account")
      .child((login || "?").slice(0, 2).toUpperCase());
  }

  generalCommentCard(c, t) {
    const login = c.user?.login || "deleted-user";
    const author = this.meta?.user?.login?.toLowerCase() === login.toLowerCase();
    const association = c.author_association && !["NONE", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR"].includes(c.author_association)
      ? c.author_association.toLowerCase().replace(/_/g, " ") : "";
    return h_flex().id(`pr-general-comment-${c.id}`).flex_none().min_w(0).gap(12).items_start()
      .child(this.commentAvatar(login, t))
      .child(v_flex().flex_1().min_w(0).rounded(6).border_1().border_color(author ? t.accent : t.border).overflow_hidden()
        .child(h_flex().flex_none().px(12).py(10).gap(6).items_center().flex_wrap().bg(t.raised).border_b(1).border_color(t.border)
          .child(div().font_semibold().text_size(12).child(login))
          .child(div().text_size(12).text_color(t.muted).tooltip(c.created_at || "Unknown time").child(`commented ${commentTime(c.created_at)}`))
          .when(Boolean(c.updated_at && c.updated_at !== c.created_at), e => e.child(div().text_size(11).text_color(t.muted).tooltip(c.updated_at).child("· edited")))
          .child(div().flex_1())
          .when(author || Boolean(association), e => e.child(div().px(6).py(1).rounded(12).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(author ? "Author" : association)))
          .when(/^https:\/\//.test(c.html_url || ""), e => e.child(div().id(`pr-general-link-${c.id}`).px(4).text_color(t.muted).cursor_pointer().tooltip("View comment on GitHub")
            .child("↗").on_click((_e, cx) => cx.open_url(c.html_url)))))
        .child(div().p(16).min_w(0).child(TextView.markdown(`pr-general-body-${c.id}-${c.updated_at || ""}`, c.body || "_Empty comment._").w_full())));
  }

  generalCommentComposer(t) {
    const body = this.generalInput.value();
    const canPost = Boolean(this.meta && this.viewer && body.trim() && body.length <= 65536 && !this.postingGeneral && !this.generalBusy && !this.busy && !this.approving && !this.postingComment);
    const toggle = (id, label, preview) => div().id(id).px(12).py(10).text_size(12).font_semibold().cursor_pointer()
      .bg(this.generalPreview === preview ? t.background : t.raised)
      .border_b(2).border_color(this.generalPreview === preview ? t.accent : t.raised)
      .text_color(this.generalPreview === preview ? t.foreground : t.muted).child(label)
      .on_click((_e, cx) => {
        if (this.postingGeneral) return;
        this.generalPreview = preview; this.confirmDiscardGeneral = false;
        if (!preview) this.generalInput.focus();
        cx.notify();
      });
    return h_flex().id("pr-general-composer").flex_none().min_w(0).gap(12).p(16).border_t(1).border_color(t.border).items_start()
      .child(this.commentAvatar(this.viewer, t))
      .child(v_flex().flex_1().min_w(0).gap(8)
        .child(div().font_semibold().text_size(13).child("Add a comment"))
        .child(v_flex().rounded(6).border_1().border_color(t.border).overflow_hidden()
          .child(h_flex().flex_none().gap(2).items_center().bg(t.raised).border_b(1).border_color(t.border)
            .child(toggle("pr-general-write", "Write", false)).child(toggle("pr-general-preview", "Preview", true))
            .child(div().flex_1())
            .child(div().px(12).text_size(11).text_color(t.muted).child("Markdown supported")))
          .when(!this.postingGeneral && !this.generalPreview, e => e.child(div().h(128).p(10).bg(t.editor)
            .child(Textarea.new(this.generalInput).h_full().text_color(t.foreground).text_size(13))))
          .when(!this.postingGeneral && this.generalPreview, e => e.child(div().id("pr-general-preview-body").h(128).overflow_y_scrollbar().p(12).bg(t.background)
            .child(TextView.markdown("pr-general-draft", body.trim() ? body : "_Nothing to preview._").w_full())))
          .when(this.postingGeneral, e => e.child(div().h(128).p(16).text_color(t.muted).child("Posting comment…"))))
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(div().flex_1().text_size(11).text_color(t.muted).child(`Commenting as @${this.viewer || "unknown"}`))
          .when(Boolean(body) && !this.postingGeneral, e => e.child(this.button("pr-general-discard", this.confirmDiscardGeneral ? "Keep draft" : "Discard draft", (_e, cx) => {
            if (this.postingGeneral) return;
            this.confirmDiscardGeneral = !this.confirmDiscardGeneral; cx.notify();
          })))
          .when(this.confirmDiscardGeneral && !this.postingGeneral, e => e.child(this.button("pr-general-confirm-discard", "Confirm discard", (_e, cx) => {
            if (this.postingGeneral) return;
            this.generalInput.set_value(""); this.generalPreview = false; this.confirmDiscardGeneral = false;
            this.generalError = ""; this.generalNotice = ""; cx.notify();
          })))
          .child(this.button("pr-general-post", this.postingGeneral ? "Commenting…" : "Comment", (_e, cx) => {
            if (canPost) this.postGeneralComment(cx);
          }, true).when(!canPost, e => e.opacity(0.5))))
        .when(body.length > 65536, e => e.child(div().text_size(11).text_color(t.ansi1).child("Comment exceeds GitHub's 65,536-character limit.")))
        .when(Boolean(this.generalNotice), e => e.child(div().text_size(12).text_color(t.ansi2).child(this.generalNotice))));
  }

  generalCommentsPanel(t) {
    return v_flex().id("pr-general-tab").flex_1().min_h(0).min_w(0).m(16).rounded(6).border_1().border_color(t.border).overflow_hidden()
      .child(h_flex().flex_none().px(16).py(10).gap(8).items_center().bg(t.raised)
        .child(div().flex_1().font_semibold().child("General PR comments"))
        .child(this.button("pr-general-refresh", this.generalBusy ? "Loading…" : "Refresh comments", (_e, cx) => this.refreshGeneralComments(cx))))
      .child(div().flex_none().px(16).py(6).text_size(11).text_color(t.muted).child("PR discussion comments only—not inline threads or review summaries."))
      .when(Boolean(this.generalError), e => e.child(div().flex_none().px(16).py(8).text_color(t.ansi1).child(this.generalError)))
      .when(this.generalPartial, e => e.child(div().flex_none().px(16).py(6).text_color(t.blocked).child("Partial discussion: first 1,000 comments shown. Open on GitHub for all comments.")))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("pr-general-list").absolute().inset_0().overflow_y_scroll().p(16).gap(12)
          .when(!this.generalComments.length, e => e.child(div().text_color(t.muted).child(this.generalBusy ? "Loading comments…" : this.generalLoaded ? "No general comments yet." : "Refresh comments to load the discussion.")))
          .children(this.generalComments.map(c => this.generalCommentCard(c, t))))
        .child(Scrollbar.vertical("pr-general-list").absolute().inset_0()))
      .child(this.generalCommentComposer(t));
  }

  checkIcon(kind, t) {
    const color = kind === "failure" ? t.ansi1 : kind === "success" ? t.ansi2 : kind === "pending" ? t.blocked : t.muted;
    if (kind === "pending") return svg("mods/pr-review/icons/checks/spinner.svg").size(16).flex_none().text_color(color).spin(1000);
    return this.icon(`checks/${({ success: "check-16", failure: "x-16", skipped: "skip-16", neutral: "skip-16" })[kind] || "question-16"}`, color);
  }

  checksPanel(t) {
    const summary = this.checksError
      ? { kind: "unknown", title: "Checks could not be refreshed", detail: this.checks ? "Previous results may be outdated." : "The diff is still available. Refresh checks to retry." }
      : checksSummary(this.checks);
    return v_flex().id("pr-checks-tab").flex_1().min_h(0).min_w(0).m(16).rounded(6).border_1().border_color(t.border).overflow_hidden()
      .child(h_flex().flex_none().px(16).py(12).gap(10).items_center().flex_wrap().bg(t.raised)
        .child(this.checkIcon(summary.kind, t))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(div().font_semibold().child(summary.title))
          .child(div().text_size(12).text_color(t.muted).child(summary.detail || `Checks for ${this.meta.head.sha.slice(0, 8)}`)))
        .when(this.checksBusy, e => e.child(div().text_size(11).text_color(t.muted).child("Updating…")))
        .child(div().id("pr-checks-refresh").px(6).py(4).text_color(t.muted).cursor_pointer().tooltip("Refresh checks")
          .child("↻").on_click((_e, cx) => this.refreshChecks(cx))))
      .when(Boolean(this.checksError), e => e.child(div().px(16).py(8).border_t(1).border_color(t.border).text_size(12).text_color(t.ansi1).child(this.checksError)))
      .when(Boolean(this.checks?.partial), e => e.child(div().px(16).py(8).text_size(12).text_color(t.blocked).child("Partial results: showing up to 1,000 check runs and 1,000 status contexts. Open on GitHub for all checks.")))
      .when(Boolean(this.checks?.rows.length), e => e.child(
        div().id("pr-checks-viewport").flex_1().min_h(0).relative()
          .child(v_flex().id("pr-checks-list").absolute().inset_0().overflow_y_scroll().children(this.checks.rows.map(check =>
          h_flex().id(`pr-check-${check.id}`).flex_none().px(16).py(9).gap(10).items_center().border_t(1).border_color(t.border)
            .child(this.checkIcon(check.kind, t))
            .child(v_flex().flex_1().min_w(0).gap(3)
              .child(h_flex().gap(6).items_center()
                .child(div().min_w(0).truncate().font_semibold().text_size(12).child(check.name))
                .when(Boolean(check.app), row => row.child(div().text_size(11).text_color(t.muted).child(check.app))))
              .child(div().truncate().text_size(11).text_color(t.muted).child([check.label, check.description].filter(Boolean).join(" — "))))
            .when(Boolean(check.url), row => row.child(div().id(`pr-check-link-${check.id}`).text_size(12).text_color(t.accent).cursor_pointer()
              .child("Details").on_click((_e, cx) => cx.open_url(check.url)))))))
          .child(Scrollbar.vertical("pr-checks-list").absolute().inset_0())));
  }

  descriptionPanel(t) {
    const m = this.meta, labels = m.labels || [];
    return v_flex().id("pr-description-tab").flex_1().min_h(0).min_w(0).m(16).rounded(6).border_1().border_color(t.border).overflow_hidden()
      .child(h_flex().flex_none().px(16).py(12).gap(8).items_center().bg(t.raised)
        .child(this.icon("comment", t.muted))
        .child(div().font_semibold().child("Description and labels"))
        .child(div().px(7).py(1).rounded(20).bg(t.badge).text_size(12).child(String(labels.length))))
      .child(div().id("pr-description-viewport").flex_1().min_h(0).relative().border_t(1).border_color(t.border)
          .child(v_flex().id("pr-description-content").absolute().inset_0().overflow_y_scroll().p(16).gap(16)
            .child(v_flex().flex_none().gap(8)
              .child(div().text_size(12).font_semibold().text_color(t.muted).child("Labels"))
              .child(h_flex().flex_wrap().gap(6).children(labels.map((label, i) => {
                const colors = labelColors(label.color);
                return div().id(`pr-description-label-${i}`).px(9).py(2).rounded(20).border_1().border_color(colors.border)
                  .bg(colors.background).text_color(colors.foreground).text_size(12).font_semibold()
                  .tooltip(label.description || label.name).child(label.name);
              })).when(!labels.length, row => row.child(div().text_size(12).text_color(t.muted).child("None yet")))))
            .child(v_flex().flex_none().min_w(0).gap(8).pt(12).border_t(1).border_color(t.border)
              .child(div().text_size(12).font_semibold().text_color(t.muted).child(m.user?.login ? `@${m.user.login} · Description` : "Description"))
              .child(TextView.markdown(`pr-description-${this.target.repo}-${m.number}`, m.body?.trim() || "_No description provided._").w_full())))
          .child(Scrollbar.vertical("pr-description-content").absolute().inset_0()));
  }

  tab(id, label, icon, t, count = null) {
    const active = this.activeTab === id;
    return h_flex().id(`pr-tab-${id}`).gap(7).px(10).py(8).items_center().cursor_pointer()
      .border_b(2).border_color(active ? t.accent : t.raised)
      .text_color(active ? t.foreground : t.muted).hover(s => s.bg(t.hover))
      .child(icon).child(div().font_semibold().child(label))
      .when(count != null, e => e.child(div().px(7).py(1).rounded(20).bg(t.badge).text_size(12).child(String(count))))
      .on_click((_e, cx) => {
        this.activeTab = id;
        if (id === "comments" && !this.generalLoaded) this.refreshGeneralComments(cx);
        cx.notify();
      });
  }

  wasMerged() {
    return Boolean(this.target && shared("github.mergedPRs")?.[`${this.target.host}/${this.target.repo}#${this.target.number}`]);
  }

  merge() {
    const m = this.meta;
    if (!m || m.state !== "open" || m.draft || !this.viewer || this.busy || this.approving || this.postingComment || this.postingGeneral || this.draft || this.wasMerged()) return;
    this.confirmApproval = false;
    openOverlay({ mod: "pr-merge", kind: "dialog", modal: true, width: 680, height: 560,
      props: { ...this.target, login: this.viewer, head: m.head.sha, base: m.base.sha, baseRef: m.base.ref } });
  }

  approve(cx) {
    if (!this.confirmApproval || this.approving || this.postingComment || this.postingGeneral || this.busy || !this.meta || this.wasMerged()) return;
    const snapshot = this.meta, login = this.viewer;
    this.confirmApproval = false; this.approving = true;
    this.approvalError = ""; this.approvalNotice = "";
    cx.notify();
    cx.spawn(async cx => {
      let submitted = false;
      try {
        const { repo, number } = this.target;
        const viewer = await this.api("user");
        const fresh = await this.api(`repos/${repo}/pulls/${number}`);
        const error = approvalError(snapshot, fresh, viewer.login, login);
        if (error) throw new Error(error);
        // Pin the review to the displayed SHA, never implicitly approve a newer head.
        submitted = true;
        const r = await exec("gh", approvalArgs(this.target, snapshot.head.sha), { timeout: 45000 });
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || `gh exited ${r.code}`);
        const review = JSON.parse(r.stdout);
        if (review.state !== "APPROVED" || review.commit_id !== snapshot.head.sha || review.user?.login?.toLowerCase() !== login.toLowerCase()) {
          throw new Error("GitHub returned an unexpected review response.");
        }
        this.approvedHead = snapshot.head.sha;
        this.approvalNotice = `Approved ${snapshot.head.sha.slice(0, 8)} as @${login}. This does not merge the PR.`;
      } catch (e) {
        this.approvalError = `${String(e).slice(0, 1400)}${submitted ? " Submission may have reached GitHub; check the PR before retrying." : ""}`;
      } finally { this.approving = false; cx.notify(); }
    });
  }

  startComment(row, side, cx) {
    const anchor = commentAnchor(row, side);
    if (!anchor || !this.meta || !this.file || this.meta.state !== "open" || this.busy || this.approving || this.postingComment || this.postingGeneral || this.wasMerged()) return;
    const same = this.draft?.path === this.file.filename && this.draft?.line === anchor.line && this.draft?.side === anchor.side;
    if (this.draft && !same && this.commentInput.value().trim()) {
      this.commentError = "Post or discard your current draft before choosing another line.";
      cx.notify(); return;
    }
    this.draft = { ...anchor, path: this.file.filename, snapshot: this.meta, login: this.viewer, text: row.text };
    this.commentError = ""; this.commentNotice = ""; this.confirmApproval = false;
    this.commentInput.focus(); cx.notify();
  }

  postComment(cx) {
    if (!this.draft || this.postingComment || this.postingGeneral || this.approving || this.busy) return;
    const draft = this.draft, body = this.commentInput.value();
    const localError = inlineCommentError(draft.snapshot, draft.snapshot, this.viewer, draft.login, body);
    if (localError) { this.commentError = localError; cx.notify(); return; }
    this.postingComment = true; this.commentError = ""; this.commentNotice = "";
    cx.notify();
    cx.spawn(async cx => {
      let submitted = false;
      try {
        const { repo, number } = this.target;
        const viewer = await this.api("user");
        const fresh = await this.api(`repos/${repo}/pulls/${number}`);
        const error = inlineCommentError(draft.snapshot, fresh, viewer.login, draft.login, body);
        if (error) throw new Error(error);
        submitted = true;
        const r = await exec("gh", inlineCommentArgs(this.target, draft.snapshot.head.sha, draft.path, draft, body), { timeout: 45000 });
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || `gh exited ${r.code}`);
        const comment = JSON.parse(r.stdout);
        if (!comment.id || comment.commit_id !== draft.snapshot.head.sha || comment.path !== draft.path || comment.side !== draft.side || (comment.original_line ?? comment.line) !== draft.line || comment.user?.login?.toLowerCase() !== draft.login.toLowerCase()) {
          throw new Error("GitHub returned an unexpected comment response.");
        }
        this.commentNotice = `Comment posted as @${draft.login} on ${draft.path}:${draft.line} (${draft.side === "LEFT" ? "old" : "new"} side, ${draft.snapshot.head.sha.slice(0, 8)}).`;
        this.draft = null; this.commentInput.set_value("");
      } catch (e) {
        this.commentError = `${String(e).slice(0, 1400)}${submitted ? " Submission may have reached GitHub; check the PR before retrying to avoid a duplicate." : ""}`;
      } finally { this.postingComment = false; cx.notify(); }
    });
  }

  commentGutter(row, side, t, bg) {
    const anchor = commentAnchor(row, side);
    const selected = anchor && this.draft?.path === this.selected && this.draft?.line === anchor.line && this.draft?.side === side;
    const enabled = Boolean(anchor && this.meta?.state === "open" && !this.busy && !this.approving && !this.postingComment);
    // Virtual-list renderers may describe styles, but cannot register handlers.
    // The list's on_item_click below owns all row interaction.
    return div().w(44).pr(6).flex_none().text_right()
      .bg(selected ? t.accent : bg).text_color(selected ? "#ffffff" : t.gutterText)
      .child((side === "LEFT" ? row.old : row.next) == null ? "" : String(side === "LEFT" ? row.old : row.next))
      .when(enabled, e => e.cursor_pointer());
  }

  commentComposer(t) {
    const d = this.draft;
    if (!d) return div();
    return v_flex().flex_none().px(16).py(12).gap(8).bg(t.background).border_t(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(this.icon("comment", t.muted))
        .child(div().font_semibold().child("Add an inline comment"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`${d.path}:${d.line} · ${d.side === "LEFT" ? "old" : "new"} side`)))
      .child(v_flex().rounded(6).border_1().border_color(t.border).overflow_hidden()
        .child(h_flex().px(12).py(8).gap(12).items_center().bg(t.raised).border_b(1).border_color(t.border)
          .child(div().font_semibold().child("Write"))
          .child(div().flex_1().text_right().text_size(11).text_color(t.muted).child(`@${d.login} · ${d.snapshot.head.sha.slice(0, 8)}`)))
        .when(!this.postingComment, e => e.child(div().p(8).h(112).bg(t.background)
          .child(div().h_full().rounded(6).border_1().border_color(t.border).bg(t.editor).p(8)
            .child(Textarea.new(this.commentInput).h_full().text_color(t.foreground).text_size(13)))))
        .when(this.postingComment, e => e.child(div().p(16).text_color(t.muted).child("Posting comment…")))
        .child(div().px(12).py(6).bg(t.raised).border_t(1).border_color(t.border).text_size(11).text_color(t.muted).child("Markdown is supported · Posts immediately, not as a pending review")))
      .child(h_flex().gap(8).items_center().justify_between()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(d.text))
        .when(!this.postingComment, e => e.child(this.button("pr-review-discard-comment", "Cancel", (_e, cx) => {
          this.draft = null; this.commentInput.set_value(""); this.commentError = ""; cx.notify();
        })))
        .when(!this.postingComment && Boolean(this.commentInput.value().trim()), e => e.child(this.button("pr-review-post-comment", "Add comment", (_e, cx) => this.postComment(cx), true))));
  }

  pick(file, cx) {
    this.file = file || null; this.selected = file?.filename || null;
    this.rows = file?.patch ? diffRows(file.patch) : [];
    this.width = this.rows.reduce((width, r) => Math.max(width, r.text.length * 8 + 110), 400);
    cx.notify();
  }

  open(cx) {
    if (!this.target) return;
    cx.spawn(async cx => {
      try {
        const r = await exec("gh", ["pr", "view", this.url, "--web"], { timeout: 45000 });
        if (r.code !== 0) throw new Error(r.stderr || r.stdout);
        this.browserError = "";
      } catch (e) { this.browserError = String(e).slice(0, 1000); }
      cx.notify();
    });
  }

  icon(name, color) {
    return svg(`mods/pr-review/icons/${name}.svg`).w(16).h(16).flex_none().text_color(color);
  }

  button(id, label, action, primary = false, icon = null) {
    const t = githubColors(settings().dark);
    return div().id(id).px(12).py(6).rounded(6).border_1().border_color(primary ? t.primaryBorder : t.border)
      .bg(primary ? t.primary : t.raised).text_color(primary ? t.primaryText : t.foreground).text_size(12).font_semibold()
      .hover(s => s.bg(primary ? t.primaryHover : t.hover)).cursor_pointer().flex().items_center().gap(6)
      .when(Boolean(icon), e => e.child(svg(`mods/pr-review/icons/${icon}.svg`).size(16).flex_none()))
      .child(label).on_click(action);
  }

  diffRow(row, t) {
    const kind = row.kind === "+" ? "addition" : row.kind === "-" ? "deletion" : row.kind === "@" ? "hunk" : null;
    const bg = kind ? t[kind] : t.background;
    const gutter = kind ? t[`${kind}Gutter`] : t.background;
    const ink = kind ? t[`${kind}Text`] : t.foreground;
    return h_flex().h(20).w_full().flex_none().items_stretch().bg(bg).text_color(ink)
      .when(Boolean(commentAnchor(row, row.kind === "-" ? "LEFT" : "RIGHT") && this.meta?.state === "open"), e => e.cursor_pointer())
      .child(this.commentGutter(row, "LEFT", t, gutter))
      .child(this.commentGutter(row, "RIGHT", t, gutter))
      .child(div().flex_1().min_w(0).pl(12).truncate().child(row.text));
  }

  fileTreeRows() {
    const root = { children: new Map() };
    for (const file of this.files) {
      const parts = file.filename.split("/");
      let parent = root, path = "";
      parts.forEach((name, index) => {
        path = path ? `${path}/${name}` : name;
        const folder = index < parts.length - 1;
        const key = `${folder ? "folder" : "file"}:${name}`;
        if (!parent.children.has(key)) parent.children.set(key, { name, path, folder, children: new Map(), file: folder ? null : file });
        parent = parent.children.get(key);
      });
    }
    const rows = [];
    const visit = (parent, depth) => {
      const children = [...parent.children.values()].sort((a, b) =>
        Number(b.folder) - Number(a.folder) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const node of children) {
        rows.push({ ...node, depth });
        if (node.folder && !this.collapsedFolders.has(node.path)) visit(node, depth + 1);
      }
    };
    visit(root, 0);
    return rows;
  }

  fileTreeRow(node, t) {
    const { file: f, folder, path, name, depth } = node;
    const selected = !folder && this.selected === path;
    const collapsed = folder && this.collapsedFolders.has(path);
    return h_flex().id(`pr-review-${folder ? "folder" : "file"}-${path}`).flex_none()
      .pl(8 + depth * 14).pr(8).py(6).gap(6).items_center().rounded(6)
      .border_l(3).border_color(selected ? t.accent : t.background)
      .bg(selected ? t.selected : t.background).hover(s => s.bg(selected ? t.selected : t.hover)).cursor_pointer()
      .tooltip(f?.previous_filename ? `${f.previous_filename} → ${path}` : path)
      .on_click((_e, cx) => {
        if (!folder) { this.pick(f, cx); return; }
        if (this.collapsedFolders.has(path)) this.collapsedFolders.delete(path);
        else this.collapsedFolders.add(path);
        cx.notify();
      })
      .child(folder ? svg(`mods/pr-review/icons/chevron-${collapsed ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.muted) : div().w(12).flex_none())
      .child(folder ? svg("mods/pr-review/icons/folder.svg").size(14).flex_none().text_color(t.muted) : this.icon("file", t.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(name))
      .when(!folder, e => e.child(div().flex_none().text_size(11).font_semibold()
        .text_color(f?.status === "added" ? t.ansi2 : f?.status === "removed" ? t.ansi1 : t.muted)
        .child(({added:"A",removed:"D",renamed:"R",modified:"M",copied:"C"})[f?.status] || "•")));
  }

  render() {
    const t = githubColors(settings().dark), merged = this.wasMerged();
    const m = merged && this.meta ? { ...this.meta, state: "closed", merged: true } : this.meta;
    const unavailable = m && this.viewer ? approvalError(m, m, this.viewer, this.viewer) : null;
    const rows = this.rows, path = this.selected, head = m?.head.sha;
    const additions = this.files.reduce((sum, f) => sum + (f.additions || 0), 0);
    const deletions = this.files.reduce((sum, f) => sum + (f.deletions || 0), 0);
    const stateColor = !m || m.draft ? t.draft : m.state === "open" ? t.primary : m.merged ? t.closed : t.ansi1;
    return v_flex().size_full().min_w(0).min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().flex_none().px(16).pt(10).pb(8).gap(8).items_center().flex_wrap()
        .child(v_flex().flex_1().min_w(0).gap(5)
          .child(div().text_size(12).text_color(t.accent).child(m ? this.target.repo : "Pull request"))
          .child(h_flex().gap(8).items_center()
            .child(div().min_w(0).truncate().text_size(16).child(m ? m.title : "Changes"))
            .child(div().flex_none().text_size(16).text_color(t.muted).child(m ? `#${m.number}` : ""))))
        .child(this.button("pr-review-refresh", this.busy ? "Loading…" : "Refresh", (_e, cx) => this.refresh(cx)))
        .child(this.button("pr-review-web", "Open on GitHub ↗", (_e, cx) => this.open(cx)))
        .child(this.button("pr-review-agent", "Send to agent…", () => openOverlay({ mod: "pr-agent", props: { url: this.url }, kind: "dialog", modal: true, width: 560, height: 440 }), false, "agent"))
        .when(Boolean(this.overlay), e => e.child(this.button("pr-review-close", "Close", () => closeOverlay(this.overlay)).tooltip("Close review (Esc)"))))
      .child(h_flex().flex_none().min_w(0).px(16).pb(8).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(m), e => e
          .child(h_flex().px(10).py(4).gap(6).items_center().rounded(20).bg(stateColor).text_color(t.primaryText).text_size(12)
            .child(this.icon("pull-request", t.primaryText)).child(m?.merged ? "Merged" : m?.state !== "open" ? "Closed" : m?.draft ? "Draft" : "Open"))
          .child(div().text_color(t.muted).text_size(12).child("into"))
          .child(div().px(6).py(2).rounded(6).bg(t.branch).text_color(t.branchText).text_size(12).child(m?.base.ref))
          .child(div().text_color(t.muted).text_size(12).child("from"))
          .child(div().px(6).py(2).rounded(6).bg(t.branch).text_color(t.branchText).text_size(12).child(m?.head.ref)))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.muted).child(m ? `${m.head.sha.slice(0, 8)} · Snapshot; refresh for new commits` : "No checkout or working-tree changes")))
      .child(h_flex().id("pr-review-toolbar").flex_none().px(16).py(8).gap(10).items_center().flex_wrap().border_b(1).border_color(t.border).bg(t.raised)
        .child(this.tab("description", "Description", this.icon("comment", t.muted), t))
        .child(this.tab("files", "Files changed", this.icon("file", t.muted), t, this.files.length))
        .child(this.tab("comments", "Comments", this.icon("comment", t.muted), t, this.generalLoaded ? this.generalComments.length : null))
        .child(this.tab("checks", "Checks", this.checkIcon(this.checksError ? "unknown" : checksSummary(this.checks).kind, t), t, this.checks?.rows.length))
        .when(this.activeTab === "files", e => e
          .child(div().text_size(12).font_semibold().text_color(t.ansi2).child(`+${additions}`))
          .child(div().text_size(12).font_semibold().text_color(t.ansi1).child(`−${deletions}`)))
        .child(div().flex_1())
        .when(this.approving, e => e.child(div().text_size(12).text_color(t.muted).child("Submitting approval…")))
        .when(Boolean(m && !this.busy && !this.approving && !this.postingComment && !this.draft && this.viewer && !unavailable && this.approvedHead !== m.head.sha), e =>
          e.child(this.button("pr-review-approve", "Approve…", (_e, cx) => { this.confirmApproval = true; this.approvalError = ""; cx.notify(); }, true)))
        .when(Boolean(unavailable), e => e.child(div().text_size(11).text_color(t.muted).tooltip(unavailable).child("Approval unavailable")))
        .when(Boolean(m?.state === "open" && !m.draft && this.viewer && !this.busy && !this.approving && !this.postingComment && !this.draft), e =>
          e.child(this.button("pr-review-merge", "Merge", () => this.merge(), false, "merge"))))
      .when(this.confirmApproval && !merged, e => e.child(v_flex().flex_none().p(10).gap(8).bg(t.raised).border_b(1).border_color(t.border)
        .child(div().child(`Approve commit ${m?.head.sha.slice(0, 8)} as @${this.viewer}? This submits a GitHub approval, not a merge. Omitted or partial patches may not show all changes.`))
        .child(h_flex().gap(8)
          .child(this.button("pr-review-confirm-approve", "Confirm approval", (_e, cx) => this.approve(cx), true))
          .child(this.button("pr-review-cancel-approve", "Cancel", (_e, cx) => { this.confirmApproval = false; cx.notify(); })))))
      .when(Boolean(this.approvalError), e => e.child(div().flex_none().p(10).text_color(t.ansi1).child(this.approvalError)))
      .when(Boolean(this.approvalNotice), e => e.child(div().flex_none().p(10).text_color(t.ansi2).child(this.approvalNotice)))
      .when(Boolean(m && this.approvedHead === m.head.sha && !this.approvalNotice), e => e.child(div().flex_none().p(8).text_color(t.ansi2).child(`You approved ${m?.head.sha.slice(0, 8)} in this panel.`)))
      .when(Boolean(this.error || this.browserError), e => e.child(div().flex_none().p(10).text_color(t.ansi1).child(this.error || this.browserError)))
      .when(Boolean(m && this.files.length < m.changed_files), e => e.child(div().flex_none().p(8).text_color(t.blocked).child(`Partial file list: ${this.files.length} of ${m?.changed_files}. GitHub limits this API to 3,000 files. Open on GitHub for more.`)))
      .when(this.activeTab === "description", e => e.child(m ? this.descriptionPanel(t)
        : div().flex_1().p(16).text_color(t.muted).child(this.busy ? "Loading description…" : "No description available. Refresh to retry.")))
      .when(this.activeTab === "comments", e => e.child(this.generalCommentsPanel(t)))
      .when(this.activeTab === "checks", e => e.child(m ? this.checksPanel(t)
        : div().flex_1().p(16).text_color(t.muted).child(this.busy ? "Loading checks…" : "No checks available. Refresh to retry.")))
      .when(this.activeTab === "files", e => e.child(div().id("pr-review-workspace").flex_1().min_h(0).min_w(0).relative()
        .child(h_resizable(`pr-review-split-${this.overlay || this.url || "default"}`).size_full()
        .child(resizable_panel().size(300).size_range(180, 900)
          .child(div().size_full().relative().border_r(1).border_color(t.border)
          .child(v_flex().id("pr-review-files").absolute().inset_0().overflow_y_scroll().p(8).gap(2)
            .children(this.fileTreeRows().map(node => this.fileTreeRow(node, t))))
          .child(Scrollbar.vertical("pr-review-files").absolute().inset_0())))
        .child(resizable_panel().size_range(280)
          .child(v_flex().id("pr-review-code").size_full().min_w(0).min_h(0).rounded(6).border_1().border_color(t.border).overflow_hidden()
          .child(v_flex().flex_none().px(12).py(10).gap(6).bg(t.raised).border_b(1).border_color(t.border)
            .child(h_flex().gap(8).items_center()
              .child(this.icon("file", t.muted))
              .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(12).tooltip("Click a diff line to add an inline comment").child(this.file
                ? `${this.file.previous_filename ? this.file.previous_filename + " → " : ""}${this.file.filename}`
                : this.busy ? "Loading PR files…" : m ? "No changed files" : "Load a PR to view its changes"))
              .when(Boolean(this.file), e => e
                .child(div().text_size(11).text_color(t.ansi2).child(`+${this.file?.additions || 0}`))
                .child(div().text_size(11).text_color(t.ansi1).child(`−${this.file?.deletions || 0}`))))
            .when(Boolean(this.file), e => e.child(div().text_size(11).text_color(t.muted).child(patchNotice(this.file)))))
          .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(12)
            .child(div().id("pr-review-diff-x").size_full().overflow_x_scrollbar()
              .child(div().w_full().min_w(this.width || 400).h_full()
                .child(v_virtual_list(`pr-review-diff-${this.selected || "empty"}`, rows.length, 20, i => JSON.stringify([path, head, i]),
                  range => rows.slice(range.start, range.end).map(row => this.diffRow(row, t)))
                  .on_item_click((key, cx) => {
                    const [clickedPath, sha, index] = JSON.parse(key);
                    if (this.rows !== rows || this.selected !== clickedPath || this.meta?.head.sha !== sha) return;
                    const row = rows[index];
                    if (row) this.startComment(row, row.kind === "-" ? "LEFT" : "RIGHT", cx);
                  }).size_full())))
            .child(Scrollbar.vertical(`pr-review-diff-${this.selected || "empty"}`).viewport_from_layout().absolute().inset_0())))))))
      .when(Boolean(this.commentError), e => e.child(div().flex_none().mx(16).my(8).p(12).rounded(6).border_1().border_color(t.ansi1).bg(t.dangerBg).text_color(t.foreground).child(this.commentError)))
      .when(Boolean(this.commentNotice), e => e.child(div().flex_none().mx(16).my(8).p(12).rounded(6).border_1().border_color(t.ansi2).bg(t.successBg).text_color(t.foreground).child(this.commentNotice)))
      .when(this.activeTab === "files", e => e.child(this.commentComposer(t)));
  }
}
