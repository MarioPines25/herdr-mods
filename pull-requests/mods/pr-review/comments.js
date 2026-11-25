export function commentTime(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "at an unknown time";
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return "just now";
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
    }
  }
}

// General PR discussion uses issue comments, not line comments or reviews.
export async function loadGeneralComments(api, target) {
  const comments = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api(`repos/${target.repo}/issues/${target.number}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Unexpected GitHub comments response.");
    comments.push(...batch);
    if (batch.length < 100) return { comments, partial: false };
  }
  return { comments, partial: true };
}

export function generalCommentArgs(target, body) {
  return ["api", "--hostname", target.host, `repos/${target.repo}/issues/${target.number}/comments`, "--method", "POST", "-f", `body=${body}`];
}
