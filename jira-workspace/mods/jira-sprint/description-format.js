import { Lexer } from "./vendor/marked.js";

const escape = value => String(value || "").replace(/&/g, "&amp;").replace(/([\\`*_{}\[\]()#+.!<>|~=-])/g, "\\$1")
  .replace(/:/g, "&#58;").replace(/@/g, "&#64;");
const wrap = (text, delimiter) => text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_all, before, value, after) =>
  value ? `${before}${delimiter}${value}${delimiter}${after}` : text);
const children = node => {
  const merged = [];
  for (const child of node.content || []) {
    const previous = merged.at(-1);
    if (child.type === "text" && previous?.type === "text" && JSON.stringify(previous.marks) === JSON.stringify(child.marks)) previous.text += child.text;
    else merged.push({ ...child });
  }
  return merged.map(adfToMarkdown).join("");
};

// Jira returns ADF, not Markdown. Convert it for both display and editing.
export function adfToMarkdown(node) {
  if (typeof node === "string") return node;
  if (!node) return "";
  const content = children(node);
  switch (node.type) {
    case "doc": return (node.content || []).map(adfToMarkdown).join("\n\n");
    case "text": {
      let text = escape(node.text);
      const marks = node.marks || [];
      if (marks.some(m => m.type === "code")) {
        const fence = "`".repeat(Math.max(1, ...((node.text || "").match(/`+/g) || []).map(s => s.length + 1)));
        text = `${fence} ${node.text || ""} ${fence}`;
      }
      for (const mark of marks) {
        if (mark.type === "strong") text = wrap(text, "**");
        if (mark.type === "em") text = wrap(text, "*");
        if (mark.type === "strike") text = wrap(text, "~~");
        if (mark.type === "link") {
          const href = String(mark.attrs?.href || "").replace(/&/g, "&amp;").replace(/>/g, "%3E");
          const title = mark.attrs?.title ? ` "${String(mark.attrs.title).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"` : "";
          text = `[${text}](<${href}>${title})`;
        }
      }
      return text;
    }
    case "paragraph": return content;
    case "heading": return `${"#".repeat(Math.min(6, Math.max(1, node.attrs?.level || 1)))} ${content}`;
    case "hardBreak": return "  \n";
    case "rule": return "---";
    case "codeBlock": {
      const code = (node.content || []).map(n => n.text || "").join("");
      const fence = "`".repeat(Math.max(3, ...((code.match(/`+/g) || []).map(s => s.length + 1))));
      return `${fence}${node.attrs?.language || ""}\n${code}\n${fence}`;
    }
    case "blockquote": return (node.content || []).map(adfToMarkdown).join("\n\n").split("\n").map(line => `> ${line}`).join("\n");
    case "bulletList":
    case "orderedList": return (node.content || []).map((item, i) => {
      const prefix = node.type === "orderedList" ? `${(node.attrs?.order || 1) + i}. ` : "- ";
      const lines = (item.content || []).map(adfToMarkdown).join("\n\n").split("\n");
      return prefix + lines.join("\n" + " ".repeat(prefix.length));
    }).join("\n");
    case "table": {
      const rows = (node.content || []).map(row => (row.content || []).map(cell =>
        (cell.content || []).map(adfToMarkdown).join(" ").replace(/\n/g, " ")));
      if (!rows.length) return "";
      return [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map(row => `| ${row.join(" | ")} |`).join("\n");
    }
    case "mention": return escape(node.attrs?.text || "@mention");
    case "emoji": return escape(node.attrs?.text || node.attrs?.shortName || "");
    case "inlineCard":
    case "blockCard": return `<${node.attrs?.url || ""}>`;
    case "media": return "[Attachment — open in Jira]";
    default: return content;
  }
}

const supportedNodes = new Set(["doc", "text", "paragraph", "heading", "hardBreak", "rule", "codeBlock", "blockquote", "bulletList", "orderedList", "listItem", "table", "tableRow", "tableHeader", "tableCell"]);
const supportedMarks = new Set(["strong", "em", "strike", "code", "link"]);
export function hasJiraOnlyContent(node) {
  if (!node || typeof node === "string") return false;
  return !supportedNodes.has(node.type) || (node.marks || []).some(m => !supportedMarks.has(m.type))
    || (node.content || []).some(hasJiraOnlyContent);
}

// Decode entities in Markdown text without involving HTML or a browser DOM.
function unescape(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
    if (name[0] !== "#") return named[name.toLowerCase()] || entity;
    const number = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : "\ufffd";
  });
}
function inline(tokens, marks = []) {
  return (tokens || []).flatMap(token => {
    const text = value => value ? [{ type: "text", text: value, ...(marks.length ? { marks } : {}) }] : [];
    switch (token.type) {
      case "strong": return inline(token.tokens, [...marks, { type: "strong" }]);
      case "em": return inline(token.tokens, [...marks, { type: "em" }]);
      case "del": return inline(token.tokens, [...marks, { type: "strike" }]);
      case "link": return inline(token.tokens, [...marks, { type: "link", attrs: { href: unescape(token.href), ...(token.title ? { title: unescape(token.title) } : {}) } }]);
      case "codespan": return [{ type: "text", text: token.text, marks: [...marks, { type: "code" }] }];
      case "br": return [{ type: "hardBreak" }];
      case "escape": return text(token.text);
      case "text": return token.tokens ? inline(token.tokens, marks) : text(unescape(token.text));
      case "image": throw new Error("Markdown images cannot be saved as Jira attachments. Use a Markdown link instead, or upload the image in Jira.");
      case "html": throw new Error("Raw HTML is not supported. Use Markdown formatting instead.");
      default: throw new Error(`Unsupported inline Markdown: ${token.type}`);
    }
  });
}
function blocks(tokens) {
  return (tokens || []).flatMap(token => {
    switch (token.type) {
      case "space": return [];
      case "heading": return [{ type: "heading", attrs: { level: token.depth }, content: inline(token.tokens) }];
      case "paragraph":
      case "text": return [{ type: "paragraph", content: inline(token.tokens || [{ type: "text", text: token.text }]) }];
      case "code": return [{ type: "codeBlock", ...(token.lang ? { attrs: { language: token.lang.split(/\s/)[0] } } : {}), ...(token.text ? { content: [{ type: "text", text: token.text }] } : {}) }];
      case "hr": return [{ type: "rule" }];
      case "blockquote": return [{ type: "blockquote", content: blocks(token.tokens) }];
      case "list": return [{ type: token.ordered ? "orderedList" : "bulletList", ...(token.ordered ? { attrs: { order: token.start } } : {}), content: token.items.map(item => {
        if (item.task) throw new Error("Task checkboxes are not supported yet. Use a regular Markdown list.");
        const content = blocks(item.tokens);
        if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph", content: [] });
        return { type: "listItem", content };
      }) }];
      case "table": return [{ type: "table", attrs: { isNumberColumnEnabled: false, layout: "default" }, content: [token.header, ...token.rows].map((row, i) => ({ type: "tableRow", content: row.map(cell => ({ type: i === 0 ? "tableHeader" : "tableCell", attrs: {}, content: [{ type: "paragraph", content: inline(cell.tokens) }] })) })) }];
      case "html": throw new Error("Raw HTML is not supported. Use Markdown formatting instead.");
      default: throw new Error(`Unsupported Markdown block: ${token.type}`);
    }
  });
}
export function markdownToAdf(markdown) {
  const content = blocks(Lexer.lex(String(markdown || ""), { gfm: true }));
  return { type: "doc", version: 1, content: content.length ? content : [{ type: "paragraph", content: [] }] };
}

// Ignore Jira's optional/default attributes and adjacent text-node splitting
// when verifying the persisted document, but retain actual content and marks.
export function comparableAdf(node) {
  if (typeof node === "string") return comparableAdf(markdownToAdf(node));
  if (!node) return null;
  const result = { type: node.type };
  if (node.text !== undefined) result.text = node.text;
  const attrs = {};
  for (const key of ["level", "language", "href", "title"]) if (node.attrs?.[key]) attrs[key] = node.attrs[key];
  if (node.type === "orderedList") attrs.order = node.attrs?.order || 1;
  if (Object.keys(attrs).length) result.attrs = attrs;
  if (node.marks?.length) result.marks = node.marks.map(comparableAdf).sort((a, b) => a.type.localeCompare(b.type));
  if (node.content?.length) {
    result.content = [];
    for (const child of node.content.map(comparableAdf)) {
      const previous = result.content.at(-1);
      if (child.type === "text" && previous?.type === "text" && JSON.stringify(previous.marks) === JSON.stringify(child.marks)) previous.text += child.text;
      else result.content.push(child);
    }
  }
  return result;
}
