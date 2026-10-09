// tests/history.test.mjs —— 数学史内容：结构、引用完整性、覆盖面
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { HISTORY, HISTORY_BY_ID, HISTORY_ERAS, historyForLevel, historyByEra, eraOf } from '../src/data/math-history.js';
import { LEVELS } from '../src/data/levels.js';

const ERA_IDS = HISTORY_ERAS.map((e) => e.id);
const LEVEL_IDS = new Set(LEVELS.map((l) => l.id));

test('数学史条目：每条都有年份、人物、标题、摘要与全文', () => {
  assert.ok(HISTORY.length >= 20, '史话条目太少：' + HISTORY.length);
  for (const h of HISTORY) {
    assert.ok(h.id && /^H-[A-Z0-9-]+$/.test(h.id), '条目 id 不合规：' + h.id);
    assert.ok(h.title && h.title.length >= 4, h.id + ' 缺标题');
    assert.ok(h.year && h.year.length >= 3, h.id + ' 缺年份');
    assert.ok(h.people && h.people.length >= 2, h.id + ' 缺人物');
    assert.ok(h.summary && h.summary.length >= 20, h.id + ' 摘要太短');
    assert.ok(h.detail && h.detail.length >= 80, h.id + ' 正文太短（要能当知识点读）');
    assert.ok(Array.isArray(h.tags) && h.tags.length >= 1, h.id + ' 缺标签');
    assert.ok(ERA_IDS.indexOf(h.era) >= 0, h.id + ' 的时代不存在：' + h.era);
  }
});

test('数学史条目：id 不重复，索引与查询函数一致', () => {
  const ids = HISTORY.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length, '有重复的史话 id');
  for (const id of ids) assert.equal(HISTORY_BY_ID[id].id, id);
  for (const era of HISTORY_ERAS) assert.ok(eraOf(era.id), '时代查不到：' + era.id);
});

test('每一个关卡都至少有一条史话，且引用的关卡都真实存在', () => {
  const missing = [];
  for (const lv of LEVELS) {
    if (!historyForLevel(lv.id).length) missing.push(lv.id);
  }
  assert.deepEqual(missing, [], '这些关卡没有任何数学史条目：' + missing.join('、'));
  for (const h of HISTORY) {
    for (const id of h.levels) {
      assert.ok(LEVEL_IDS.has(id), h.id + ' 引用了不存在的关卡 ' + id);
    }
  }
});

test('没有孤儿条目：每条史话都至少关联一关', () => {
  const orphans = HISTORY.filter((h) => !(h.levels || []).length).map((h) => h.id);
  assert.deepEqual(orphans, [], '这些史话没有关联任何关卡：' + orphans.join('、'));
});

test('按时代分组：每个时代都有条目，且分组不重不漏', () => {
  const groups = historyByEra();
  assert.equal(groups.length, HISTORY_ERAS.length);
  let total = 0;
  for (const g of groups) {
    assert.ok(g.items.length >= 1, '时代「' + g.name + '」没有任何条目');
    total += g.items.length;
  }
  assert.equal(total, HISTORY.length, '按时代分组后条数对不上');
});

test('史话里包含可核对的史实要素（年份、人物、文献）', () => {
  // 抽查几条最关键的：必须写出具体年份或世纪，不能是“很久以前”这类含糊说法
  const mustHaveYear = ['H-EUCLID', 'H-GENTZEN', 'H-FITCH', 'H-BROUWER', 'H-BRUUN', 'H-FOUR-COLOR', 'H-BOOLE', 'H-FREGE'];
  for (const id of mustHaveYear) {
    const h = HISTORY_BY_ID[id];
    assert.ok(h, '缺少关键条目 ' + id);
    assert.ok(/\d/.test(h.year), id + ' 的年份里没有数字：' + h.year);
    assert.ok(/\d{3,4}/.test(h.detail) || /\d{3,4}/.test(h.year), id + ' 正文缺具体年代');
  }
  // 与本项目内核直接相关的两条：自然演绎（根岑）与 de Bruijn 索引
  assert.ok(/根岑/.test(HISTORY_BY_ID['H-GENTZEN'].people), '自然演绎的史话应当归到根岑');
  assert.ok(/德布鲁因|de Bruijn/.test(HISTORY_BY_ID['H-BRUUN'].people), '无名变量的史话应当归到德布鲁因');
  assert.ok(/1972/.test(HISTORY_BY_ID['H-BRUUN'].detail), 'de Bruijn 索引的年份应当是 1972');
});

test('关卡查询返回的条目都真的引用了该关', () => {
  for (const lv of LEVELS) {
    for (const h of historyForLevel(lv.id)) {
      assert.ok(h.levels.indexOf(lv.id) >= 0, h.id + ' 并没有关联 ' + lv.id);
    }
  }
});
