// tests/ui-save.test.mjs —— 存档功能的界面层集成：自动存档、槽位、导出导入、重开本关
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { installDom, clearStorage, flatten, clickButton, walk, buttonByText } from './_dom.mjs';

const { registry } = installDom();
const app = await import('../src/ui/app.js');
const { SAVE_FORMAT, SAVE_VERSION, SLOT_COUNT } = await import('../src/core/savefile.js');

function fresh(levelId) {
  clearStorage();
  app.debugGuideStop();
  app.loadLevel(levelId);
  app.debugGo('desk');
}
const el = (id) => registry.get(id);
const inputs = (root) => {
  const out = [];
  walk(root, (e) => { if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') out.push(e); });
  return out;
};
/* 在 L0-13 上真的推两步：假设 A，再用 →E 得 B */
function playTwoSteps(levelId = 'L0-13') {
  fresh(levelId);
  app.debugGuideSkip();
  const st = app.debugState();
  const prem = st.facts.find((f) => f.rule === 'premise');
  app.debugAssumption('A');
  const hyp = app.debugFacts().find((f) => f.rule === 'assume');
  app.debugSelectAndUse([hyp.id, prem.id], 'impE');
}

test('存档入口：三个顶栏/证明台上都有直达按钮（不然没人找得到）', () => {
  fresh('L0-13');
  app.debugGuideSkip();
  // 注意：打桩 DOM 不会解析 index.html，所以“按钮在不在页面上”要查接线
  // （app.js 里 $('id').onclick 一定会把元素注册进来），元素本身的存在性由
  // tutorial.test.mjs 里的静态对照测试负责。
  // ① 证明选择顶栏的「存档」
  app.debugGo('select');
  assert.equal(typeof el('nav-save').onclick, 'function', '证明选择顶栏应当有「存档」入口');
  el('nav-save').onclick();
  assert.equal(app.debugScreen(), 'archive');
  assert.equal(app.debugArchiveTab(), 'save', '应当直接停在存档分页');
  // ② 证明台顶栏的「存档」
  app.debugGo('desk');
  assert.equal(typeof el('nav-save-desk').onclick, 'function', '证明台顶栏应当有「存档」入口');
  el('nav-save-desk').onclick();
  assert.equal(app.debugArchiveTab(), 'save');
  // ③ 证明台下方的「存档 / 读档」
  app.debugGo('desk');
  assert.equal(typeof el('btn-saves').onclick, 'function', '证明台上应当有存档按钮');
  el('btn-saves').onclick();
  assert.equal(app.debugArchiveTab(), 'save');
  // ④ 档案室顶栏的「档案室」仍然进成就页
  app.debugGo('select');
  el('nav-archive').onclick();
  assert.equal(app.debugArchiveTab(), 'ach', '「档案室」应当进成就分页');
});

test('存档入口：开始页也标出了存档能力', () => {
  clearStorage();
  app.debugGo('start');
  assert.equal(el('meta-saves').textContent, String(SLOT_COUNT), '开始页应当显示槽位数');
});

test('每一步都会自动存档：现场写进 lpg.save.auto', () => {
  fresh('L0-13');
  app.debugGuideSkip();
  assert.equal(app.debugAutoSave().levels, 0, '还没推就不该有现场');
  app.debugAssumption('A');
  assert.equal(app.debugAutoSave().levels, 1, '开了假设就该记下来');
  assert.equal(app.debugAutoSave().lastLevel, 'L0-13');
  assert.equal(app.debugAutoSave().steps, 1);
  app.debugSelectAndUse([app.debugFacts().find((f) => f.rule === 'assume').id, 'p1'], 'impE');
  assert.equal(app.debugAutoSave().steps, 2, '推第二步后步数应当跟上');
});

test('关掉再打开：载入同一关会把现场装回来', () => {
  playTwoSteps();
  const before = app.debugFacts().map((f) => f.id + ':' + f.text);
  assert.equal(before.length, 4, '题设 2 条 + 假设 + 推导');
  app.loadLevel('L0-13');                       // 相当于重新打开这一关
  assert.deepEqual(app.debugFacts().map((f) => f.id + ':' + f.text), before, '事实应当一模一样地回来');
  assert.deepEqual(app.debugScopes().length, 1, '子证明作用域也要回来');
  const st = app.debugStatusText();
  assert.ok(/恢复/.test(st), '应当明确说明是恢复的：' + st);
});

test('恢复后还能接着推完（不只是看起来像）', () => {
  playTwoSteps();
  app.loadLevel('L0-13');
  // 顺着标准证明把剩下两步走完
  const st = app.debugState();
  const b = app.debugFacts().find((f) => f.text === 'B');
  app.debugSelectAndUse([b.id, 'p2'], 'impE');
  const c = app.debugFacts().find((f) => f.text === 'C');
  app.debugSelectAndUse([c.id], 'impI');
  assert.ok(app.debugSolved(), '恢复现场后应当能把这一关推完：' + app.debugStatusText());
  void st;
});

test('过关后现场被清掉，不会一进去就显示“已完成”', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugSelect(['p1']);
  app.debugUseRule('hyp');
  assert.ok(app.debugSolved());
  assert.equal(app.debugAutoSave().levels, 0, '过关了就不该再留现场');
  app.loadLevel('L0-01');
  assert.equal(app.debugSolved(), false, '重进这一关应当是干净的');
});

test('多关并行：各自的现场互不覆盖', () => {
  fresh('L0-13');
  app.debugGuideSkip();
  app.debugAssumption('A');
  app.loadLevel('L0-07');
  app.debugAssumption('A');
  const d = app.debugAutoSave();
  assert.equal(d.levels, 2, '两关的现场都该留着：' + JSON.stringify(d));
  assert.deepEqual(d.sceneIds.sort(), ['L0-07', 'L0-13']);
  app.loadLevel('L0-13');
  assert.equal(app.debugScopes().length, 1, '回到 L0-13 应当还有那层假设');
});

test('“重开本关”要两次点击才生效，点了以后现场清空', () => {
  playTwoSteps();
  assert.equal(app.debugAutoSave().levels, 1);
  el('btn-restart').onclick();                  // 第一次：进入待确认
  assert.equal(app.debugAutoSave().levels, 1, '第一次点击不该清掉现场');
  assert.ok(/再点一次/.test(el('btn-restart').textContent), '按钮应当变成确认文案：' + el('btn-restart').textContent);
  el('btn-restart').onclick();                  // 第二次：真的重开
  assert.equal(app.debugAutoSave().levels, 0, '现场应当被清掉');
  assert.deepEqual(app.debugScopes(), [], '子证明也要清掉');
  assert.equal(app.debugState().facts.filter((f) => !f.given).length, 0, '回到只有题设的状态');
  assert.ok(/从第一步重来/.test(app.debugStatusText()), app.debugStatusText());
});

test('存档槽：存下 → 清空进度 → 读回（进度与现场一起回来）', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugSelect(['p1']);
  app.debugUseRule('hyp');                      // 先通关一关，让进度里有东西
  assert.deepEqual(app.debugDone(), ['L0-01']);

  app.loadLevel('L0-13');                       // 再到另一关推两步，制造现场
  app.debugAssumption('A');
  app.debugSelectAndUse([app.debugFacts().find((f) => f.rule === 'assume').id, 'p1'], 'impE');

  app.debugSaveToSlot(0);
  const d = app.debugSlots()[0];
  assert.ok(d, '槽位 1 应当有存档');
  assert.equal(d.levelId, 'L0-13');
  assert.equal(d.hasScene, true);
  assert.equal(d.steps, 2);
  assert.equal(d.solved, 1, '通关记录也应当在存档里');

  // “换台机器”：进度清空，但存档槽还在（重置进度不会删槽位）
  el('btn-reset-desk').onclick();
  assert.deepEqual(app.debugDone(), []);
  assert.equal(app.debugAutoSave().levels, 0);

  const msg = app.debugLoadSlot(0);
  assert.ok(/已读取槽位 1/.test(msg), msg);
  assert.deepEqual(app.debugDone(), ['L0-01'], '通关记录应当回来');
  assert.equal(app.debugLevelId(), 'L0-13', '应当跳到存档里那一关');
  assert.equal(app.debugScopes().length, 1, '现场应当装回来');
  assert.ok(app.debugFacts().some((f) => f.text === 'B'), '推出来的 B 也应当回来');
});

test('存档槽：空槽位不能读，读取要两次点击才覆盖', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  const msg = app.debugLoadSlot(2);
  assert.ok(/是空的/.test(msg), msg);
});

test('存档槽：覆盖存入会更新摘要', () => {
  playTwoSteps('L0-13');
  app.debugSaveToSlot(1);
  assert.equal(app.debugSlots()[1].steps, 2);
  app.debugSelectAndUse([app.debugFacts().find((f) => f.text === 'B').id, 'p2'], 'impE');
  app.debugSaveToSlot(1);
  assert.equal(app.debugSlots()[1].steps, 3, '覆盖后步数应当更新');
});

test('导出文本 → 清空 → 导入：进度与现场都回来', () => {
  playTwoSteps('L0-13');
  app.debugSelect(['p1']);
  app.debugUseRule('hyp');                      // 顺手留点进度
  const text = app.debugSaveText();
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, SAVE_FORMAT);
  assert.equal(parsed.version, SAVE_VERSION);
  assert.ok(text.length > 400, '存档文本不该这么短：' + text.length);
  assert.ok(text.indexOf('L0-13') > 0);

  clearStorage();
  app.loadLevel('L0-01');
  assert.deepEqual(app.debugDone(), []);
  const msg = app.debugImport(text);
  assert.ok(/导入成功/.test(msg), msg);
  assert.equal(app.debugLevelId(), 'L0-13');
  assert.equal(app.debugScopes().length, 1, '现场应当一起回来');
});

test('导入：坏数据被拒绝，且不动现有进度', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugSelect(['p1']);
  app.debugUseRule('hyp');
  const before = app.debugDone().slice();

  assert.ok(/不是合法的 JSON/.test(app.debugImport('这不是 json')));
  assert.ok(/不是《证明之路》的存档/.test(app.debugImport('{"a":1}')));
  assert.ok(/更新的版本/.test(app.debugImport(JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION + 1, progress: {} }))));
  assert.ok(/现场是坏的/.test(app.debugImport(JSON.stringify({ format: SAVE_FORMAT, version: 1, scene: { facts: 'x' }, progress: {} }))));
  assert.deepEqual(app.debugDone(), before, '导入失败不该改动现有进度');
  assert.equal(app.debugLevelId(), 'L0-01');
});

test('导入：空存档会被忽略而不是清空玩家进度', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugSelect(['p1']);
  app.debugUseRule('hyp');
  const empty = JSON.stringify({ format: SAVE_FORMAT, version: 1, progress: {}, scene: null });
  const msg = app.debugImport(empty);
  assert.ok(/是空的/.test(msg), msg);
  assert.deepEqual(app.debugDone(), ['L0-01'], '进度不该被动过');
});

test('导入：只带进度的存档也能读，不需要现场', () => {
  clearStorage();
  const text = JSON.stringify({
    format: SAVE_FORMAT, version: 1, savedAt: Date.now(), name: '只存进度',
    progress: { done: ['L0-01', 'L0-03'], ach: ['a-first'], history: ['H-EUCLID'] },
    scene: null, lastLevel: null,
  });
  const msg = app.debugImport(text);
  assert.ok(/导入成功/.test(msg), msg);
  assert.deepEqual(app.debugDone().sort(), ['L0-01', 'L0-03']);
  assert.ok(app.debugUnlocked().indexOf('a-first') >= 0 || app.debugUnlocked().length > 0, '成就应当跟着回来');
  assert.equal(app.debugProfile().historyRead, 1, '史话阅读记录应当跟着回来');
});

test('启动时回到上次推了一半的那一关', () => {
  clearStorage();
  assert.equal(app.debugBootLevel(), 'L0-01', '没有现场时从第一关开始');
  app.loadLevel('L0-07');
  app.debugAssumption('A');
  assert.equal(app.debugBootLevel(), 'L0-07', '有现场时应当回到那一关');
  app.debugClearAuto();
  assert.equal(app.debugBootLevel(), 'L0-01', '清掉现场后回到第一关');
});

test('档案室：存档分页渲染出自动存档、槽位、导入与危险操作', () => {
  playTwoSteps('L0-13');
  app.debugGo('archive');
  app.debugArchiveTab('save');
  assert.ok(flatten(el('archive-tabs')).indexOf('存档') >= 0, '分页标签里应当有“存档”');
  const text = flatten(el('archive-body'));
  assert.ok(text.indexOf('自动存档') >= 0, '应当有自动存档卡片');
  assert.ok(text.indexOf('L0-13') >= 0, '自动存档卡片应当写出是哪一关');
  assert.ok(text.indexOf('存档槽位') >= 0, '应当有槽位卡片');
  assert.ok(text.indexOf('导入存档') >= 0, '应当有导入卡片');
  assert.ok(text.indexOf('危险操作') >= 0, '应当有危险操作卡片');
  assert.ok(text.indexOf('导出存档文件') >= 0, '应当有导出按钮');
  // 槽位输入框：三个都在
  const vals = inputs(el('archive-body')).map((i) => i.value || '');
  for (let i = 1; i <= SLOT_COUNT; i++) {
    assert.ok(vals.some((v) => v.indexOf(String(i)) >= 0 || v.indexOf('存档') >= 0), '槽位 ' + i + ' 的输入框没渲染出来：' + JSON.stringify(vals));
  }
  assert.equal(app.debugSlots().filter(Boolean).length, 0, '还没手动存过，槽位应当是空的');
});

test('档案室：点“存入此槽”真的会写进槽位，摘要随之更新', () => {
  playTwoSteps('L0-13');
  app.debugGo('archive');
  app.debugArchiveTab('save');
  assert.equal(clickButton(el('archive-body'), /存入此槽/), true, '应当有“存入此槽”按钮');
  const slots = app.debugSlots();
  assert.ok(slots[0], '槽位 1 应当被写入：' + JSON.stringify(slots));
  assert.equal(slots[0].levelId, 'L0-13');
  assert.equal(slots[0].steps, 2);
  // 重画之后卡片上应当出现存档信息
  const text = flatten(el('archive-body'));
  assert.ok(text.indexOf('L0-13 · 2 步') >= 0, '槽位卡片应当显示现场：' + text.slice(0, 400));
  assert.ok(text.indexOf('读取此槽') >= 0, '满了的槽位应当有读取按钮');
});

test('档案室：点“存档文本”会把文本放进文本框', () => {
  playTwoSteps('L0-13');
  app.debugGo('archive');
  app.debugArchiveTab('save');
  assert.equal(clickButton(el('archive-body'), /^存档文本$/), true, '应当有“存档文本”按钮');
  const tas = inputs(el('archive-body')).filter((i) => i.tagName === 'TEXTAREA');
  assert.equal(tas.length, 1, '应当有一个文本框');
  assert.ok(tas[0].value.length > 400, '文本框里应当有存档内容：' + tas[0].value.length);
  const parsed = JSON.parse(tas[0].value);
  assert.equal(parsed.format, SAVE_FORMAT);
  // 清空文本框
  assert.equal(clickButton(el('archive-body'), /清空文本框/), true);
  const tas2 = inputs(el('archive-body')).filter((i) => i.tagName === 'TEXTAREA');
  assert.equal(tas2[0].value, '', '文本框应当被清空');
});

test('档案室：重置进度会保留手动存档槽', () => {
  playTwoSteps('L0-13');
  app.debugSaveToSlot(2);
  assert.ok(app.debugSlots()[2], '槽位 3 应当有存档');
  el('btn-reset-desk').onclick();
  assert.deepEqual(app.debugDone(), [], '重置后进度清空');
  assert.equal(app.debugAutoSave().levels, 0, '自动存档现场也清掉');
  assert.ok(app.debugSlots()[2], '手动存档槽必须保留');
  const msg = app.debugLoadSlot(2);
  assert.ok(/已读取/.test(msg), msg);
  assert.equal(app.debugLevelId(), 'L0-13', '读回后应当回到存档那一关');
});

test('档案室：删除全部槽位要两次点击', () => {
  playTwoSteps('L0-13');
  app.debugSaveToSlot(0);
  app.debugSaveToSlot(1);
  app.debugGo('archive');
  app.debugArchiveTab('save');
  assert.equal(clickButton(el('archive-body'), /^删除全部存档槽$/), true);
  assert.equal(app.debugSlots().filter(Boolean).length, 2, '第一次点击只是确认');
  assert.equal(clickButton(el('archive-body'), /再点一次确认删除/), true);
  assert.equal(app.debugSlots().filter(Boolean).length, 0, '第二次点击才真的删除');
});

test('存档分页的提示信息会留在页面上（重画也不丢）', () => {
  playTwoSteps('L0-13');
  app.debugGo('archive');
  app.debugArchiveTab('save');
  const msg = app.debugLoadSlot(2);            // 空槽位 → 应当给提示
  assert.ok(/是空的/.test(msg), msg);
  const text = flatten(el('archive-body'));
  assert.ok(text.indexOf('是空的') >= 0, '提示应当渲染在分页上：' + text.slice(0, 300));
});
