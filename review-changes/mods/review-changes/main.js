// Modified personal derivative of Herdr changes 0.1.14; see root THIRD-PARTY-NOTICES.md.
// Export includes personal UI extensions and check-safe initialization where applicable.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Scrollbar, v_virtual_list } from "gpui-base";
import { checking, spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, shared, setShared } from "herdr";
import { diffRows, repoKey, rowKey, sameAnchor, makeComment, lineLabel, reviewMarkdown, fileSnapshot, discardFile } from "./review.js";
const COMMENTS = "review-changes.comments.v1";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
const locationKey = key;
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;


export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.commentInput = TextareaState.new({ placeholder: "What should the agent review?", rows: 3 });
    this.commentInput.on("change", (_e, cx) => cx.notify());
    this.input = InputState.new({ placeholder: "Commit message (all changes)" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    // Pure initial rendering during native checks; test harnesses may omit host imports.
    if (typeof checking === "function" && checking()) return;
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null;
      this.draft = null; this.pendingDiscard = null; this.copiedReview = null;
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.head = head.code === 0 ? head.stdout.trim() : null; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = files[0].path;
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines, limited = false;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        limited = text.length > 400000 || file.add > 1500;
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) {
      limited = limited || lines.length > 1500 || lines.some(line => line.length > 4000);
      this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
      this.previewLimited = limited;
    }
  }

  setLines(lines) {
    this.previewLimited = false;
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map(line => line.length * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  comments() {
    return this.root ? (shared(COMMENTS) ?? {})[repoKey(this.root, this.on)] ?? [] : [];
  }

  storeComments(comments) {
    setShared(COMMENTS, { ...(shared(COMMENTS) ?? {}), [repoKey(this.root, this.on)]: comments });
    this.copiedReview = null;
  }

  editComment(comment, cx) {
    if (this.draft && this.commentInput.value().trim()) { this.note = "Save or cancel your current comment first."; cx.notify(); return; }
    this.draft = comment; this.note = null;
    this.commentInput.set_value(comment.body);
    this.commentInput.focus();
    cx.notify();
  }

  selectLine(key, cx) {
    if (this.busy || this.context !== locationKey()) return;
    const row = this.rows.find(r => rowKey(this.open, r) === key);
    if (!row || row.number === undefined) return;
    const existing = this.comments().find(c => sameAnchor(c, this.open, row));
    this.editComment(existing ?? makeComment(this.open, row, this.rows, this.head), cx);
  }

  saveComment(cx) {
    if (!this.draft || !this.root || this.context !== locationKey()) return;
    const body = this.commentInput.value().trim();
    if (!body) return;
    const comments = this.comments(), comment = { ...this.draft, body };
    this.storeComments(comments.some(c => c.id === comment.id) ? comments.map(c => c.id === comment.id ? comment : c) : [...comments, comment]);
    this.draft = null; this.note = null; this.commentInput.set_value(""); this.handle.focus(); cx.notify();
  }

  copyReview(cx) {
    const comments = this.comments();
    if (!comments.length || this.context !== locationKey()) return;
    if (this.draft) {
      this.note = "Save or cancel your draft before copying the review.";
      cx.notify(); return;
    }
    try {
      const text = reviewMarkdown(this.root, this.on, comments);
      cx.write_to_clipboard(text);
      this.copiedReview = text; this.note = null;
    } catch (e) {
      this.copiedReview = null; this.note = `Could not copy review: ${e}`;
    }
    cx.notify();
  }

  requestDiscard(file, cx) {
    if (this.busy || this.loading || this.checkingDiscard || this.context !== locationKey()) return;
    const pending = { root: this.root, on: this.on, path: file.path }, context = this.context;
    this.checkingDiscard = true; this.pendingDiscard = null; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const snapshot = await fileSnapshot(exec, pending);
        if (this.context === context && locationKey() === context && this.root === pending.root) {
          this.pendingDiscard = { ...pending, snapshot };
          this.discardNew = file.status === "A" || file.fresh;
        }
      } catch (e) { if (this.context === context) this.note = `Cannot prepare discard: ${e}`; }
      finally { this.checkingDiscard = false; cx.notify(); }
    });
    cx.notify();
  }

  discard(cx) {
    const pending = this.pendingDiscard;
    if (!pending || this.busy || this.loading || this.context !== locationKey() || repoKey(pending.root, pending.on) !== repoKey(this.root, this.on)) return;
    const context = this.context;
    this.busy = true; this.note = null; this.pendingDiscard = null;
    cx.spawn(async (cx) => {
      try {
        await discardFile(exec, pending);
        if (this.context === context) this.note = `Discarded ${pending.path}`;
      } catch (e) { if (this.context === context) this.note = `Discard failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  button(id, label, action, t, danger = false) {
    return div().id(id).px(8).py(5).rounded(5).bg(danger ? t.ansi1 : t.raised).text_color(danger ? t.background : t.foreground).text_size(11).cursor_pointer().on_click(action).child(label);
  }

  diffRow(row, t) {
    const { kind, number, text } = row;
    const commented = this.comments().some(c => sameAnchor(c, this.open, row));
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(14).flex_none().text_color(t.accent).child(commented ? "●" : number === undefined ? "" : "○"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    const comments = this.comments(), context = this.context, root = this.root;
    const isCurrent = () => this.context === context && locationKey() === context && this.root === root;
    const copied = comments.length > 0 && this.copiedReview === reviewMarkdown(this.root, this.on, comments);
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).max_h(this.files.length * 28 + 12).relative().border_b(1).border_color(t.border)
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)))
          .child(div().id(`discard-${f.path}`).px(5).py(3).rounded(4).text_size(10).text_color(t.ansi1).hover(s => s.bg(t.raised))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              if (isCurrent()) this.requestDiscard(f, cx);
            }).child("Discard"));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => rowKey(this.open, this.rows[i]),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).on_item_click((key, cx) => this.selectLine(key, cx)).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      .when(this.previewLimited, el => el.child(div().flex_none().px(10).py(5).text_size(11).text_color(t.blocked).child("Partial preview: limited to 1,500 rows / 400 KB for new files and 4,000 characters per line. Inspect the full diff in your editor before approving.")))
      .when(this.checkingDiscard, el => el.child(div().flex_none().px(10).py(4).text_size(11).text_color(t.muted).child("Checking file before discard…")))
      .child(div().px(10).py(4).text_size(10).text_color(t.dim).child("Click a diff line to leave a review comment"))
      .when(Boolean(this.pendingDiscard), el => el.child(v_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.ansi1)
        .child(div().text_size(12).child(`${this.discardNew ? "Delete new file" : "Restore HEAD and discard staged + unstaged edits to"} ${this.pendingDiscard?.path}? This cannot be undone. Stop any agent editing it first.`))
        .child(h_flex().gap(8)
          .child(this.button("discard-cancel", "Cancel", (_e, cx) => { this.pendingDiscard = null; cx.notify(); }, t))
          .child(this.button("discard-confirm", this.busy || this.loading ? "Please wait…" : "Confirm discard", (_e, cx) => this.discard(cx), t, true)))))
      .when(Boolean(this.draft), el => el.child(v_flex().flex_none().p(10).gap(6).border_t(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.accent).child(`${this.draft?.path} · ${this.draft ? lineLabel(this.draft) : ""}`))
        .child(div().text_size(11).text_color(t.muted).truncate().child(this.draft?.text ?? ""))
        .child(Textarea.new(this.commentInput).h(78).px(8).rounded(6).border_1().border_color(t.accent).text_size(12).text_color(t.foreground))
        .child(h_flex().gap(8)
          .child(this.button("comment-save", "Save comment", (_e, cx) => this.saveComment(cx), t))
          .child(this.button("comment-cancel", "Cancel", (_e, cx) => { this.draft = null; this.commentInput.set_value(""); this.handle.focus(); cx.notify(); }, t)))))
      .when(comments.length > 0, el => el.child(v_flex().flex_none().h(180).border_t(1).border_color(t.border)
        .child(h_flex().flex_none().px(10).py(6).gap(8).items_center()
          .child(div().flex_1().text_size(12).child(`Review comments (${comments.length})`))
          .child(this.button("review-copy", copied ? "Copied!" : "Copy for agent", (_e, cx) => { if (isCurrent()) this.copyReview(cx); }, t)))
        .child(div().flex_1().min_h(0).relative()
          .child(v_flex().id("review-comment-list").absolute().inset_0().overflow_y_scroll().px(10).pb(6).gap(6).children(comments.map(c =>
          v_flex().gap(4).p(6).rounded(5).bg(t.raised)
            .child(div().text_size(10).text_color(t.accent).child(`${c.path} · ${lineLabel(c)} (saved location)`))
            .child(div().text_size(12).child(c.body))
            .child(h_flex().gap(6)
              .child(this.button(`edit-${c.id}`, "Edit", (_e, cx) => { if (isCurrent()) this.editComment(c, cx); }, t))
              .child(this.button(`delete-${c.id}`, "Delete", (_e, cx) => {
                if (!isCurrent()) return;
                this.storeComments(this.comments().filter(item => item.id !== c.id));
                if (this.draft?.id === c.id) this.draft = null;
                cx.notify();
              }, t))))))
          .child(Scrollbar.vertical("review-comment-list").absolute().inset_0()))))
      .when(copied, el => el.child(div().flex_none().px(10).py(6).text_size(11).text_color(t.accent).child("Review copied to clipboard. Paste it into your agent’s chat.")))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Working…" : "Commit all")));
  }
}
