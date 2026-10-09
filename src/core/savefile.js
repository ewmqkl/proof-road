// core/savefile.js —— 存档：证明现场的序列化、校验与还原
//
// 这里只管“一份存档长什么样、能不能读回来”，不碰 localStorage、不碰 DOM：
//   · 现场（scene）= 某一关的证明状态（事实表、子证明作用域、编号计数）
//   · 进度（progress）= 通关记录、统计、规则使用、成就、史话阅读、引导偏好
//   一份完整存档 = 进度 + 现场（现场可以没有，那就是“只存进度”）。
//
// 校验是这一层的核心职责：导入的存档来自别处（别的版本、别人改过的文件），
// 所以每个字段都要过一遍类型检查，坏数据一律降级成空值，绝不让它污染存档。
import { fkey } from './logic.js';

export const SAVE_FORMAT = 'proof-road-save';
export const SAVE_VERSION = 1;
export const SLOT_COUNT = 3;

/* 事实里要存哪些字段：given 是题设/公理，其余是玩家推出来的 */
const FACT_FIELDS = ['id', 'f', 'rule', 'from', 'scope', 'given', 'src', 'terms', 'label'];

const num = (v, d) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : d);
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v) => (isObj(v) ? v : {});
const strList = (v) => [...new Set(arr(v).filter((x) => typeof x === 'string' && x))];

/* ---------------- 证明现场 ---------------- */

function compactFact(f) {
  const out = {};
  for (const k of FACT_FIELDS) {
    if (f[k] !== undefined && f[k] !== null) out[k] = f[k];
  }
  // 公理只留展示需要的部分：公式本身已经在 f 里，存两份纯属浪费
  if (f.ax && typeof f.ax === 'object') {
    out.ax = { id: f.ax.id, note: f.ax.note, set: f.ax.set, title: f.ax.title, src: f.ax.src };
  }
  return out;
}

function expandFact(o) {
  const f = { ...o };
  if (!Array.isArray(f.from)) f.from = [];
  if (f.scope === undefined) f.scope = null;
  return f;
}

/** 从证明状态里取出“现场”。返回 null 表示没有可存的现场。 */
export function sceneFromState(state) {
  if (!state || !state.level) return null;
  return {
    levelId: state.level.id,
    facts: (state.facts || []).map(compactFact),
    nextId: num(state.nextId, 1),
    assumeCount: num(state.assumeCount, 0),
    assumptions: obj(state.assumptions),
    scopeStack: arr(state.scopeStack).filter((x) => typeof x === 'string'),
    closedScopes: arr(state.closedScopes).filter((x) => typeof x === 'string'),
  };
}

/** 现场校验：把来路不明的现场收拾成安全形状（不保证与关卡一致）。 */
export function normalizeScene(raw) {
  if (!isObj(raw) || !Array.isArray(raw.facts)) return null;
  const facts = raw.facts.filter(isObj).map(expandFact);
  if (!facts.length) return null;
  return {
    levelId: typeof raw.levelId === 'string' ? raw.levelId : null,
    facts,
    nextId: num(raw.nextId, facts.length + 1),
    assumeCount: num(raw.assumeCount, 0),
    assumptions: obj(raw.assumptions),
    scopeStack: arr(raw.scopeStack).filter((x) => typeof x === 'string'),
    closedScopes: arr(raw.closedScopes).filter((x) => typeof x === 'string'),
  };
}

/** 现场里“玩家推出来的步数”（题设与公理不算）。 */
export function sceneStepCount(scene) {
  if (!scene || !Array.isArray(scene.facts)) return 0;
  return scene.facts.filter((f) => !f.given).length;
}

/** 只有题设与公理的现场等于没推过，不必留着。 */
export function sceneIsEmpty(scene) { return sceneStepCount(scene) === 0; }

/**
 * 把现场装回一个**刚创建的空状态**上。
 * 关键一步是核对题设/公理：如果关卡数据变过（存档来自旧版本），
 * 直接装回去会得到一关“题设对不上”的诡异局面，所以宁可拒绝并说明原因。
 */
export function applyScene(state, scene, opts = {}) {
  if (!state || !state.level) return { ok: false, error: '没有打开任何关卡' };
  const s = normalizeScene(scene);
  if (!s) return { ok: false, error: '存档里的证明现场不完整' };
  if (s.levelId && s.levelId !== state.level.id) {
    return { ok: false, error: '这份现场属于 ' + s.levelId + '，不是当前这一关' };
  }
  if (opts.checkGivens !== false) {
    const want = (state.facts || []).filter((f) => f.given).map((f) => fkey(f.f));
    const got = s.facts.filter((f) => f.given).map((f) => fkey(f.f));
    if (want.length !== got.length || want.some((k, i) => k !== got[i])) {
      return { ok: false, error: '这一关的题设/公理与存档时不一致（关卡数据变过），现场已丢弃，通关进度不受影响' };
    }
  }
  state.facts = s.facts.map(expandFact);
  state.nextId = s.nextId;
  state.assumeCount = s.assumeCount;
  state.assumptions = { ...s.assumptions };
  // 假设表里已经不存在的子证明不能留在栈上，否则界面会画出一个空的作用域
  state.scopeStack = s.scopeStack.filter((id) => state.assumptions[id] !== undefined);
  state.closedScopes = s.closedScopes.slice();
  return { ok: true, steps: sceneStepCount(s) };
}

/* ---------------- 进度 ---------------- */

export function emptyProgress() {
  return { done: [], stats: {}, rules: {}, flags: {}, history: [], ach: [], guide: {} };
}

/** 进度字段逐个过类型检查：导入的存档可能被手改过或来自旧版本。 */
export function normalizeProgress(raw) {
  const p = obj(raw);
  return {
    done: strList(p.done),
    stats: obj(p.stats),
    rules: obj(p.rules),
    flags: obj(p.flags),
    history: strList(p.history),
    ach: strList(p.ach),
    guide: obj(p.guide),
  };
}

/* ---------------- 存档本体 ---------------- */

export function makeSave(input = {}) {
  const scene = input.scene ? normalizeScene(input.scene) : null;
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: Date.now(),
    name: String(input.name || '').slice(0, 40),
    app: String(input.app || ''),
    lastLevel: input.lastLevel || (scene && scene.levelId) || null,
    progress: normalizeProgress(input.progress),
    scene,
  };
}

/* 旧版本存档在这里升级；目前只有 v1，留好位置。 */
function migrate(raw, fromVersion) {
  const out = { ...raw };
  void fromVersion;
  return out;
}

/** 解析一份存档：字符串或对象都行。永远返回 {ok} 而不是抛异常。 */
export function parseSave(input) {
  let raw = input;
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return { ok: false, error: '存档内容是空的' };
    try { raw = JSON.parse(text); }
    catch (e) { return { ok: false, error: '这段文本不是合法的 JSON：' + (e && e.message ? e.message : e) }; }
  }
  if (!isObj(raw)) return { ok: false, error: '存档必须是一个 JSON 对象' };
  if (raw.format !== SAVE_FORMAT) {
    return { ok: false, error: '这不是《证明之路》的存档（缺少 format 标记）' };
  }
  const version = num(raw.version, 0);
  if (version > SAVE_VERSION) {
    return { ok: false, error: '存档来自更新的版本（v' + version + '），当前只认到 v' + SAVE_VERSION };
  }
  const migrated = migrate(raw, version);
  const progress = normalizeProgress(migrated.progress);
  const scene = migrated.scene ? normalizeScene(migrated.scene) : null;
  if (migrated.scene && !scene) {
    return { ok: false, error: '存档里的证明现场是坏的（facts 为空或不是数组）' };
  }
  return {
    ok: true,
    save: {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      savedAt: num(migrated.savedAt, Date.now()),
      name: String(migrated.name || '').slice(0, 40),
      app: String(migrated.app || ''),
      lastLevel: typeof migrated.lastLevel === 'string' ? migrated.lastLevel : (scene ? scene.levelId : null),
      progress,
      scene,
    },
  };
}

/** 存档摘要：界面与文件名都用它，免得各处自己数。 */
export function describeSave(save) {
  const s = isObj(save) ? save : {};
  const p = normalizeProgress(s.progress);
  const scene = s.scene ? normalizeScene(s.scene) : null;
  return {
    name: String(s.name || ''),
    savedAt: num(s.savedAt, 0),
    when: formatWhen(num(s.savedAt, 0)),
    version: num(s.version, 0),
    levelId: scene ? scene.levelId : (typeof s.lastLevel === 'string' ? s.lastLevel : null),
    steps: sceneStepCount(scene),
    hasScene: !!scene && !sceneIsEmpty(scene),
    solved: p.done.length,
    ach: p.ach.length,
    history: p.history.length,
  };
}

/** 时间戳 → “2026-10-09 18:40”（本地时间，不依赖 toLocaleString 的实现差异）。 */
export function formatWhen(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/** 导出的文件名：去掉文件系统不喜欢的字符。 */
export function saveFileName(save) {
  const d = describeSave(save);
  const stamp = d.savedAt ? formatWhen(d.savedAt).replace(/[-: ]/g, '') : 'save';
  const extra = d.levelId ? '-' + d.levelId : '';
  return 'proof-road' + extra + '-' + stamp + '.json';
}

/** 一份存档里“有没有值得存的东西”。 */
export function saveIsEmpty(save) {
  const d = describeSave(save);
  return d.solved === 0 && d.ach === 0 && d.history === 0 && !d.hasScene;
}

/** 导出成文本（给人看也给人复制，所以带缩进）。 */
export function exportSaveText(save) { return JSON.stringify(save, null, 2); }

/* ---------------- 自动存档：逐关保存现场 ---------------- */
//
// 存的是“每一关各推到哪儿了”，而不是只有最后打开的那一关：
// 玩家在关卡索引里东看西看，不该把别的关推到一半的现场弄丢。

export function emptyAutoSave() {
  return { version: SAVE_VERSION, at: 0, lastLevel: null, scenes: {} };
}

export function normalizeAutoSave(raw) {
  const a = obj(raw);
  const scenes = {};
  for (const [id, scene] of Object.entries(obj(a.scenes))) {
    const s = normalizeScene(scene);
    if (s) scenes[id] = { ...s, levelId: id };
  }
  return {
    version: num(a.version, SAVE_VERSION),
    at: num(a.at, 0),
    lastLevel: typeof a.lastLevel === 'string' ? a.lastLevel : null,
    scenes,
  };
}

/** 写入/覆盖某一关的现场；传 null 表示清掉这一关现场。 */
export function withScene(auto, levelId, scene) {
  const a = normalizeAutoSave(auto);
  const scenes = { ...a.scenes };
  if (!levelId) return a;
  if (scene && !sceneIsEmpty(scene)) scenes[levelId] = { ...normalizeScene(scene), levelId };
  else delete scenes[levelId];
  return { ...a, at: Date.now(), lastLevel: levelId, scenes };
}

export function sceneForLevel(auto, levelId) {
  const a = normalizeAutoSave(auto);
  return a.scenes[levelId] || null;
}

/** 自动存档摘要（档案室里那张“自动存档”卡片用）。 */
export function describeAutoSave(auto) {
  const a = normalizeAutoSave(auto);
  const ids = Object.keys(a.scenes);
  let steps = 0;
  for (const id of ids) steps += sceneStepCount(a.scenes[id]);
  return {
    levels: ids.length,
    steps,
    lastLevel: a.lastLevel && a.scenes[a.lastLevel] ? a.lastLevel : (ids[0] || null),
    at: a.at,
    when: formatWhen(a.at),
    sceneIds: ids,
  };
}
