import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { checking, exec, props, settings, closeOverlay, shared, setShared } from "herdr";
import { CHECK_QUERY, MERGE_MUTATION, mergeError, isOtherAuthor, MERGE_METHODS, allowedMergeMethods } from "./model.js";
import { mergeColors } from "./colors.js";

export default class MergeConfirmation extends View {
  init(_props, cx) {
    const p = props() || {};
    this.overlay = p.overlay; this.target = p;
    this.expected = { login: p.login, head: p.head, base: p.base, baseRef: p.baseRef };
    this.loading = true; this.submitting = false; this.error = ""; this.pr = null; this.done = false;
    this.acknowledged = false;
    this.method = null; this.methods = [];
    if (!p.host || !p.repo || !p.number || !p.login || !p.head) {
      this.loading = false; this.error = "Open Merge from a loaded pull request."; return;
    }
    // Pure initial rendering during native checks; test harnesses may omit host imports.
    if (typeof checking === "function" && checking()) return;
    cx.spawn(async cx => {
      try {
        const data = await this.check();
        const error = mergeError(data, this.expected);
        if (error) throw new Error(error);
        this.methods = allowedMergeMethods(data.repository);
        this.method = this.methods[0].value;
        this.pr = data.repository.pullRequest;
        this.expected.base = this.pr.baseRefOid;
        this.expected.baseRef = this.pr.baseRefName;
      } catch (e) { this.error = String(e).slice(0, 1400); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async gh(args) {
    const r = await exec("gh", ["api", "graphql", "--hostname", this.target.host, ...args], { timeout: 45000 });
    if (r.code !== 0) throw new Error(r.stderr || r.stdout || `gh exited ${r.code}`);
    const result = JSON.parse(r.stdout);
    if (result.errors?.length) throw new Error(result.errors.map(e => e.message).join("; "));
    return result.data;
  }

  check() {
    const [owner, name] = this.target.repo.split("/");
    return this.gh(["-f", `query=${CHECK_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${this.target.number}`]);
  }

  confirm(cx) {
    if (this.loading || this.submitting || this.error || !this.pr || this.done
      || (isOtherAuthor(this.pr, this.expected.login) && !this.acknowledged)) return;
    const method = this.method;
    if (!this.methods.some(option => option.value === method)) return;
    this.submitting = true; cx.notify();
    cx.spawn(async cx => {
      let submitted = false;
      try {
        const data = await this.check();
        const error = mergeError(data, this.expected, method);
        if (error) throw new Error(error);
        if (data.repository.pullRequest.id !== this.pr.id) throw new Error("PR identity changed. Close and refresh.");
        if (isOtherAuthor(data.repository.pullRequest, this.expected.login) && !this.acknowledged) throw new Error("PR author changed. Reopen Merge and acknowledge the authorship warning.");
        submitted = true;
        const merged = await this.gh(["-f", `query=${MERGE_MUTATION}`, "-f", `id=${this.pr.id}`, "-f", `head=${this.expected.head}`, "-f", `method=${method}`]);
        const result = merged?.mergePullRequest?.pullRequest;
        if (result?.state !== "MERGED" || result.id !== this.pr.id) throw new Error("GitHub did not confirm the merge.");
        this.done = true;
        const key = `${this.target.host}/${this.target.repo}#${this.target.number}`;
        setShared("github.mergedPRs", { ...(shared("github.mergedPRs") || {}), [key]: true });
      } catch (e) {
        this.error = `${String(e).slice(0, 1400)}${submitted ? " The request may have reached GitHub; check the PR before retrying." : ""}`;
      } finally { this.submitting = false; cx.notify(); }
    });
  }

  icon(name, color, size = 16) {
    return svg(`mods/pr-merge/icons/${name}.svg`).size(size).flex_none().text_color(color);
  }

  button(id, label, action, primary = false) {
    const t = mergeColors(settings().dark);
    return div().id(id).px(14).py(7).rounded(6).border_1()
      .border_color(primary ? t.primaryBorder : t.border)
      .bg(primary ? t.primary : t.raised).text_color(primary ? "#ffffff" : t.foreground)
      .text_size(12).font_semibold().cursor_pointer()
      .hover(s => s.bg(primary ? t.primaryHover : t.hover)).child(label).on_click(action);
  }

  branch(name, t) {
    return div().max_w(190).min_w(0).truncate().px(7).py(2).rounded(4)
      .bg(t.branch).text_color(t.branchText).text_size(12).tooltip(name || "Unknown branch").child(name || "Unknown branch");
  }

  render() {
    const t = mergeColors(settings().dark), pr = this.pr;
    const other = pr && isOtherAuthor(pr, this.expected.login);
    const ready = pr && !this.loading && !this.submitting && !this.error && !this.done;
    return v_flex().size_full().min_h(0).min_w(0).rounded(12).overflow_hidden().bg(t.background)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().flex_none().px(20).py(16).gap(12).items_center().border_b(1).border_color(t.border)
        .child(div().size(36).rounded(8).bg(this.done ? t.mergedBg : t.raised).flex().items_center().justify_center()
          .child(this.icon("merge", this.done ? t.merged : t.muted, 20)))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().text_size(16).font_semibold().child(this.done ? "Pull request successfully merged" : "Merge pull request"))
          .child(div().text_size(12).text_color(t.muted).truncate().child(`${this.target.repo || "Pull request"} #${this.target.number || ""}`)))
        .when(!this.submitting, e => e.child(div().id("merge-close").size(28).rounded(6).text_size(18).text_color(t.muted)
          .flex().items_center().justify_center().cursor_pointer().hover(s => s.bg(t.hover))
          .tooltip("Close").accessibility_label("Close merge confirmation").child("×").on_click(() => closeOverlay(this.overlay)))))
      .child(div().id("merge-content-viewport").flex_1().min_h(0).relative()
        .child(v_flex().id("merge-confirmation-content").absolute().inset_0().overflow_y_scroll().p(16).gap(12)
          .when(Boolean(pr), e => e.child(v_flex().gap(10)
            .child(div().text_size(16).font_semibold().child(pr.title))
            .child(h_flex().gap(6).items_center()
              .child(this.icon("pull-request", t.muted))
              .child(div().text_size(12).text_color(t.muted).child(`Opened by ${pr.author?.login ? `@${pr.author.login}` : "unknown/deleted user"}`)))
            .child(h_flex().gap(6).items_center().flex_wrap()
              .child(this.branch(pr.headRefName, t))
              .child(div().text_color(t.muted).child("→"))
              .child(this.branch(pr.baseRefName, t))
              .child(div().text_size(11).text_color(t.muted).tooltip(this.expected.head || "").child(this.expected.head?.slice(0, 8) || "")))))
          .when(Boolean(pr && !this.done), e => e
            .when(Boolean(other), content => content.child(v_flex().p(12).gap(10).rounded(6).border_1().border_color(t.warningBorder).bg(t.warningBg)
              .child(h_flex().gap(8).items_start()
                .child(this.icon("alert", t.warning))
                .child(div().flex_1().font_semibold().child("You are merging a pull request you did not author.")))
              .child(div().text_size(12).child(`Author: ${pr.author?.login ? `@${pr.author.login}` : "unknown/deleted user"}. You are @${this.expected.login}. This will merge their changes into ${pr.baseRefName}.`))
              .child(h_flex().id("merge-acknowledge").gap(8).items_start()
                .when(!this.submitting, box => box.cursor_pointer().on_click((_e, cx) => {
                  if (!this.submitting) { this.acknowledged = !this.acknowledged; cx.notify(); }
                }))
                .child(div().size(16).flex_none().rounded(3).border_1().border_color(this.acknowledged ? t.accent : t.muted)
                  .bg(this.acknowledged ? t.accent : t.background).text_color("#ffffff").text_size(12)
                  .flex().items_center().justify_center().child(this.acknowledged ? "✓" : ""))
                .child(div().flex_1().text_size(12).font_semibold().child("I understand — this is not my PR")))))
            .child(v_flex().gap(8)
              .child(div().font_semibold().child("Merge method"))
              .children(MERGE_METHODS.map(option => {
                const enabled = this.methods.some(method => method.value === option.value);
                const selected = this.method === option.value;
                return h_flex().id(`merge-method-${option.value}`).gap(10).p(12).rounded(6).border_1()
                  .border_color(selected ? t.accent : t.border).bg(selected ? t.branch : t.raised)
                  .when(Boolean(ready && enabled), row => row.cursor_pointer().on_click((_e, cx) => {
                    if (this.submitting || this.error || this.done) return;
                    this.method = option.value; cx.notify();
                  }))
                  .child(div().text_color(selected ? t.accent : t.muted).child(selected ? "◉" : "○"))
                  .child(v_flex().flex_1().gap(3).text_color(enabled ? t.foreground : t.muted)
                    .child(div().font_semibold().child(option.label))
                    .child(div().text_size(12).text_color(t.muted).child(enabled ? option.description : "Disabled by repository settings.")));
              })))
            .child(div().text_size(12).text_color(t.muted).child("GitHub enforces branch protection, required reviews, and status checks. Keep this account active until submission finishes.")))
          .when(this.loading, e => e.child(h_flex().gap(8).items_center().py(12).text_color(t.muted)
            .child(this.icon("spinner", t.muted).spin(900)).child(div().child("Checking the pull request and repository permissions…"))))
          .when(Boolean(this.error), e => e.child(v_flex().id("merge-error").p(12).gap(6).rounded(6).border_1().border_color(t.danger).bg(t.dangerBg)
            .child(h_flex().gap(8).items_center().child(this.icon("alert", t.danger)).child(div().font_semibold().child("Unable to merge")))
            .child(div().text_size(12).child(this.error))))
          .when(this.done, e => e.child(v_flex().p(14).gap(6).rounded(6).border_1().border_color(t.merged).bg(t.mergedBg)
            .child(div().font_semibold().text_color(t.merged).child("Pull request successfully merged and closed"))
            .child(div().text_size(12).child("GitHub confirmed the merge. The branch was not deleted.")))))
        .child(Scrollbar.vertical("merge-confirmation-content").absolute().inset_0()))
      .child(v_flex().flex_none().px(20).py(12).gap(8).border_t(1).border_color(t.border).bg(t.raised)
        .when(Boolean(pr && !this.done), e => e.child(h_flex().gap(6).items_center()
          .child(div().text_size(12).text_color(t.muted).child("Merging as"))
          .child(div().text_size(12).font_semibold().child(`@${this.expected.login}`))))
        .child(h_flex().gap(8).items_center().justify_end()
          .when(this.submitting, e => e
            .child(this.icon("spinner", t.muted).spin(900))
            .child(div().text_size(12).text_color(t.muted).child("Merging… Waiting for GitHub.")))
          .when(!this.submitting, e => e.child(this.button("merge-cancel", this.done ? "Close" : "Cancel", () => closeOverlay(this.overlay))))
          .when(Boolean(ready && (!other || this.acknowledged)), e =>
            e.child(this.button("merge-confirm", this.method === "SQUASH" ? "Confirm squash and merge" : "Confirm merge", (_e, cx) => this.confirm(cx), true)))));
  }
}
