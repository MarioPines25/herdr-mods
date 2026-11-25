// Pure helpers shared by the native view and Node tests.
export function targetFrom(props) {
  const u = new URL(props.url);
  const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(u.pathname);
  if (u.protocol !== "https:" || !m || u.username || u.password || u.port) throw new Error("Invalid GitHub PR URL");
  return { host: u.hostname, repo: `${m[1]}/${m[2]}`, number: Number(m[3]) };
}

export function diffRows(patch) {
  let old = 0, next = 0;
  return (patch || "").split("\n").map(text => {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (h) { old = Number(h[1]); next = Number(h[2]); return { kind: "@", text }; }
    const kind = text[0];
    if (kind === "+") return { kind, next: next++, text };
    if (kind === "-") return { kind, old: old++, text };
    if (kind === " ") return { kind, old: old++, next: next++, text };
    return { kind: "@", text };
  });
}

// Bound retained preview data and synchronous line parsing in the UI thread.
export function previewFile(file, remaining = 8_000_000) {
  const patch = file.patch;
  if (!patch) return file;
  let reason = "";
  if (patch.length > 500_000) reason = "Patch exceeds the 500,000-character preview limit.";
  else if (patch.length > remaining) reason = "PR exceeds the 8,000,000-character total preview limit.";
  else {
    let lines = 1;
    for (let i = 0; i < patch.length; i++) {
      if (patch[i] === "\n" && ++lines > 20_000) { reason = "Patch exceeds the 20,000-line preview limit."; break; }
    }
  }
  return reason ? { ...file, patch: undefined, previewNotice: `${reason} Open on GitHub for the diff.` } : file;
}

export function patchNotice(file) {
  if (file.previewNotice) return file.previewNotice;
  if (!file.patch) return "No text patch supplied by GitHub (binary, empty, or omitted). Open on GitHub for details.";
  const lines = file.patch.split("\n");
  const add = lines.filter(l => l.startsWith("+")).length;
  const del = lines.filter(l => l.startsWith("-")).length;
  if (add !== file.additions || del !== file.deletions) return "Partial patch: displayed lines do not cover all reported changes. Open on GitHub for the full diff.";
  return "GitHub-provided patch; surrounding unchanged code is not included.";
}

export function commentAnchor(row, side) {
  // GitHub's line/side API uses LEFT for deletions, RIGHT for additions
  // and unchanged context. Hunk headers and no-newline markers aren't lines.
  if (side === "LEFT" ? row.kind !== "-" : side === "RIGHT" ? !["+", " "].includes(row.kind) : true) return null;
  const line = side === "LEFT" ? row.old : row.next;
  return Number.isSafeInteger(line) && line > 0 ? { line, side } : null;
}

export function inlineCommentError(snapshot, fresh, login, expectedLogin, body) {
  if (!body?.trim()) return "Write a comment before posting.";
  if (body.length > 65_536) return "Comment is too long (maximum 65,536 characters).";
  if (!login || login.toLowerCase() !== expectedLogin?.toLowerCase()) return "GitHub account changed. Refresh before commenting.";
  if (!sameRevision(snapshot, fresh)) return "PR changed since this line was loaded. Copy your draft, discard it, then Refresh and select the latest line.";
  if (fresh.state !== "open") return "Only open PRs can receive comments from this panel.";
  return null;
}

export function inlineCommentArgs(target, sha, path, anchor, body) {
  if (!path || !Number.isSafeInteger(anchor?.line) || anchor.line < 1 || !["LEFT", "RIGHT"].includes(anchor.side)) {
    throw new Error("Invalid inline comment target");
  }
  return ["api", "--hostname", target.host, "--method", "POST",
    `repos/${target.repo}/pulls/${target.number}/comments`,
    "-f", `commit_id=${sha}`, "-f", `path=${path}`, "-F", `line=${anchor.line}`,
    "-f", `side=${anchor.side}`, "-f", `body=${body}`];
}

export function approvalError(snapshot, fresh, login, expectedLogin) {
  if (!login || login.toLowerCase() !== expectedLogin?.toLowerCase()) return "GitHub account changed. Refresh before approving.";
  if (!sameRevision(snapshot, fresh)) return "PR changed since you loaded it. Refresh and review the latest changes before approving.";
  if (fresh.state !== "open" || fresh.draft) return "Only open, non-draft PRs can be approved here.";
  if (fresh.user?.login?.toLowerCase() === login.toLowerCase()) return "You cannot approve your own PR.";
  return null;
}

export function approvalArgs(target, sha) {
  return ["api", "--hostname", target.host, "--method", "POST",
    `repos/${target.repo}/pulls/${target.number}/reviews`,
    "-f", "event=APPROVE", "-f", `commit_id=${sha}`];
}

export function sameRevision(a, b) {
  return a.head.sha === b.head.sha && a.base.sha === b.base.sha && a.changed_files === b.changed_files;
}
