import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { adfToMarkdown, markdownToAdf, comparableAdf, hasJiraOnlyContent } from './description-format.js';

const controller = (await fs.readFile(new URL('./main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace('export default class JiraSprint extends View', 'globalThis.JiraSprint = class JiraSprint extends View');
const dialog = (await fs.readFile(new URL('./issue-dialog.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ');
const original = {
  summary: 'Original title', updated: '1',
  description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich description', marks: [{ type: 'strong' }] }] }] },
  assignee: { accountId: 'alice', displayName: 'Alice' },
  status: { id: '1', name: 'To Do' }, priority: { name: 'Medium' }
};
function setup(hostProps = false) {
  let fields = structuredClone(original);
  const writes = [], saved = [], tasks = [], controls = new Map();
  const state = { new() { let value = ''; return { value: () => value, set_value(v) { value = v; } }; } };
  // Eagerly walk native descriptions so both loading and loaded modal branches run.
  const element = () => {
    let id;
    const node = new Proxy({}, { get(_, key) {
      if (key === 'when') return (condition, fn) => condition ? fn(node) : node;
      if (key === 'id') return value => { id = value; return node; };
      if (key === 'on_click') return handler => { controls.set(id, handler); return node; };
      return () => node;
    } });
    return node;
  };
  const sandbox = {
    View: class {}, InputState: state, TextareaState: state,
    adfToMarkdown, markdownToAdf, comparableAdf, hasJiraOnlyContent,
    div: element, v_flex: element, h_flex: element,
    Input: { new: element }, Textarea: { new: element }, TextView: { markdown: element },
    props: () => hostProps ? { overlay: 'test', issueKey: 'ADV-1', statuses: ['To Do', 'Done'] } : { overlay: 'test' }, closeOverlay() {},
    shared: () => null, setShared: (_key, value) => saved.push(value),
    exec: async (_cli, args) => {
      writes.push(args);
      if (args[2] === 'edit') {
        fields.summary = args[args.indexOf('--summary') + 1];
        if (args.includes('--description')) fields.description = JSON.parse(args[args.indexOf('--description') + 1]);
      } else if (args[2] === 'transition') fields.status = { id: '2', name: args[args.indexOf('--status') + 1] };
      else if (args[2] === 'assign') fields.assignee = args.includes('--remove-assignee') ? null : { accountId: args[args.indexOf('--assignee') + 1] };
      return { code: 0, stdout: '', stderr: '' };
    }
  };
  vm.createContext(sandbox); vm.runInContext(dialog + '\n' + controller, sandbox);
  const app = new sandbox.JiraSprint();
  app.query = async () => ({ fields: structuredClone(fields) });
  const cx = { notify() {}, timer: { every() { throw new Error('Dialog must not poll the board'); } }, spawn(fn) { tasks.push(fn(cx)); } };
  app.init(hostProps ? {} : { issueKey: 'ADV-1', statuses: ['To Do', 'Done'] }, cx);
  const drain = async () => { for (let i = 0; i < tasks.length; i++) await tasks[i]; };
  return { app, cx, drain, writes, saved, sandbox, controls, ed: app.editors.get('ADV-1'), mutate(fn) { fn(fields); } };
}

test('modal loads title, description and details independently of the sprint board', async () => {
  const { app, drain, ed, sandbox } = setup();
  sandbox.dialogView(app, {}); // loading branch
  await drain();
  assert.equal(ed.summary.value(), 'Original title');
  assert.equal(ed.description.value(), '**Rich description**');
  assert.equal(ed.status.value(), 'To Do');
  sandbox.dialogView(app, {}); // loaded branch
  ed.editingDescription = true;
  sandbox.dialogView(app, {}); // textarea branch
  ed.descriptionPreview = true;
  sandbox.dialogView(app, {}); // Markdown preview branch
});

test('overlay host props open only the selected issue even when init props are empty', async () => {
  const { app, drain, ed } = setup(true);
  await drain();
  assert.equal(app.dialog.issueKey, 'ADV-1');
  assert.equal(ed.summary.value(), 'Original title');
  assert.equal(app.sprints.length, 0, 'dialog does not fetch or render the sprint list');
});

test('rendered status choice and Save button transition the selected issue', async () => {
  const { app, cx, drain, ed, writes, sandbox, controls } = setup();
  await drain();
  sandbox.dialogView(app, {});
  controls.get('dialog-status-1')({}, cx);
  assert.equal(ed.status.value(), 'Done');
  sandbox.dialogView(app, {});
  controls.get('dialog-save')({}, cx);
  await drain();
  assert.deepEqual(writes.map(args => args[2]), ['transition']);
  assert.equal(ed.snapshot.status.name, 'Done');
  assert.match(ed.note, /saved and verified/);
});

test('saving title preserves rich description and publishes verified issue state', async () => {
  const { app, cx, drain, ed, writes, saved } = setup();
  await drain();
  ed.summary.set_value('Updated title');
  app.apply(cx, ed); await drain();
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes('--summary'));
  assert.ok(!writes[0].includes('--description'));
  assert.equal(saved[0].fields.summary, 'Updated title');
  assert.deepEqual(saved[0].fields.description, original.description);
  assert.match(ed.note, /saved and verified/);
  assert.equal(ed.busy, false);
});

test('description is replaced only when explicitly edited and changed', async () => {
  const { app, cx, drain, ed, writes, saved } = setup();
  await drain();
  ed.editingDescription = true;
  app.apply(cx, ed); await drain();
  assert.equal(writes.length, 0, 'opening the text editor must preserve original ADF');
  ed.editingDescription = true;
  ed.description.set_value('New description\nSecond line');
  app.apply(cx, ed); await drain();
  assert.ok(writes[0].includes('--description'));
  assert.deepEqual(comparableAdf(saved.at(-1).fields.description), comparableAdf(markdownToAdf('New description\nSecond line')));
  assert.equal(ed.error, null);
});

test('Markdown saves as structured ADF and reopens with formatting intact', async () => {
  const { app, cx, drain, ed, writes, saved } = setup();
  await drain();
  ed.editingDescription = true;
  ed.description.set_value('## Requirements\n\n**Bold** and *italic*.\n\n- One\n- Two\n\n```js\nconst x = true;\n```');
  app.apply(cx, ed); await drain();
  const payload = JSON.parse(writes[0][writes[0].indexOf('--description') + 1]);
  assert.equal(payload.content[0].type, 'heading');
  assert.equal(payload.content[1].content[0].marks[0].type, 'strong');
  assert.equal(payload.content[2].type, 'bulletList');
  assert.equal(payload.content[3].type, 'codeBlock');
  assert.deepEqual(saved.at(-1).fields.description, payload);
  assert.match(ed.description.value(), /## Requirements/);
  assert.equal(ed.error, null);
});

test('unsupported Markdown is rejected before any Jira update', async () => {
  const { app, cx, drain, ed, writes } = setup();
  await drain();
  ed.editingDescription = true;
  ed.summary.set_value('Changed title');
  ed.description.set_value('![image](https://example.com/image.png)');
  app.apply(cx, ed); await drain();
  assert.equal(writes.length, 0);
  assert.match(ed.error, /images cannot be saved/);
  assert.equal(ed.busy, false);
});

test('concurrent Jira edits reset the draft and prevent writes', async () => {
  const { app, cx, drain, ed, writes, mutate } = setup();
  await drain();
  ed.summary.set_value('My title');
  mutate(f => { f.summary = 'Changed in Jira'; f.updated = '2'; });
  app.apply(cx, ed); await drain();
  assert.equal(writes.length, 0);
  assert.equal(ed.summary.value(), 'Changed in Jira');
  assert.match(ed.error, /changed in Jira/);
});

test('failed save is re-read, not automatically retried', async () => {
  const { app, cx, drain, ed, writes, sandbox } = setup();
  await drain();
  ed.summary.set_value('My title');
  sandbox.exec = async (_cli, args) => { writes.push(args); return { code: 1, stderr: 'Permission denied' }; };
  app.apply(cx, ed); await drain();
  assert.equal(writes.length, 1);
  assert.match(ed.error, /Permission denied.*Changes may be partial/);
  assert.equal(ed.summary.value(), 'Original title');
  assert.equal(ed.busy, false);
});

test('assignee and status updates are verified and reflected in the browsing panel', async () => {
  const { app, cx, drain, ed, writes, saved } = setup();
  await drain();
  ed.assignee.set_value('bob'); ed.status.set_value('Done');
  app.apply(cx, ed); await drain();
  assert.deepEqual(writes.map(args => args[2]), ['assign', 'transition']);
  assert.equal(ed.error, null);
  assert.equal(saved.at(-1).fields.assignee.accountId, 'bob');
  assert.equal(saved.at(-1).fields.status.name, 'Done');
  assert.deepEqual(saved.at(-1).fields.description, original.description);
});

test('email assignment verification supports Jira privacy-hidden email addresses', async () => {
  const { app, drain } = setup();
  await drain();
  const queries = [];
  app.query = async args => { queries.push(args); return [{ key: 'ADV-1', fields: { assignee: { accountId: 'bob-id' } } }]; };
  assert.equal(await app.assigneeMatches('ADV-1', 'bob@example.com', { accountId: 'bob-id' }), true);
  assert.match(queries[0][queries[0].indexOf('--jql') + 1], /key = "ADV-1" AND assignee = "bob@example.com"/);
  assert.equal(await app.assigneeMatches('ADV-1', 'bob@example.com', { accountId: 'someone-else' }), false);
});

test('blank title is rejected without a Jira write', async () => {
  const { app, cx, drain, ed, writes } = setup();
  await drain(); ed.summary.set_value(' ');
  app.apply(cx, ed); await drain();
  assert.equal(writes.length, 0);
  assert.match(ed.error, /cannot be empty/);
});

test('ADF projection keeps lists, mentions and embedded-content indicators visible', () => {
  const { sandbox } = setup();
  const text = sandbox.adfToMarkdown({ type: 'doc', content: [
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }] },
    { type: 'mention', attrs: { text: '@Alice' } }, { type: 'media' }
  ] });
  assert.match(text, /- Item/); assert.match(text, /Alice/); assert.match(text, /Attachment/);
});
