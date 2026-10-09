// tests/save.test.mjs —— 存档格式：序列化、校验、还原（纯函数，不碰 DOM）
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { P, fkey } from '../src/core/logic.js';
import { LEVELS } from '../src/data/levels.js';
import { createState, applyStep, matchedFact, visibleFacts } from '../src/core/proof.js';
import {
  SAVE_FORMAT, SAVE_VERSION, SLOT_COUNT,
  sceneFromState, applyScene, normalizeScene, sceneStepCount, sceneIsEmpty,
  makeSave, parseSave, describeSave, saveFileName, formatWhen, exportSaveText,
  normalizeProgress, emptyProgress, saveIsEmpty,
  emptyAutoSave, normalizeAutoSave, withScene, sceneForLevel, describeAutoSave,
} from '../src/core/savefile.js';

const byId = (id) => LEVELS.find((l) => l.id === id);

/* 把一关的标准证明推前 n 步，返回状态 */
function playN(id, n) {
  const lv = byId(id);
  const st = createState(lv);
  for (const step of lv.script.slice(0, n)) applyStep(st, step);
  return st;
}
const texts = (st) => visibleFacts(st).map((f) => f.id + ':' + P(f.f));
const SAMPLE_PROGRESS = {
  done: ['L0-01'], stats: { 'L0-01': { steps: 1 } }, rules: { hyp: 1 },
  flags: { maxScopeDepth: 1 }, history: ['H-EUCLID'], ach: ['a-first'], guide: { off: false },
};

test('存档常量与槽位数是定值', () => {
  assert.equal(SAVE_FORMAT, 'proof-road-save');
  assert.equal(SAVE_VERSION, 1);
  assert.ok(SLOT_COUNT >= 1 && SLOT_COUNT <= 9, '槽位数不合理：' + SLOT_COUNT);
});

test('现场：从证明状态取出，步数只数玩家推出来的部分', () => {
  const st = playN('L0-13', 2);                 // 假设 A + 一次 →E
  const scene = sceneFromState(st);
  assert.equal(scene.levelId, 'L0-13');
  assert.equal(scene.facts.length, st.facts.length);
  assert.equal(sceneStepCount(scene), 2, '题设不算步数');
  assert.equal(sceneIsEmpty(scene), false);
  assert.equal(sceneIsEmpty(sceneFromState(createState(byId('L0-13')))), true, '什么都没推就是空现场');
  assert.equal(sceneFromState(null), null);
  assert.equal(normalizeScene({ facts: [] }), null, '没有事实的现场应当作废');
  assert.equal(normalizeScene(null), null);
});

test('现场还原：接回一个干净状态后，事实一模一样', () => {
  const st = playN('L0-13', 2);
  const scene = sceneFromState(st);
  const st2 = createState(byId('L0-13'));
  const r = applyScene(st2, scene);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.steps, 2);
  assert.deepEqual(texts(st2), texts(st));
  assert.deepEqual(st2.scopeStack, st.scopeStack);
  assert.deepEqual(st2.assumptions, st.assumptions);
  assert.equal(st2.nextId, st.nextId);
  assert.equal(st2.assumeCount, st.assumeCount);
});

test('现场还原：JSON 往返之后仍然等价（存档就是 JSON）', () => {
  const st = playN('L0-10', 3);                  // 嵌套两层子证明
  const round = JSON.parse(JSON.stringify(sceneFromState(st)));
  const st2 = createState(byId('L0-10'));
  const r = applyScene(st2, round);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(texts(st2), texts(st));
  assert.deepEqual(st2.scopeStack, st.scopeStack, '嵌套作用域必须一起回来');
});

test('现场还原：接着把剩下的步骤推完，仍然达阵', () => {
  const lv = byId('L0-13');
  for (let cut = 1; cut < lv.script.length; cut++) {
    const st = createState(lv);
    for (const step of lv.script.slice(0, cut)) applyStep(st, step);
    const scene = JSON.parse(JSON.stringify(sceneFromState(st)));
    const st2 = createState(lv);
    assert.equal(applyScene(st2, scene).ok, true, '第 ' + cut + ' 步处还原失败');
    for (const step of lv.script.slice(cut)) applyStep(st2, step);
    assert.ok(matchedFact(st2), '从第 ' + cut + ' 步接下来应当能推到目标');
  }
});

test('现场还原：关卡对不上、或题设变了，都要拒绝并说明原因', () => {
  const scene = sceneFromState(playN('L0-13', 2));
  const other = createState(byId('L0-03'));
  const r1 = applyScene(other, scene);
  assert.equal(r1.ok, false);
  assert.ok(/不是当前这一关/.test(r1.error), r1.error);

  // 题设被改过（模拟“存档来自旧版本关卡表”）：换掉两条题设的顺序就会被发现
  const tampered = JSON.parse(JSON.stringify(scene));
  const gi = tampered.facts.map((f, i) => (f.given ? i : -1)).filter((i) => i >= 0);
  assert.ok(gi.length >= 2, '这一关应当至少有两条题设');
  const tmp = tampered.facts[gi[0]];
  tampered.facts[gi[0]] = tampered.facts[gi[1]];
  tampered.facts[gi[1]] = tmp;
  const st = createState(byId('L0-13'));
  const r2 = applyScene(st, tampered);
  assert.equal(r2.ok, false, '题设对不上时必须拒绝');
  assert.ok(/题设|公理/.test(r2.error), r2.error);
  assert.equal(st.facts.filter((f) => !f.given).length, 0, '被拒绝时不该改动状态');
});

test('现场还原：缺胳膊少腿的现场不会崩，只会被拒', () => {
  const st = createState(byId('L0-13'));
  for (const bad of [null, {}, { facts: 'x' }, { facts: [] }, { facts: [1, 2] }]) {
    const r = applyScene(st, bad);
    assert.equal(r.ok, false, '这些输入都该被拒：' + JSON.stringify(bad));
  }
  assert.equal(applyScene(null, { facts: [{}] }).ok, false);
});

test('存档往返：makeSave → 文本 → parseSave，内容一致', () => {
  const scene = sceneFromState(playN('L0-08', 3));
  const sv = makeSave({ progress: SAMPLE_PROGRESS, scene, name: '我的存档' });
  assert.equal(sv.format, SAVE_FORMAT);
  assert.equal(sv.version, SAVE_VERSION);
  assert.equal(sv.lastLevel, 'L0-08');
  const r = parseSave(exportSaveText(sv));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.save.name, '我的存档');
  assert.equal(r.save.savedAt, sv.savedAt, '导出再导入不该改时间戳');
  assert.equal(r.save.lastLevel, 'L0-08');
  assert.deepEqual(r.save.progress.done, ['L0-01']);
  assert.equal(sceneStepCount(r.save.scene), 3);
  // 从解析结果也能真的装上
  const st = createState(byId('L0-08'));
  assert.equal(applyScene(st, r.save.scene).ok, true);
});

test('存档往返：直接传对象也行，进度会被补齐成完整字段', () => {
  const r = parseSave({ format: SAVE_FORMAT, version: 1, progress: { done: ['L0-01'] } });
  assert.equal(r.ok, true, r.error);
  const p = r.save.progress;
  for (const k of ['done', 'stats', 'rules', 'flags', 'history', 'ach', 'guide']) {
    assert.ok(p[k] !== undefined, '缺少进度字段 ' + k);
  }
  assert.equal(r.save.scene, null, '没有现场时应当是 null');
});

test('存档校验：坏输入一律给出可读原因，绝不抛异常', () => {
  const cases = [
    ['', /空/],
    ['   ', /空/],
    ['这不是 JSON', /不是合法的 JSON/],
    ['[1,2,3]', /JSON 对象/],
    ['{"a":1}', /不是《证明之路》的存档/],
    [JSON.stringify({ format: 'other-game', version: 1 }), /不是《证明之路》的存档/],
    [JSON.stringify({ format: SAVE_FORMAT, version: 99, progress: {} }), /更新的版本/],
    [JSON.stringify({ format: SAVE_FORMAT, version: 1, scene: { facts: 'x' }, progress: {} }), /现场是坏的/],
    [JSON.stringify({ format: SAVE_FORMAT, version: 1, scene: { facts: [] }, progress: {} }), /现场是坏的/],
  ];
  for (const [input, re] of cases) {
    let r;
    assert.doesNotThrow(() => { r = parseSave(input); }, '解析不该抛异常：' + String(input).slice(0, 40));
    assert.equal(r.ok, false, '这份输入本该被拒：' + String(input).slice(0, 40));
    assert.ok(re.test(r.error), '错误信息不对：' + r.error);
  }
});

test('进度归一化：脏数据被降级，不会污染存档', () => {
  const p = normalizeProgress({
    done: ['L0-01', 'L0-01', 42, null, ''], stats: 'x', rules: null,
    flags: [], history: ['H-EUCLID', 'H-EUCLID', 7], ach: ['a-first'], guide: 'nope',
  });
  assert.deepEqual(p.done, ['L0-01'], '去重并过滤非法项');
  assert.deepEqual(p.stats, {});
  assert.deepEqual(p.rules, {});
  assert.deepEqual(p.flags, {});
  assert.deepEqual(p.history, ['H-EUCLID']);
  assert.deepEqual(p.ach, ['a-first']);
  assert.deepEqual(p.guide, {});
  assert.deepEqual(normalizeProgress(null), emptyProgress());
});

test('存档摘要：关卡、步数、通关数、成就数、时间都对得上', () => {
  const scene = sceneFromState(playN('L0-08', 3));
  const sv = makeSave({ progress: SAMPLE_PROGRESS, scene, name: 'x' });
  const d = describeSave(sv);
  assert.equal(d.levelId, 'L0-08');
  assert.equal(d.steps, 3);
  assert.equal(d.hasScene, true);
  assert.equal(d.solved, 1);
  assert.equal(d.ach, 1);
  assert.equal(d.history, 1);
  assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(d.when), '时间格式不对：' + d.when);
  assert.equal(formatWhen(0), '—');
  assert.ok(/^proof-road-L0-08-\d{8}\d{4}\.json$/.test(saveFileName(sv)), saveFileName(sv));
});

test('“空存档”判定：什么都没存就不该覆盖别人的进度', () => {
  assert.equal(saveIsEmpty({ format: SAVE_FORMAT, version: 1, progress: emptyProgress(), scene: null }), true);
  assert.equal(saveIsEmpty({ format: SAVE_FORMAT, version: 1, progress: { done: ['L0-01'] }, scene: null }), false);
  const scene = sceneFromState(playN('L0-13', 1));
  assert.equal(saveIsEmpty({ format: SAVE_FORMAT, version: 1, progress: emptyProgress(), scene }), false,
    '只有现场也该算“有内容”');
});

test('自动存档：逐关记现场，别的关不会被覆盖', () => {
  let auto = emptyAutoSave();
  assert.deepEqual(describeAutoSave(auto).sceneIds, []);

  auto = withScene(auto, 'L0-13', sceneFromState(playN('L0-13', 2)));
  auto = withScene(auto, 'L0-07', sceneFromState(playN('L0-07', 1)));
  let d = describeAutoSave(auto);
  assert.equal(d.levels, 2);
  assert.equal(d.steps, 3, '两关合计步数');
  assert.equal(d.lastLevel, 'L0-07');
  assert.equal(sceneForLevel(auto, 'L0-13').levelId, 'L0-13', '先写的那一关还应当在');
  assert.equal(sceneStepCount(sceneForLevel(auto, 'L0-13')), 2);

  // 清掉其中一关
  auto = withScene(auto, 'L0-13', null);
  assert.equal(sceneForLevel(auto, 'L0-13'), null);
  assert.equal(describeAutoSave(auto).levels, 1);

  // 只推了题设（空现场）不该留下记录
  auto = withScene(auto, 'L0-02', sceneFromState(createState(byId('L0-02'))));
  assert.equal(sceneForLevel(auto, 'L0-02'), null, '空现场不入档');
});

test('自动存档：归一化能吃掉各种脏数据', () => {
  const a = normalizeAutoSave({ scenes: { 'L0-13': { facts: 'x' }, 'L0-07': { facts: [{ id: 'f1', f: { k: 'atom', name: 'A', args: [] }, rule: 'hyp' }] } }, lastLevel: 42, version: 'v' });
  assert.deepEqual(Object.keys(a.scenes), ['L0-07'], '坏现场要被丢掉');
  assert.equal(a.scenes['L0-07'].levelId, 'L0-07', '关卡 id 以键为准');
  assert.equal(a.lastLevel, null, '非字符串的 lastLevel 要作废');
  assert.equal(describeAutoSave(null).levels, 0);
  assert.deepEqual(normalizeAutoSave(undefined), emptyAutoSave());
});

test('存档文本是给人看也给人改的：缩进 JSON、字段名稳定', () => {
  const sv = makeSave({ progress: SAMPLE_PROGRESS, scene: null, name: 'x' });
  const text = exportSaveText(sv);
  assert.ok(text.indexOf('\n  ') > 0, '应当是缩进过的 JSON');
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed).sort(), ['app', 'format', 'lastLevel', 'name', 'progress', 'savedAt', 'scene', 'version']);
});
