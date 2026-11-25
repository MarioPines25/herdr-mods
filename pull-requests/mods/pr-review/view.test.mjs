import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as model from './model.js';
import { githubColors } from './colors.js';
import * as checks from './checks.js';
import * as comments from './comments.js';
import { labelColors } from './description.js';

// Lightweight host stub specifically enforcing GPUI's no-handlers-during-
// virtual-layout contract. Native materialization is checked separately.
const source = (await readFile(new URL('./main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default class PRReview', 'class PRReview') + '\nPRReview;';
function harness(exec = async () => { throw new Error('Unexpected network call'); }) {
  let deferred = false;
  const lists = [], tasks = [], closed = [], clicks = {}, markdown = [], overlays = [];
  let currentId;
  const styles = new Map();
  function element() {
    let proxy;
    proxy = new Proxy({}, { get(_target, name) {
      if (name === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
      if (name === 'id') return id => { currentId = id; return proxy; };
      if (name === 'on_click') return fn => { clicks[currentId] = fn; return proxy; };
      if (name === 'on_item_click') return fn => { proxy.itemClick = fn; return proxy; };
      return (..._args) => {
        if (!styles.has(currentId)) styles.set(currentId, []);
        styles.get(currentId).push(name);
        if (deferred && (String(name).startsWith('on_') || name === 'tooltip')) throw new Error('Handler registered during virtual layout');
        return proxy;
      };
    }, set(target, key, value) { target[key] = value; return true; } });
    // Read explicit handler values without proxy interception.
    return proxy;
  }
  const makeState = () => ({text:'',value(){return this.text;},set_value(v){this.text=v;},on(){},focus(){}});
  const state = makeState(); let inputCount = 0;
  const context = {
    View:class {}, div:element, svg:element, h_flex:element, v_flex:element,
    h_resizable:element, resizable_panel:element,
    Scrollbar:{vertical:element}, TextareaState:{new:()=>inputCount++ === 0 ? state : makeState()}, Textarea:{new:element},
    TextView:{markdown:(id, body)=>{markdown.push({id,body});return element();}}, labelColors,
    v_virtual_list:(_id,count,_size,key,render) => {
      const handlers = {};
      const el = element();
      const wrapper = new Proxy(el, {get(target,name) {
        if (name === 'on_item_click') return fn => {handlers.click=fn;return wrapper;};
        if (name === 'size_full') return () => wrapper;
        return target[name];
      }});
      lists.push({count,key,render,handlers}); return wrapper;
    },
    props:()=>({}), closeOverlay:id=>closed.push(id), openOverlay:spec=>overlays.push(spec), shared:()=>null, settings:()=>({dark:true}), githubColors, exec, ...model, ...checks, ...comments,
  };
  const PRReview = vm.runInNewContext(source, context);
  const cx = {notify(){},timer:{every(){}},spawn(fn){tasks.push(fn(cx));}};
  const view = new PRReview(); view.init({},cx);
  view.target = {host:'github.com',repo:'org/repo',number:42};
  view.meta = {state:'open',draft:true,user:{login:'author'},head:{sha:'head',ref:'feature'},base:{sha:'base',ref:'main'},changed_files:1};
  view.viewer = 'reviewer'; view.error = '';
  view.pick({filename:'file.ts',patch:'@@ -10,2 +20,2 @@\n same\n-old\n+new\n\\ No newline at end of file',additions:1,deletions:1},cx);
  view.files = [view.file];
  return {view,cx,state,lists,tasks,closed,clicks,markdown,overlays,styles,layout(list){deferred=true;try{return list.render({start:0,end:list.count});}finally{deferred=false;}}};
}

test('virtual diff rows register no handlers; list clicks open the correctly sided composer', () => {
  const h = harness(); h.view.render(); const list = h.lists.at(-1);
  assert.doesNotThrow(() => h.layout(list));
  list.handlers.click(list.key(2),h.cx);
  assert.equal(h.view.draft.line,11); assert.equal(h.view.draft.side,'LEFT');
  list.handlers.click(list.key(3),h.cx);
  assert.equal(h.view.draft.line,21); assert.equal(h.view.draft.side,'RIGHT');
  list.handlers.click(list.key(0),h.cx);
  assert.equal(h.view.draft.line,21); // Hunk headers aren't commentable.
  h.view.render(); assert.doesNotThrow(() => h.layout(h.lists.at(-1)));
});

test('checks tab renders partial results and errors while preserving a comment draft', () => {
  const h = harness();
  h.view.activeTab = 'checks';
  h.view.checks = { partial: true, rows: [
    { id: 'failed', kind: 'failure', name: 'Build', app: 'GitHub Actions', label: 'failure', description: 'Compile failed', url: 'https://github.com/org/repo/actions/runs/1' },
    { id: 'pending', kind: 'pending', name: 'Test', label: 'In progress' },
    { id: 'passed', kind: 'success', name: 'Lint', label: 'success' },
  ] };
  assert.doesNotThrow(() => h.view.checksPanel(githubColors(false)));
  h.view.startComment(h.view.rows[3], 'RIGHT', h.cx);
  assert.doesNotThrow(() => h.view.render());
  h.view.checksError = 'HTTP 403';
  assert.doesNotThrow(() => h.view.render());
});

test('modal reviews offer Close and target their own overlay, while existing tab reviews remain usable', () => {
  const h = harness(), buttons = [];
  const button = h.view.button.bind(h.view);
  h.view.button = (id, label, action, primary) => { buttons.push({id, action}); return button(id, label, action, primary); };
  h.view.render();
  assert.ok(!buttons.some(b => b.id === 'pr-review-close'));
  h.view.overlay = 'review-modal-123';
  buttons.length = 0;
  h.view.render();
  const close = buttons.find(b => b.id === 'pr-review-close');
  assert.ok(close);
  close.action();
  assert.deepEqual(h.closed, ['review-modal-123']);
});

test('Files changed is default and Description shows Markdown and labels in its own tab', () => {
  const h = harness();
  h.view.meta.body = '## Summary\n\n**Useful** description\n\n- [x] Tested';
  h.view.meta.labels = [{name:'bug',color:'d73a4a',description:'Something is broken'}];
  h.view.render();
  assert.equal(h.view.activeTab, 'files');
  assert.equal(h.markdown.length, 0);
  h.clicks['pr-tab-description']({}, h.cx);
  h.view.render();
  assert.equal(h.view.activeTab, 'description');
  assert.equal(h.markdown.at(-1).body, h.view.meta.body);
  h.view.pick(h.view.file, h.cx);
  assert.equal(h.view.activeTab, 'description');
  h.clicks['pr-tab-files']({}, h.cx);
  assert.equal(h.view.activeTab, 'files');
});

test('expanded description handles absent body and labels in both palettes', () => {
  const h = harness();
  for (const dark of [false, true]) {
    assert.doesNotThrow(() => h.view.descriptionPanel(githubColors(dark)));
    assert.equal(h.markdown.at(-1).body, '_No description provided._');
  }
});

test('review merge opens confirmation for the displayed snapshot without mutating GitHub', () => {
  const h = harness(); h.view.meta.draft = false;
  h.view.merge();
  assert.equal(h.tasks.length, 0);
  assert.equal(h.overlays.length, 1);
  const spec = h.overlays[0];
  assert.equal(spec.mod, 'pr-merge'); assert.equal(spec.kind, 'dialog');
  assert.equal(spec.props.head, 'head'); assert.equal(spec.props.base, 'base');
  assert.equal(spec.props.login, 'reviewer'); assert.equal(spec.props.repo, 'org/repo');
  h.view.draft = {};
  h.view.merge(); assert.equal(h.overlays.length, 1);
});

test('tabs render only their own content and preserve the selected file and inline draft across round trips', () => {
  const h = harness();
  const panels = [];
  const description = h.view.descriptionPanel.bind(h.view), checksPanel = h.view.checksPanel.bind(h.view);
  h.view.descriptionPanel = t => { panels.push('description'); return description(t); };
  h.view.checksPanel = t => { panels.push('checks'); return checksPanel(t); };
  h.view.render(); assert.deepEqual(panels, []);
  const rows = h.view.rows, file = h.view.file;
  h.view.startComment(rows[3], 'RIGHT', h.cx); h.state.text = 'Keep draft';
  const count = h.lists.length;
  h.clicks['pr-tab-checks']({}, h.cx); h.view.render();
  assert.deepEqual(panels, ['checks']);
  assert.equal(h.view.activeTab, 'checks');
  assert.equal(h.lists.length, count, 'diff is not rendered underneath checks');
  h.clicks['pr-tab-description']({}, h.cx); h.view.render();
  assert.deepEqual(panels, ['checks', 'description']);
  assert.equal(h.lists.length, count);
  assert.equal(h.view.rows, rows); assert.equal(h.view.file, file);
  assert.equal(h.state.text, 'Keep draft'); assert.ok(h.view.draft);
  h.clicks['pr-tab-files']({}, h.cx); h.view.render();
  assert.equal(h.view.activeTab, 'files'); assert.equal(h.state.text, 'Keep draft');
  assert.equal(h.lists.length, count + 1);
  assert.doesNotThrow(() => h.layout(h.lists.at(-1)));
});

test('diff container explicitly fills both dimensions of its resizable panel', () => {
  const h = harness(); h.view.render();
  assert.ok(h.styles.get('pr-review-code').includes('size_full'), 'height alone leaves the diff at its intrinsic width');
  assert.ok(!h.styles.get('pr-review-code').includes('mx'), 'full-width content must not add overflowing horizontal margins');
});

test('changed files form a sorted folder tree with distinct paths and file metadata', () => {
  const h = harness();
  h.view.files = ['z.ts', 'src/z.ts', 'src/components/Button.tsx', 'src/a.ts', 'docs/a.ts', '__proto__/safe.ts']
    .map(filename => ({filename, status:'modified'}));
  const rows = h.view.fileTreeRows();
  assert.deepEqual(Array.from(rows, n => [n.path, n.depth]), [
    ['__proto__',0], ['__proto__/safe.ts',1], ['docs',0], ['docs/a.ts',1],
    ['src',0], ['src/components',1], ['src/components/Button.tsx',2], ['src/a.ts',1], ['src/z.ts',1], ['z.ts',0],
  ]);
  assert.equal(rows.find(n => n.path === 'src/a.ts').file, h.view.files[3]);
});

test('folder clicks collapse and expand without changing the diff or inline draft; leaves select files', () => {
  const h = harness();
  const selected = h.view.file, rows = h.view.rows;
  const next = {filename:'src/nested/next.ts', status:'renamed', previous_filename:'old.ts', patch:'@@ -1 +1 @@\n-old\n+new'};
  h.view.files = [selected, next];
  h.view.startComment(rows[2], 'LEFT', h.cx); h.state.text = 'Keep this draft';
  h.view.render();
  h.clicks['pr-review-folder-src']({}, h.cx);
  assert.equal(h.view.file, selected); assert.equal(h.view.rows, rows);
  assert.equal(h.state.text, 'Keep this draft');
  assert.ok(!h.view.fileTreeRows().some(n => n.path === next.filename));
  h.view.render();
  h.clicks['pr-review-folder-src']({}, h.cx);
  h.view.render();
  assert.ok(h.view.fileTreeRows().some(n => n.path === next.filename));
  h.clicks[`pr-review-file-${next.filename}`]({}, h.cx);
  assert.equal(h.view.file, next); assert.equal(h.view.selected, next.filename);
  assert.equal(h.view.draft.path, selected.filename); assert.equal(h.state.text, 'Keep this draft');
});

test('Comments tab loads Markdown discussion and preserves independent drafts across tabs', async () => {
  const h=harness();
  h.view.api=async()=>[{id:1,user:{login:'alice'},body:'**Hello**',created_at:'2026-01-01'}];
  h.view.generalInput.set_value('General draft'); h.state.text='Inline draft';
  h.view.render(); h.clicks['pr-tab-comments']({},h.cx); await Promise.all(h.tasks); h.view.render();
  assert.equal(h.view.generalComments.length,1);
  assert.ok(h.markdown.some(m=>m.body==='**Hello**'));
  h.clicks['pr-tab-files']({},h.cx); h.view.render();
  assert.equal(h.view.generalInput.value(),'General draft'); assert.equal(h.state.text,'Inline draft');
});

test('Write and Preview render the actual draft without submitting or affecting inline drafts', () => {
  const h=harness(); h.view.activeTab='comments'; h.view.generalLoaded=true;
  h.view.generalInput.set_value('## Hello\n\n**World**'); h.state.text='Inline';
  h.view.render(); h.clicks['pr-general-preview']({},h.cx); h.view.render();
  assert.equal(h.view.generalPreview,true);
  assert.equal(h.markdown.at(-1).body,'## Hello\n\n**World**');
  assert.equal(h.tasks.length,0); assert.equal(h.state.text,'Inline');
  h.clicks['pr-general-write']({},h.cx);
  assert.equal(h.view.generalPreview,false); assert.equal(h.view.generalInput.value(),'## Hello\n\n**World**');
});

test('discard requires confirmation and only clears the general draft; posting locks draft controls', () => {
  const h=harness(); h.view.activeTab='comments'; h.view.generalLoaded=true;
  h.view.generalInput.set_value('Keep me'); h.state.text='Inline'; h.view.render();
  h.clicks['pr-general-discard']({},h.cx); assert.equal(h.view.generalInput.value(),'Keep me');
  h.view.render(); const discard=h.clicks['pr-general-confirm-discard'];
  h.view.postingGeneral=true; discard({},h.cx); assert.equal(h.view.generalInput.value(),'Keep me');
  h.clicks['pr-general-preview']({},h.cx); assert.equal(h.view.generalPreview,false);
  h.view.postingGeneral=false; discard({},h.cx);
  assert.equal(h.view.generalInput.value(),''); assert.equal(h.state.text,'Inline');
});

test('empty or oversized comment buttons cannot submit, while preview can be posted explicitly', async () => {
  const h=harness(); h.view.activeTab='comments'; h.view.generalLoaded=true;
  h.view.render(); h.clicks['pr-general-post']({},h.cx); assert.equal(h.tasks.length,0);
  h.view.generalInput.set_value('x'.repeat(65537)); h.view.render();
  h.clicks['pr-general-post']({},h.cx); assert.equal(h.tasks.length,0);
  h.view.generalInput.set_value('Ready'); h.view.generalPreview=true;
  let posts=0; h.view.postGeneralComment=()=>posts++;
  h.view.render(); h.clicks['pr-general-post']({},h.cx); assert.equal(posts,1);
});

test('discussion cards handle deleted users, edits, author badges and safe permalinks in both palettes', () => {
  const h=harness(); const links=[];
  for (const dark of [true,false]) {
    h.view.generalCommentCard({id:1,body:'**Hello**',user:{login:'author'},created_at:'2026-11-13T10:00:00Z',updated_at:'2026-11-13T11:00:00Z',html_url:'https://github.com/org/repo/issues/42#issuecomment-1'},githubColors(dark));
    h.clicks['pr-general-link-1']({}, {open_url:u=>links.push(u)});
    assert.doesNotThrow(()=>h.view.generalCommentCard({id:2,body:null,user:null,html_url:'javascript:alert(1)'},githubColors(dark)));
    assert.equal(h.clicks['pr-general-link-2'],undefined);
  }
  assert.equal(links.length,2);
});

test('general comment explicitly posts once, rechecks identity and clears only its own draft', async () => {
  const calls=[];
  const h=harness(async(cmd,args)=>{calls.push(args);return {code:0,stdout:JSON.stringify({id:9,body:'General draft',user:{login:'reviewer'}})};});
  h.view.api=async()=>({login:'reviewer'});
  h.view.generalInput.set_value('General draft'); h.state.text='Inline draft';
  h.view.postGeneralComment(h.cx); h.view.postGeneralComment(h.cx); await Promise.all(h.tasks);
  assert.equal(calls.length,1); assert.ok(calls[0].includes('repos/org/repo/issues/42/comments'));
  assert.equal(h.view.generalInput.value(),''); assert.equal(h.state.text,'Inline draft');
  assert.equal(h.view.generalComments[0].id,9); assert.match(h.view.generalNotice,/posted/);
});

test('general comments reject empty bodies and changed identity without a mutation', async () => {
  const h=harness(); h.view.postGeneralComment(h.cx); assert.equal(h.tasks.length,0);
  h.view.generalInput.set_value('Keep me'); h.view.api=async()=>({login:'other'});
  h.view.postGeneralComment(h.cx); await Promise.all(h.tasks);
  assert.match(h.view.generalError,/account changed/); assert.equal(h.view.generalInput.value(),'Keep me');
});

test('uncertain general comment failure retains draft, warns and never retries automatically', async () => {
  let calls=0;
  const h=harness(async()=>{calls++;throw new Error('timeout');});
  h.view.api=async()=>({login:'reviewer'}); h.view.generalInput.set_value('Keep me');
  h.view.postGeneralComment(h.cx); await Promise.all(h.tasks);
  assert.equal(calls,1); assert.match(h.view.generalError,/may have reached GitHub/);
  assert.equal(h.view.generalInput.value(),'Keep me'); assert.equal(h.view.postingGeneral,false);
});

test('comment refresh preserves previous discussion and draft on failure', async () => {
  const h=harness(); h.view.generalComments=[{id:7,body:'Old'}];
  h.view.generalInput.set_value('Keep me'); h.view.api=async()=>{throw new Error('HTTP 403');};
  h.view.refreshGeneralComments(h.cx); await Promise.all(h.tasks);
  assert.equal(h.view.generalComments[0].id,7); assert.match(h.view.generalError,/outdated/);
  assert.equal(h.view.generalInput.value(),'Keep me');
});

test('queued row clicks cannot attach to a newly selected file', () => {
  const h = harness(); h.view.render(); const list=h.lists.at(-1);
  h.view.pick({filename:'other.ts',patch:'@@ -1 +1 @@\n+x'},h.cx);
  list.handlers.click(list.key(3),h.cx);
  assert.equal(h.view.draft,null);
});

test('nonempty drafts survive file changes and block refresh or accidental retargeting', () => {
  const h = harness(); h.view.startComment(h.view.rows[2],'LEFT',h.cx); h.state.text='Keep this draft';
  h.view.startComment(h.view.rows[3],'RIGHT',h.cx);
  assert.equal(h.view.draft.line,11); assert.equal(h.state.text,'Keep this draft');
  h.view.refresh(h.cx); assert.match(h.view.commentError,/discard/); assert.equal(h.tasks.length,0);
});

test('explicit post checks revision and preserves draft on failure without automatic retry', async () => {
  const h = harness(); h.view.startComment(h.view.rows[3],'RIGHT',h.cx); h.state.text='Question';
  h.view.api = async path => path === 'user' ? {login:'reviewer'} : {...h.view.meta,head:{sha:'new'}};
  h.view.postComment(h.cx); await Promise.all(h.tasks);
  assert.match(h.view.commentError,/PR changed/); assert.equal(h.state.text,'Question'); assert.ok(h.view.draft);
  assert.equal(h.view.postingComment,false);
});

test('successful posting uses captured line and body, clears draft, and never approves', async () => {
  const calls=[];
  const h=harness(async (cmd,args) => {
    calls.push({cmd,args});
    return {code:0,stdout:JSON.stringify({id:123,commit_id:'head',path:'file.ts',side:'RIGHT',original_line:21,user:{login:'reviewer'}})};
  });
  h.view.api=async path => path === 'user' ? {login:'reviewer'} : h.view.meta;
  h.view.startComment(h.view.rows[3],'RIGHT',h.cx); h.state.text='Why this change?';
  h.view.postComment(h.cx); h.view.postComment(h.cx); await Promise.all(h.tasks);
  assert.equal(calls.length,1); assert.ok(calls[0].args.includes('body=Why this change?'));
  assert.ok(calls[0].args.includes('line=21')); assert.ok(!calls[0].args.includes('event=APPROVE'));
  assert.equal(h.view.draft,null); assert.equal(h.state.text,''); assert.match(h.view.commentNotice,/Comment posted/);
});
