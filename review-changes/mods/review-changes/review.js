// Pure review helpers, also exercised by tests/review-changes.test.mjs.
export function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line, index) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line, index }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old, old: old++, text: line.slice(1), index };
    if (kind === "+") return { kind, number: next, next: next++, text: line.slice(1), index };
    if (kind === " ") return { kind, number: next, old: old++, next: next++, text: line.slice(1), index };
    return { kind: "", text: line, index };
  });
}

export const repoKey = (root, on) => JSON.stringify([on ?? null, root]);
export const rowKey = (path, row) => JSON.stringify([path, row.kind, row.old, row.next, row.text]);
export const sameAnchor = (comment, path, row) => comment.path === path && comment.anchor === rowKey(path, row);
export function makeComment(path, row, rows, head) {
  const start = Math.max(0, row.index - 3), end = Math.min(rows.length, row.index + 4);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    path, kind: row.kind, old: row.old, next: row.next, text: row.text,
    anchor: rowKey(path, row), head,
    context: rows.slice(start, end).map(r => r.kind === "@" ? r.text : `${r.kind}${r.text}`).join("\n"),
    body: "", created: new Date().toISOString(),
  };
}
export function lineLabel(comment) {
  return comment.kind === "-" ? `old line ${comment.old}` : `line ${comment.next}`;
}
const fenced = text => {
  const fence = "`".repeat(Math.max(3, ...((text.match(/`+/g) ?? []).map(s => s.length + 1))));
  return `${fence}\n${text}\n${fence}`;
};
export function reviewMarkdown(root, on, comments) {
  return [
    "# Code review feedback", "",
    `Repository: ${JSON.stringify(root)}`, `Machine: ${on || "local"}`, "",
    "Evaluate each comment against the current code. Address the concerns you agree with and explain any you disagree with.",
    "Locations and snippets describe the code when reviewed; verify them before editing.", "",
    ...comments.flatMap((c, i) => [
      `## ${i + 1}. ${JSON.stringify(c.path)} — ${lineLabel(c)}`, "",
      `Reviewed HEAD: ${c.head || "unborn"}`, `Created: ${c.created}`, "",
      fenced(c.context), "", "Reviewer comment:", c.body, "",
    ]),
  ].join("\n");
}

// Snapshot both index and working contents without updating Git's index or
// writing objects. Revalidated at confirmation, since an agent may still edit.
export async function fileSnapshot(exec, { root, on, path }) {
  const options = { cwd: root, on };
  const git = args => exec("git", ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", ...args], options);
  const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.code !== 0 && head.code !== 1) throw new Error(head.stderr || "Cannot verify HEAD.");
  const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", path]);
  const index = await git(["ls-files", "--stage", "--", path]);
  if (status.code !== 0 || index.code !== 0) throw new Error(status.stderr || index.stderr || "Cannot inspect file.");
  const contents = await git(["hash-object", "--no-filters", "--", path]);
  // Missing/deleted files have a stable error result, which is also part of
  // the snapshot. No content or error is shown to the user or written to disk.
  return JSON.stringify([head.code, head.stdout, status.stdout, index.stdout, contents.code, contents.stdout, contents.stderr]);
}

// Only the explicitly selected path can be affected. No recursive clean/reset.
export async function discardFile(exec, { root, on, path, snapshot }) {
  if (!path || path.endsWith("/")) throw new Error("Directories cannot be discarded here.");
  if (snapshot !== undefined && snapshot !== await fileSnapshot(exec, { root, on, path })) {
    throw new Error("This file or its Git state changed since confirmation opened. Review it again and click Discard again.");
  }
  const git = async args => {
    const result = await exec("git", ["--literal-pathspecs", ...args], { cwd: root, on });
    if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim());
    return result.stdout;
  };
  const entries = await git(["ls-files", "--stage", "--", path]);
  if (entries.split("\n").some(line => line.startsWith("160000 "))) throw new Error("Submodules must be reviewed and discarded in their own repository.");
  // Check HEAD for this path, not its status letter: a staged addition has no
  // committed version even in a repository that already has commits.
  const head = await exec("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: root, on });
  if (head.code !== 0 && head.code !== 1) throw new Error(head.stderr || "Cannot verify HEAD.");
  const committed = head.code === 0 ? await git(["ls-tree", "-z", "HEAD", "--", path]) : "";
  if (/^(040000|160000) /.test(committed)) throw new Error("Directories and submodules cannot be discarded here.");
  if (committed) {
    await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", path]);
  } else if (entries) {
    await git(["rm", "-f", "--", path]);
  } else {
    await git(["clean", "-f", "--", path]);
  }
}
