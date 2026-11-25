import { div } from "gpui-kit";
import { v_flex, h_flex, Input, Textarea, TextView } from "gpui-base";
import { props, closeOverlay } from "herdr";
import { adfToMarkdown, hasJiraOnlyContent } from "./description-format.js";

export function dialogView(app, t) {
  const ed = app.editors.get(app.dialog.issueKey);
  const f = ed?.snapshot;
  const compact = app.dialogWidth !== undefined && app.dialogWidth < 760;
  const input = (state, label) => Input.new(state).h(36).px(10).rounded(4)
    .border(1).border_color(t.input).bg(t.surface).text_color(t.foreground).accessibility_label(label);
  const label = text => div().text_size(12).font_semibold().text_color(t.muted).child(text);
  const close = () => closeOverlay(props().overlay);
  const action = (id, text, fn, primary = false) => div().id(id).px(12).py(7).rounded(4).cursor_pointer()
    .bg(primary ? t.blueFill : t.raised).text_color(primary ? t.blueText : t.muted)
    .hover(s => s.opacity(0.85)).child(text).on_click(fn);
  return v_flex().id("jira-issue-dialog").on_size_change((size, cx) => {
    if (app.dialogWidth !== size.width) { app.dialogWidth = size.width; cx.notify(); }
  }).size_full().min_h(0).rounded(12).overflow_hidden().bg(t.surface)
    .border(1).border_color(t.border).text_color(t.foreground).text_size(13)
    .child(h_flex().flex_none().px(24).py(16).items_center().justify_between().border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().size(18).rounded(3).bg(t.blueFill).text_color(t.blueText).text_size(12).child("✓"))
        .child(div().text_color(t.muted).child("Jira / "))
        .child(div().font_semibold().text_color(t.accent).child(app.dialog.issueKey)))
      .child(h_flex().gap(8)
        .child(action("issue-browser", "Open in Jira ↗", (_e, cx) => app.open(`https://YOUR_SITE.atlassian.net/browse/${encodeURIComponent(app.dialog.issueKey)}`, cx)))
        .child(action("issue-close", "×", close).accessibility_label("Close issue dialog"))))
    .child(v_flex().id("issue-dialog-scroll").flex_1().min_h(0).overflow_y_scrollbar().p(24).gap(16)
      .when(!f, el => el.child(div().text_color(t.muted).child(ed?.busy ? "Loading issue…" : "Could not load this issue. Close and reopen to retry.")))
      .when(!!f, el => el.child((compact ? v_flex() : h_flex()).items_start().gap(28)
        .child(v_flex().flex_1().min_w(0).gap(16)
          .child(div().text_size(24).font_semibold().child(f.summary || app.dialog.issueKey))
          .child(div().text_size(11).text_color(t.dim).child(f.issuetype?.name || "Work item"))
          .child(label("Summary"))
          .when(!ed.busy, col => col.child(input(ed.summary, "Issue summary")))
          .child(h_flex().items_center().justify_between()
            .child(div().font_semibold().text_size(16).child("Description"))
            .when(!ed.busy && !ed.editingDescription, row => row.child(action("description-edit", "Edit description", (_e, cx) => { ed.editingDescription = true; cx.notify(); }))))
          .when(!ed.editingDescription, col => col.child(
            TextView.markdown(`description-${app.dialog.issueKey}`, adfToMarkdown(f.description).trim() || "_No description provided._").w_full()))
          .when(ed.editingDescription && !ed.busy, col => col
            .child(h_flex().items_center().gap(6)
              .child(app.button("description-write", "Write", (_e, cx) => { ed.descriptionPreview = false; cx.notify(); }, t, !ed.descriptionPreview))
              .child(app.button("description-preview", "Preview", (_e, cx) => { ed.descriptionPreview = true; cx.notify(); }, t, ed.descriptionPreview))
              .child(div().text_size(11).text_color(t.dim).child("Markdown supported")))
            .when(hasJiraOnlyContent(f.description), box => box.child(div().p(10).rounded(4).bg(t.progressBg).text_color(t.accent).text_size(12)
              .child("This description contains Jira-only content, such as mentions or embeds. Editing Markdown may replace those elements. Leave unchanged to preserve the original, or edit them in Jira.")))
            .when(!ed.descriptionPreview, box => box.child(Textarea.new(ed.description).h(300).px(10).py(8).rounded(4).border(1).border_color(t.input)
              .bg(t.surface).text_color(t.foreground).accessibility_label("Issue description in Markdown")))
            .when(ed.descriptionPreview, box => box.child(div().min_h(160).p(12).border(1).border_color(t.border).rounded(4)
              .child(TextView.markdown(`description-preview-${app.dialog.issueKey}`, ed.description.value() || "_Nothing to preview yet._").w_full())))
            .child(div().text_size(11).text_color(t.dim).child("Headings, bold, italic, links, lists, quotes, tables and fenced code. Markdown is saved as Jira rich text."))))
        .child(v_flex().when(!compact, el => el.w(280)).when(compact, el => el.w_full()).flex_none().p(16).gap(12).border(1).border_color(t.border).rounded(6)
          .child(div().font_semibold().text_size(14).child("Details"))
          .child(label("Status"))
          .child(div().px(8).py(5).rounded(4).bg(f.status.statusCategory?.key === "done" ? t.doneBg : t.progressBg)
            .text_color(f.status.statusCategory?.key === "done" ? t.done : t.accent).font_semibold().child(f.status.name))
          .when(!ed.busy, col => col
            .child(input(ed.status, "Status — exact Jira name"))
            .child(h_flex().flex_wrap().gap(4).children((app.dialog.statuses || []).map((name, i) =>
              app.button(`dialog-status-${i}`, name, (_e, cx) => { ed.status.set_value(name); cx.notify(); }, t))))
            .child(div().text_size(11).text_color(t.dim).child("Sprint statuses shown; Jira validates allowed transitions.")))
          .child(label("Assignee"))
          .child(div().text_color(t.muted).child(f.assignee?.displayName || "Unassigned"))
          .when(!ed.busy, col => col
            .child(input(ed.assignee, "New assignee email or account ID; blank keeps current"))
            .child(h_flex().gap(6)
              .child(action("dialog-assign-me", "Assign to me", (_e, cx) => { ed.assignee.set_value("@me"); cx.notify(); }))
              .child(action("dialog-unassign", "Unassign", (_e, cx) => { ed.assignee.set_value("unassigned"); cx.notify(); })))
            .child(div().text_size(11).text_color(t.dim).child("Email or account ID · blank keeps current")))
          .child(label("Priority"))
          .child(div().text_color(t.muted).child(f.priority?.name || "None")))))
      .when(!!ed?.error, el => el.child(div().p(12).rounded(4).bg(t.raised).text_color(t.blocked).child(ed.error)))
      .when(!!ed?.note, el => el.child(div().text_color(t.muted).child(ed.note))))
    .child(h_flex().flex_none().px(24).py(16).gap(12).items_center().justify_between().border_t(1).border_color(t.border)
      .child(div().flex_1().text_size(11).text_color(t.dim)
        .child(ed?.busy ? (f ? "Saving… Closing now may leave partial changes. Check Jira before retrying." : "Loading issue details from Jira…") : "Changes save only when you click Save changes. Updates apply sequentially, not atomically."))
      .child(action("dialog-cancel", "Close", close))
      .when(!!f && !ed.busy, row => row.child(action("dialog-save", "Save changes", (_e, cx) => app.apply(cx, ed), true))));
}
