import test from 'node:test';
import assert from 'node:assert/strict';
import { adfToMarkdown, markdownToAdf, comparableAdf, hasJiraOnlyContent } from './description-format.js';

const same = (a, b) => assert.deepEqual(comparableAdf(a), comparableAdf(b));
const roundtrip = markdown => {
  const doc = markdownToAdf(markdown);
  same(markdownToAdf(adfToMarkdown(doc)), doc);
  return doc;
};

test('Markdown becomes Jira rich text and round-trips headings, marks, links and code', () => {
  const doc = roundtrip('# Heading\n\n**Bold**, *italic*, ~~strike~~ and `inline code`.\n\n[A link](https://example.com/path)\n\n```js\nconst x = 1;\n```');
  assert.equal(doc.content[0].type, 'heading');
  assert.equal(doc.content[1].content[0].marks[0].type, 'strong');
  assert.equal(doc.content.at(-1).type, 'codeBlock');
});

test('nested lists, ordered list starts, quotes, rules and tables round-trip', () => {
  roundtrip('3. Third\n4. Fourth\n   - Nested\n   - Another\n\n> A quote\n>\n> Another paragraph\n\n---\n\n| Name | Value |\n| --- | --- |\n| **One** | Two |');
});

test('literal Markdown punctuation in ADF stays literal', () => {
  const text = '# not a heading *not bold* [not a link] | column ~~text~~ 1. No &amp; <https://example.com>';
  const doc = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
  same(markdownToAdf(adfToMarkdown(doc)), doc);
});

test('hard breaks, entities, unicode and backticks are preserved', () => {
  roundtrip('First  \nSecond &amp; third — café 🚀\n\n`` `nested` ``');
  roundtrip('````js\n```example\ncode\n```\n````');
  roundtrip('[link](https://example.com/?x=1&y=2 "A title & more")');
});

test('empty Markdown clears description with a valid empty ADF paragraph', () => {
  assert.deepEqual(markdownToAdf(''), { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [] }] });
});

test('adjacent formatted nodes and marked boundary spaces render as Markdown, not raw syntax', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: ' Bold ', marks: [{ type: 'strong' }] },
    { type: 'text', text: 'text', marks: [{ type: 'strong' }] }
  ] }] };
  assert.equal(adfToMarkdown(doc), ' **Bold text**');
  assert.equal(markdownToAdf(adfToMarkdown(doc)).content[0].content.find(node => node.marks)?.marks[0].type, 'strong');
});

test('Jira-only content is detected so editing can show a warning', () => {
  assert.equal(hasJiraOnlyContent(markdownToAdf('**Supported**')), false);
  assert.equal(hasJiraOnlyContent({ type: 'doc', content: [{ type: 'mention', attrs: { id: '123', text: '@Alice' } }] }), true);
  assert.equal(hasJiraOnlyContent({ type: 'text', text: 'Color', marks: [{ type: 'textColor', attrs: { color: '#ff0000' } }] }), true);
});

test('unsupported Markdown is rejected instead of silently dropping content', () => {
  assert.throws(() => markdownToAdf('<script>alert(1)</script>'), /Raw HTML/);
  assert.throws(() => markdownToAdf('![Image](https://example.com/a.png)'), /images cannot be saved/);
  assert.throws(() => markdownToAdf('- [x] Task'), /Task checkboxes/);
});

test('verification tolerates default Jira attributes and adjacent text splitting', () => {
  same({ type: 'doc', version: 1, content: [{ type: 'orderedList', attrs: { order: 1, localId: 'server-generated' }, content: [
    { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }, { type: 'text', text: ' two' }] }] }
  ] }] }, markdownToAdf('1. One two'));
});
