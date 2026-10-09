// tests/achievements.test.mjs —— 成就系统的判定引擎
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, ACHIEVEMENT_BY_ID, TIER_ORDER, TIER_NAME } from '../src/data/achievements.js';
import {
  buildProfile, emptyProfile, evaluateAchievements, unlockedIds, newlyUnlocked,
  achievementSummary, closestLocked, PLAYABLE_RULES, TOTALS,
} from '../src/core/achievements.js';
import { LEVELS } from '../src/data/levels.js';
import { HISTORY } from '../src/data/math-history.js';
import { RULES } from '../src/core/rules.js';

const GROUP_IDS = ACHIEVEMENT_GROUPS.map((g) => g.id);

/* 造一份“全部通关、全部规则用过、全部史话读过”的存档。
   其中两处看起来矛盾的地方其实是并行不悖的：
   · noHint / clean 是“首次通关那一刻”盖章的，报错与提示次数是累计的——
     玩家某一关先推错、或用过提示，之后重玩时干净地通关，正是这样的数据；
   · L1-12 是留着“用过提示与撤销”的那一关（它是公认最需要提示的一关），
     其余关卡保持零提示零撤销，于是“L0 全部零提示”与“用过提示”两条成就都能拿到。 */
function perfectRaw() {
  const stats = {};
  for (const lv of LEVELS) stats[lv.id] = { plays: 2, steps: 8, bestSteps: 5, hints: 0, undos: 0, errors: 1, noHint: true, clean: true };
  stats['L1-12'] = { plays: 3, steps: 20, bestSteps: 12, hints: 2, undos: 3, errors: 2, noHint: false, clean: false };
  const rules = {};
  for (const r of PLAYABLE_RULES) rules[r] = 3;
  return {
    done: LEVELS.map((l) => l.id),
    stats, rules,
    flags: { maxScopeDepth: 3, instantiate: 1, guideSkipped: 1, guideCompleted: 5 },
    history: HISTORY.map((h) => h.id),
  };
}

test('成就表：字段齐全、id 唯一、分组与稀有度合法', () => {
  assert.ok(ACHIEVEMENTS.length >= 25, '成就太少：' + ACHIEVEMENTS.length);
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, '有重复的成就 id');
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.name && a.name.length >= 3, a.id + ' 缺名称');
    assert.ok(a.desc && a.desc.length >= 6, a.id + ' 缺解锁说明');
    assert.ok(a.icon, a.id + ' 缺图标字符');
    assert.ok(GROUP_IDS.indexOf(a.group) >= 0, a.id + ' 的分组不存在：' + a.group);
    assert.ok(TIER_ORDER.indexOf(a.tier) >= 0, a.id + ' 的稀有度不存在：' + a.tier);
    assert.ok(TIER_NAME[a.tier], a.id + ' 的稀有度缺中文名');
    assert.equal(typeof a.check, 'function', a.id + ' 缺判定函数');
    assert.equal(typeof a.progress, 'function', a.id + ' 缺进度函数');
    assert.equal(ACHIEVEMENT_BY_ID[a.id].id, a.id);
  }
});

test('成就引用的数学史条目都真实存在', () => {
  const ids = new Set(HISTORY.map((h) => h.id));
  for (const a of ACHIEVEMENTS) {
    if (!a.history) continue;
    assert.ok(ids.has(a.history), a.id + ' 引用了不存在的史话 ' + a.history);
  }
});

test('关卡表里出现的规则都在规则引擎里存在（“规则全集”成就才有意义）', () => {
  assert.ok(PLAYABLE_RULES.length >= 15, '可用规则种类偏少：' + PLAYABLE_RULES.length);
  for (const r of PLAYABLE_RULES) assert.ok(RULES[r], '关卡表里的规则不存在：' + r);
  // “规则全集”按“真的在某一关露过面”的规则计数：内核里备着但关卡没用上的规则
  // （存在引入 ∃I、两边同加一个式子）不算在内，否则这个成就永远拿不到。
  const unused = Object.keys(RULES).filter((r) => PLAYABLE_RULES.indexOf(r) < 0);
  console.log('   未在任何关卡露面的规则（不计入规则全集）：' + (unused.join('、') || '无'));
  assert.ok(unused.length <= 3, '太多规则从未露面，关卡表可能漏了规则：' + unused.join('、'));
});

test('空档案：一条成就都不该解锁', () => {
  const p = emptyProfile();
  const list = evaluateAchievements(p);
  assert.equal(list.length, ACHIEVEMENTS.length);
  assert.equal(list.filter((a) => a.unlocked).length, 0, '空档案竟然解锁了成就');
  assert.deepEqual(unlockedIds(p), []);
  // 进度条也要是合法的
  for (const a of list) {
    assert.ok(a.cur >= 0 && a.max >= 1, a.id + ' 的进度不合法：' + a.cur + '/' + a.max);
    assert.ok(a.ratio >= 0 && a.ratio <= 1, a.id + ' 的完成度越界：' + a.ratio);
    assert.equal(a.unlocked, false, a.id + ' 不该解锁');
  }
});

test('完整档案：全部成就都能解锁', () => {
  const list = evaluateAchievements(buildProfile(perfectRaw()));
  const locked = list.filter((a) => !a.unlocked).map((a) => a.id);
  assert.deepEqual(locked, [], '这些成就在完整档案下仍然锁着：' + locked.join('、'));
});

test('档案统计：通关数、层级数、零提示与一气呵成的口径', () => {
  const raw = {
    done: ['L0-01', 'L0-02', 'L1-01'],
    stats: {
      'L0-01': { plays: 1, steps: 1, hints: 0, undos: 0, errors: 0, noHint: true, clean: true },
      'L0-02': { plays: 1, steps: 3, hints: 1, undos: 0, errors: 0 },
      'L1-01': { plays: 1, steps: 1, hints: 0, undos: 1, errors: 2 },
    },
    rules: { hyp: 1, impI: 1, eqSym: 1 },
    flags: { maxScopeDepth: 2 },
    history: ['H-EUCLID'],
  };
  const p = buildProfile(raw);
  assert.equal(p.solvedCount, 3);
  assert.equal(p.l0Solved, 2);
  assert.equal(p.l1Solved, 1);
  assert.equal(p.l0Total, TOTALS.L0);
  assert.equal(p.totalLevels, LEVELS.length);
  assert.equal(p.noHintLevels, 2, 'L0-01 与 L1-01 都没点过提示');
  assert.equal(p.cleanLevels, 1, '只有 L0-01 是零提示零撤销零报错');
  assert.equal(p.hints, 1);
  assert.equal(p.undos, 1);
  assert.equal(p.errors, 2);
  assert.equal(p.steps, 5);
  assert.equal(p.rulesUsed, 3);
  assert.equal(p.maxScopeDepth, 2);
  assert.equal(p.historyRead, 1);
});

test('非规则键（如 assume）不计入“用过规则种类”', () => {
  const p = buildProfile({ rules: { hyp: 2, assume: 9, premise: 1, bogus: 1, impI: 0 } });
  assert.equal(p.rulesUsed, 1, '只有 hyp 该被算进去');
  assert.equal(p.rules.assume, 9, '原始计数仍然保留');
});

test('规则类成就会随着规则使用解锁', () => {
  const base = buildProfile({ done: ['L0-03'] });
  assert.equal(evaluateAchievements(base).find((a) => a.id === 'a-impE').unlocked, false);
  const withRule = buildProfile({ done: ['L0-03'], rules: { impE: 1 } });
  assert.equal(evaluateAchievements(withRule).find((a) => a.id === 'a-impE').unlocked, true);
});

test('数学史类成就要同时满足“读过”与“通关”两个条件', () => {
  const onlyRead = evaluateAchievements(buildProfile({ history: ['H-EUCLID'] })).find((a) => a.id === 'a-euclid');
  assert.equal(onlyRead.unlocked, false, '只读史话不该解锁');
  assert.equal(onlyRead.cur, 1);
  assert.equal(onlyRead.max, 2);
  const onlySolved = evaluateAchievements(buildProfile({ done: ['L0-01'] })).find((a) => a.id === 'a-euclid');
  assert.equal(onlySolved.unlocked, false, '只通关不该解锁');
  const both = evaluateAchievements(buildProfile({ done: ['L0-01'], history: ['H-EUCLID'] })).find((a) => a.id === 'a-euclid');
  assert.equal(both.unlocked, true, '两个条件都满足就该解锁');
  assert.equal(both.ratio, 1);
});

test('成就只增不减：档案变大时已解锁的不会丢', () => {
  const steps = [
    {},
    { done: ['L0-01'] },
    { done: ['L0-01'], stats: { 'L0-01': { steps: 1, hints: 0, undos: 0, errors: 0 } } },
    { done: ['L0-01', 'L0-02'], rules: { hyp: 1 } },
    { done: ['L0-01', 'L0-02'], rules: { hyp: 1, impI: 1 }, history: ['H-EUCLID'] },
    perfectRaw(),
  ];
  let prev = new Set();
  for (const raw of steps) {
    const now = new Set(unlockedIds(buildProfile(raw)));
    for (const id of prev) assert.ok(now.has(id), '档案变大后成就反而丢了：' + id);
    prev = now;
  }
  assert.ok(prev.size >= 25, '完整档案下解锁数偏少：' + prev.size);
});

test('新解锁的比对：只报这一次新增的', () => {
  const before = unlockedIds(buildProfile({ done: ['L0-01'] }));
  const after = evaluateAchievements(buildProfile({ done: ['L0-01'], rules: { impE: 1 } }));
  const news = newlyUnlocked(before, after);
  assert.ok(news.length >= 1, '应当报出新解锁的成就');
  assert.ok(news.every((a) => a.unlocked), '报出来的必须都是已解锁的');
  assert.ok(news.some((a) => a.id === 'a-impE'), '应当包含刚用过的 →E 成就');
  assert.ok(!news.some((a) => before.indexOf(a.id) >= 0), '不能重复报旧成就');
});

test('概览：分组与稀有度的数量自洽', () => {
  const sum = achievementSummary(buildProfile(perfectRaw()));
  assert.equal(sum.total, ACHIEVEMENTS.length);
  assert.equal(sum.unlocked, ACHIEVEMENTS.length);
  assert.equal(sum.byGroup.reduce((n, g) => n + g.total, 0), ACHIEVEMENTS.length);
  assert.equal(sum.byTier.reduce((n, t) => n + t.total, 0), ACHIEVEMENTS.length);
  for (const g of sum.byGroup) assert.ok(g.total >= 1, '分组「' + g.name + '」里没有成就');
  assert.ok(sum.byTier.every((t) => t.total >= 1), '每个稀有度都该有成就');
});

test('最接近解锁：只给未解锁的，并按完成度倒序', () => {
  const up = closestLocked(buildProfile({ done: ['L0-01'], rules: { impE: 1 } }), 5);
  assert.ok(up.length >= 1 && up.length <= 5);
  assert.ok(up.every((a) => !a.unlocked));
  for (let i = 1; i < up.length; i++) assert.ok(up[i - 1].ratio >= up[i].ratio, '没有按完成度倒序');
});

test('旧存档兼容：只有 lpg.done、没有统计时也能算档案', () => {
  const p = buildProfile({ done: ['L0-01', 'L0-02'] });
  assert.equal(p.solvedCount, 2);
  assert.equal(p.noHintLevels, 2, '老存档按零提示对待');
  assert.equal(p.cleanLevels, 2, '老存档按一气呵成对待');
  assert.equal(p.hints, 0);
});

test('脏数据不会让判定崩掉', () => {
  const p = buildProfile({ done: ['不存在的关卡', 42, null], stats: { 'L0-01': 'x' }, rules: { hyp: -3, impE: 'a' }, flags: null, history: ['H-NOPE'] });
  assert.deepEqual(p.done, [], '非法关卡 id 应当被过滤');
  assert.equal(p.rulesUsed, 0, '负数与非数字都该被忽略');
  assert.equal(p.historyRead, 0);
  const list = evaluateAchievements(p);
  assert.equal(list.filter((a) => a.unlocked).length, 0);
  assert.doesNotThrow(() => evaluateAchievements(null));
  assert.doesNotThrow(() => achievementSummary(undefined));
});
