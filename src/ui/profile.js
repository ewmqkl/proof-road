// ui/profile.js —— 玩家档案：进度、统计、成就、史话阅读、引导偏好
// 所有存档都落在 localStorage，键名统一以 lpg. 开头：
//   lpg.done     已通关的关卡 id（沿用旧版格式，保证老存档继续有效）
//   lpg.stats    每关的统计：落子数、提示/撤销/报错次数、是否零提示、是否一气呵成
//   lpg.rules    每条规则累计被用过多少次
//   lpg.flags    零散标记：最大子证明层数、展开公理次数、引导相关计数
//   lpg.ach      已解锁的成就 id
//   lpg.history  已读过的数学史条目 id
//   lpg.guide    引导偏好：是否整体关闭、全景导览是否看过、哪些关跳过/看完过
//
// localStorage 在 file:// 或隐私模式下可能直接抛异常，所以每个读写都包了 try/catch：
// 失败时最坏的结果只是“这一次不记进度”，绝不打断游戏。
import { buildProfile, evaluateAchievements, newlyUnlocked, achievementSummary, closestLocked } from '../core/achievements.js';
import {
  SLOT_COUNT, normalizeProgress, normalizeAutoSave, emptyAutoSave,
  withScene, sceneForLevel, parseSave,
} from '../core/savefile.js';

export const KEYS = {
  done: 'lpg.done',
  stats: 'lpg.stats',
  rules: 'lpg.rules',
  flags: 'lpg.flags',
  ach: 'lpg.ach',
  history: 'lpg.history',
  guide: 'lpg.guide',
  auto: 'lpg.save.auto',      // 自动存档：逐关的证明现场
  slots: 'lpg.save.slots',    // 手动存档槽位
};

/* 重置进度时会清掉的键。
   手动存档槽**故意不在其中**：那是玩家的备份，不该被“重置进度”顺手删掉。 */
const RESETTABLE = ['done', 'stats', 'rules', 'flags', 'ach', 'history', 'guide', 'auto'];

function readRaw(key, fallback) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return fallback;
    const v = localStorage.getItem(key);
    if (v === null || v === undefined) return fallback;
    const parsed = JSON.parse(v);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) { return fallback; }
}
function writeRaw(key, value) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) { return false; }
}
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/* ---------------- 读取 ---------------- */
export function readDone() {
  const d = readRaw(KEYS.done, []);
  return Array.isArray(d) ? d.filter((x) => typeof x === 'string') : [];
}
export function readStats() {
  const s = readRaw(KEYS.stats, {});
  return isObj(s) ? s : {};
}
export function readRules() {
  const r = readRaw(KEYS.rules, {});
  return isObj(r) ? r : {};
}
export function readFlags() {
  const f = readRaw(KEYS.flags, {});
  return isObj(f) ? f : {};
}
export function readAchievements() {
  const a = readRaw(KEYS.ach, []);
  return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
}
export function readHistory() {
  const h = readRaw(KEYS.history, []);
  return Array.isArray(h) ? h.filter((x) => typeof x === 'string') : [];
}
export function readGuidePrefs() {
  const g = readRaw(KEYS.guide, {});
  const base = isObj(g) ? g : {};
  return {
    off: !!base.off,
    tour: !!base.tour,
    skipped: Array.isArray(base.skipped) ? base.skipped : [],
    done: Array.isArray(base.done) ? base.done : [],
  };
}

/* ---------------- 底层写入 ---------------- */
function statsFor(id) {
  const all = readStats();
  const s = isObj(all[id]) ? all[id] : {};
  const merged = {
    plays: Number(s.plays) || 0,
    steps: Number(s.steps) || 0,
    bestSteps: Number(s.bestSteps) || 0,
    hints: Number(s.hints) || 0, undos: Number(s.undos) || 0, errors: Number(s.errors) || 0,
    attSteps: Number(s.attSteps) || 0, attHints: Number(s.attHints) || 0,
    attUndos: Number(s.attUndos) || 0, attErrors: Number(s.attErrors) || 0,
    noHint: !!s.noHint, clean: !!s.clean,
  };
  return { all, merged };
}
function saveStats(id, all, merged) {
  all[id] = merged;
  writeRaw(KEYS.stats, all);
}
function bumpFlag(name, by = 1) {
  const f = readFlags();
  f[name] = (Number(f[name]) || 0) + by;
  writeRaw(KEYS.flags, f);
  return f[name];
}
function setFlag(name, value) {
  const f = readFlags();
  f[name] = value;
  writeRaw(KEYS.flags, f);
}

/* ---------------- 事件记录 ---------------- */
export function notePlay(id) {
  const { all, merged } = statsFor(id);
  merged.plays += 1;
  merged.attSteps = 0; merged.attHints = 0; merged.attUndos = 0; merged.attErrors = 0;
  merged.at = Date.now();
  saveStats(id, all, merged);
}

/** 从自动存档接着推：算一次新尝试，但**不清空本次尝试的计数**——
    否则刷新一次页面就能把“用过提示 / 撤销 / 报错”洗掉，零提示成就就失去意义了。 */
export function noteResume(id) {
  const { all, merged } = statsFor(id);
  merged.plays += 1;
  merged.at = Date.now();
  saveStats(id, all, merged);
}

export function noteStep(id, ruleId) {
  const { all, merged } = statsFor(id);
  merged.steps += 1;
  merged.attSteps += 1;
  saveStats(id, all, merged);
  if (ruleId) {
    const r = readRules();
    r[ruleId] = (Number(r[ruleId]) || 0) + 1;
    writeRaw(KEYS.rules, r);
  }
}

export function noteHint(id) {
  const { all, merged } = statsFor(id);
  merged.hints += 1; merged.attHints += 1;
  saveStats(id, all, merged);
}
export function noteUndo(id) {
  const { all, merged } = statsFor(id);
  merged.undos += 1; merged.attUndos += 1;
  saveStats(id, all, merged);
}
export function noteError(id) {
  const { all, merged } = statsFor(id);
  merged.errors += 1; merged.attErrors += 1;
  saveStats(id, all, merged);
}
export function noteInstantiate() { return bumpFlag('instantiate'); }
export function noteScopeDepth(depth) {
  const f = readFlags();
  const cur = Number(f.maxScopeDepth) || 0;
  if (depth > cur) { f.maxScopeDepth = depth; writeRaw(KEYS.flags, f); }
  return Math.max(cur, depth);
}

/** 通关：盖章 noHint / clean，并写进度。返回是否“首次通关”。 */
export function markLevelSolved(id) {
  const { all, merged } = statsFor(id);
  const compSteps = merged.attSteps;
  if (!merged.bestSteps || (compSteps > 0 && compSteps < merged.bestSteps)) merged.bestSteps = compSteps;
  if (merged.attHints === 0) merged.noHint = true;
  if (merged.attHints === 0 && merged.attUndos === 0 && merged.attErrors === 0) merged.clean = true;
  saveStats(id, all, merged);

  const done = readDone();
  const first = done.indexOf(id) < 0;
  if (first) { done.push(id); writeRaw(KEYS.done, done); }
  return first;
}

export function markHistoryRead(id) {
  const list = readHistory();
  if (list.indexOf(id) >= 0) return false;
  list.push(id);
  writeRaw(KEYS.history, list);
  return true;
}
export function markHistoriesRead(ids) {
  let n = 0;
  for (const id of ids || []) if (markHistoryRead(id)) n++;
  return n;
}

/* ---------------- 引导偏好 ---------------- */
export function setGuideOff(off) {
  const g = readGuidePrefs();
  g.off = !!off;
  writeRaw(KEYS.guide, g);
  return g;
}
export function setGuideTourSeen() {
  const g = readGuidePrefs();
  g.tour = true;
  writeRaw(KEYS.guide, g);
}
export function markGuideSkipped(id) {
  const g = readGuidePrefs();
  if (g.skipped.indexOf(id) >= 0) return false;     // 同一关重复跳过只记一次
  g.skipped.push(id);
  writeRaw(KEYS.guide, g);
  bumpFlag('guideSkipped');
  return true;
}
export function markGuideDone(id) {
  const g = readGuidePrefs();
  if (g.done.indexOf(id) < 0) g.done.push(id);
  writeRaw(KEYS.guide, g);
  bumpFlag('guideCompleted');
}
export function guideNeeded(id) {
  const g = readGuidePrefs();
  if (g.off) return false;
  if (g.done.indexOf(id) >= 0) return false;
  if (g.skipped.indexOf(id) >= 0) return false;
  return true;
}

/* ---------------- 档案与成就 ---------------- */
export function snapshot() {
  return {
    done: readDone(),
    stats: readStats(),
    rules: readRules(),
    flags: readFlags(),
    history: readHistory(),
  };
}
/** 完整进度快照：存档要用的是这一份（比 snapshot 多成就与引导偏好）。 */
export function snapshotAll() {
  return {
    done: readDone(),
    stats: readStats(),
    rules: readRules(),
    flags: readFlags(),
    history: readHistory(),
    ach: readAchievements(),
    guide: readGuidePrefs(),
  };
}
/** 用一份进度覆盖当前存档（读档 / 导入存档时用）。 */
export function applyProgress(progress) {
  const p = normalizeProgress(progress);
  writeRaw(KEYS.done, p.done);
  writeRaw(KEYS.stats, p.stats);
  writeRaw(KEYS.rules, p.rules);
  writeRaw(KEYS.flags, p.flags);
  writeRaw(KEYS.history, p.history);
  writeRaw(KEYS.ach, p.ach);
  writeRaw(KEYS.guide, p.guide);
  return p;
}
export function profile() { return buildProfile(snapshot()); }
export function achievements() { return evaluateAchievements(profile()); }
export function summary() { return achievementSummary(profile()); }
export function upcoming(n = 4) { return closestLocked(profile(), n); }

/** 重新判定成就，并返回“这一次新解锁”的列表（界面据此弹提示）。 */
export function syncAchievements() {
  const list = achievements();
  const before = readAchievements();
  const news = newlyUnlocked(before, list);
  if (news.length) {
    const keep = list.filter((a) => a.unlocked).map((a) => a.id);
    writeRaw(KEYS.ach, keep);
  }
  return news;
}

/* ---------------- 自动存档（逐关现场） ---------------- */
export function readAutoSave() { return normalizeAutoSave(readRaw(KEYS.auto, {})); }
export function writeAutoSave(auto) { writeRaw(KEYS.auto, auto); return auto; }
export function clearAutoSave() { writeRaw(KEYS.auto, emptyAutoSave()); }

/** 记下某一关的现场：传 null 表示这一关已完成/已清空。 */
export function noteScene(levelId, scene) {
  const next = withScene(readAutoSave(), levelId, scene);
  writeRaw(KEYS.auto, next);
  return next;
}
export function autoScene(levelId) { return sceneForLevel(readAutoSave(), levelId); }

/* ---------------- 手动存档槽 ---------------- */
export function readSlots() {
  const raw = readRaw(KEYS.slots, []);
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = Array.isArray(raw) ? raw[i] : null;
    const parsed = s ? parseSave(s) : null;
    out.push(parsed && parsed.ok ? parsed.save : null);
  }
  return out;
}
export function readSlot(i) { return readSlots()[i] || null; }
export function writeSlot(i, save) {
  if (!(i >= 0 && i < SLOT_COUNT) || !save) return false;
  const slots = readSlots();
  slots[i] = save;
  writeRaw(KEYS.slots, slots);
  return true;
}
export function clearSlot(i) {
  if (!(i >= 0 && i < SLOT_COUNT)) return false;
  const slots = readSlots();
  slots[i] = null;
  writeRaw(KEYS.slots, slots);
  return true;
}

/* ---------------- 重置 ---------------- */
/** 清空进度、统计、成就、史话阅读与自动存档；手动存档槽保留（见 RESETTABLE 的说明）。 */
export function resetAll() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      for (const name of RESETTABLE) localStorage.removeItem(KEYS[name]);
      return true;
    }
  } catch (e) { /* 忽略 */ }
  return false;
}
