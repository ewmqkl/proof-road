// core/achievements.js —— 成就判定引擎（纯函数）
// 输入是一份“玩家档案”（从存档算出来），输出是每条成就的解锁状态。
// 这里不碰 DOM、不碰 localStorage：界面只负责把事件记成档案，判定全部在这里完成，
// 于是“同一份存档必然得到同一组成就”，测试可以直接构造档案来验证。
import { LEVELS } from '../data/levels.js';
import { HISTORY } from '../data/math-history.js';
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, ACHIEVEMENT_BY_ID, TIER_ORDER } from '../data/achievements.js';

const LEVEL_MAP = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

/* 关卡表里真正出现过的规则 —— “规则全集”成就只要求这些，用不到的规则不算 */
export const PLAYABLE_RULES = [...new Set(LEVELS.flatMap((l) => l.rules || []))].sort();

export const TOTALS = {
  all: LEVELS.length,
  L0: LEVELS.filter((l) => l.tier === 'L0').length,
  L1: LEVELS.filter((l) => l.tier === 'L1').length,
  history: HISTORY.length,
  rules: PLAYABLE_RULES.length,
  achievements: ACHIEVEMENTS.length,
};

const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);

/** 空档案：一关没通、一条史话没读。 */
export function emptyProfile() {
  return buildProfile({});
}

/**
 * 把存档快照整理成判定用的档案。
 * raw = { done:[], stats:{}, rules:{}, flags:{}, history:[] }
 */
export function buildProfile(raw) {
  const src = obj(raw);
  const statsIn = obj(src.stats);
  const rulesIn = obj(src.rules);
  const flagsIn = obj(src.flags);

  const done = arr(src.done).filter((id) => LEVEL_MAP[id]);
  const doneSet = new Set(done);

  const levels = {};
  for (const [id, s] of Object.entries(statsIn)) {
    if (!LEVEL_MAP[id]) continue;
    const st = obj(s);
    const hints = num(st.hints), undos = num(st.undos), errors = num(st.errors);
    levels[id] = {
      plays: num(st.plays),
      steps: num(st.steps),
      bestSteps: num(st.bestSteps),
      hints, undos, errors,
      // 这两个是“首次通关那一刻”盖章的，之后再回来玩不会把已得的成就撤销
      noHint: !!st.noHint || (doneSet.has(id) && hints === 0),
      clean: !!st.clean || (doneSet.has(id) && hints === 0 && undos === 0 && errors === 0),
    };
  }
  // 通了关但没有统计记录的（例如旧存档）：按“零提示零撤销零报错”对待
  for (const id of done) {
    if (!levels[id]) levels[id] = { plays: 1, steps: 0, bestSteps: 0, hints: 0, undos: 0, errors: 0, noHint: true, clean: true };
    levels[id].done = true;
  }

  // 先把“本游戏里出现过的规则”全部铺成 0，这样成就里的 p.rules.xxx 永远是个数字，不会算出 NaN；
  // rulesUsed 只数真正用过（>0）的那些。
  const rules = {};
  const playable = new Set(PLAYABLE_RULES);
  for (const r of PLAYABLE_RULES) rules[r] = 0;
  let rulesUsed = 0;
  for (const [k, v] of Object.entries(rulesIn)) {
    const n = num(v);
    rules[k] = n;                               // 非规则键（assume 等）也留着，便于排查
    if (n > 0 && playable.has(k)) rulesUsed++;
  }

  let hints = 0, undos = 0, errors = 0, steps = 0;
  for (const s of Object.values(levels)) {
    hints += s.hints; undos += s.undos; errors += s.errors; steps += s.steps;
  }

  const l0Done = done.filter((id) => LEVEL_MAP[id].tier === 'L0');
  const l1Done = done.filter((id) => LEVEL_MAP[id].tier === 'L1');
  const readHistory = arr(src.history).filter((id) => HISTORY.some((h) => h.id === id));

  return {
    done,
    levels,
    solvedCount: done.length,
    l0Solved: l0Done.length,
    l1Solved: l1Done.length,
    l0Total: TOTALS.L0,
    l1Total: TOTALS.L1,
    totalLevels: TOTALS.all,
    noHintLevels: Object.entries(levels).filter(([id, s]) => doneSet.has(id) && s.noHint).length,
    cleanLevels: Object.entries(levels).filter(([id, s]) => doneSet.has(id) && s.clean).length,
    l0NoHint: Object.entries(levels).filter(([id, s]) => doneSet.has(id) && s.noHint && LEVEL_MAP[id].tier === 'L0').length,
    hints, undos, errors, steps, levelsTouched: Object.keys(levels).length,
    rules, rulesUsed,
    playableRules: TOTALS.rules,
    maxScopeDepth: num(flagsIn.maxScopeDepth),
    instantiate: num(flagsIn.instantiate),
    guideSkipped: num(flagsIn.guideSkipped),
    guideCompleted: num(flagsIn.guideCompleted),
    readHistory,
    historyRead: readHistory.length,
    historyTotal: TOTALS.history,
  };
}

/** 逐条判定：返回带解锁状态与进度的小卡片数据（不含函数，可安全交给界面）。 */
export function evaluateAchievements(profile) {
  const p = profile && profile.levels ? profile : buildProfile(profile);
  return ACHIEVEMENTS.map((a) => {
    let unlocked = false, cur = 0, max = 1;
    try { unlocked = !!a.check(p); } catch (e) { unlocked = false; }
    try {
      const pr = a.progress ? a.progress(p) : [unlocked ? 1 : 0, 1];
      cur = pr[0]; max = pr[1];
    } catch (e) { cur = unlocked ? 1 : 0; max = 1; }
    // 进度函数写错时不要让 NaN 漏进界面（进度条会算不出宽度，排序也会乱）
    if (typeof cur !== 'number' || !isFinite(cur)) cur = unlocked ? 1 : 0;
    if (typeof max !== 'number' || !isFinite(max) || max <= 0) max = 1;
    cur = Math.max(0, Math.min(cur, max));
    return {
      id: a.id, name: a.name, desc: a.desc, icon: a.icon, tier: a.tier,
      group: a.group, history: a.history || null,
      unlocked, cur, max, ratio: cur / max,
    };
  });
}

export function unlockedIds(profile) {
  return evaluateAchievements(profile).filter((a) => a.unlocked).map((a) => a.id);
}

/** 比较两次判定，挑出“这次新解锁”的成就（界面用它弹提示）。 */
export function newlyUnlocked(beforeIds, after) {
  const before = new Set(arr(beforeIds));
  return (after || []).filter((a) => a.unlocked && !before.has(a.id));
}

/** 概览：总数、按组、按稀有度。 */
export function achievementSummary(profile) {
  const list = evaluateAchievements(profile);
  const byGroup = ACHIEVEMENT_GROUPS.map((g) => {
    const items = list.filter((a) => a.group === g.id);
    return { ...g, total: items.length, unlocked: items.filter((a) => a.unlocked).length };
  });
  const byTier = TIER_ORDER.map((t) => {
    const items = list.filter((a) => a.tier === t);
    return { tier: t, total: items.length, unlocked: items.filter((a) => a.unlocked).length };
  });
  return {
    total: list.length,
    unlocked: list.filter((a) => a.unlocked).length,
    byGroup, byTier, list,
  };
}

/** 最接近解锁的几条（档案室侧栏用）：按完成度倒序，同分时优先低稀有度。 */
export function closestLocked(profile, n = 4) {
  const list = evaluateAchievements(profile).filter((a) => !a.unlocked);
  return list
    .slice()
    .sort((x, y) => (y.ratio - x.ratio) || (TIER_ORDER.indexOf(x.tier) - TIER_ORDER.indexOf(y.tier)))
    .slice(0, n);
}

export { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, ACHIEVEMENT_BY_ID, TIER_ORDER };
