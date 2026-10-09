// src/ui/app.js —— 游戏界面：把内核接到可点击的证明台上
import { P, termStr } from '../core/logic.js';
import { candidateSteps, pickGoalCandidate, pickCaseSplitCandidate } from './candidates.js';
import { RULES, RULE_ORDER, RuleError } from '../core/rules.js';
import { LEVELS, TIERS, compileLevel } from '../data/levels.js';
import { FOUND_PROOFS } from '../data/found-proofs.js';
import { HISTORY_BY_ID, historyForLevel, historyByEra, eraOf } from '../data/math-history.js';
import { ACHIEVEMENT_GROUPS, TIER_NAME } from '../data/achievements.js';
import { TOTALS } from '../core/achievements.js';
import {
  SLOT_COUNT, makeSave, parseSave, describeSave, exportSaveText, saveFileName,
  sceneFromState, applyScene, sceneIsEmpty, describeAutoSave, saveIsEmpty,
} from '../core/savefile.js';
import * as save from './profile.js';        // 进度 / 统计 / 成就 / 史话 / 引导偏好 / 存档
import * as coach from './tutorial.js';      // 新手引导运行时
import {
  createState, applyStep, undo, visibleFacts, matchedFact, isTrivial,
  termCandidates, instantiateAxioms, tryStep,
} from '../core/proof.js';

const $ = (id) => document.getElementById(id);

/* 透明立方体图标：取代原来的六边形。
   6 个面各自只有 1px 描边 + 一点同色玻璃填充，所以是"看得穿"的；
   字形放在 z-index:2 的独立层里，转的时候不会跟着糊掉。 */
const CUBE_FACES = ['f', 'b', 'l', 'r', 't', 'd']
  .map((k) => '<span class="cube__f cube__f--' + k + '" aria-hidden="true"></span>').join('');
function cubeInner(glyph) {
  return '<span class="cube__box" aria-hidden="true">' + CUBE_FACES + '</span>' +
    '<span class="cube__g">' + escapeHtml(glyph) + '</span>';
}
// 进度统一由 ui/profile.js 负责（它自己处理 localStorage 抛异常的情况）。
// 这里保留一层同名薄封装，让界面其他部分继续用 store.done / store.mark。
const store = {
  get done() { return save.readDone(); },
  mark(id) { return save.markLevelSolved(id); },
  reset() { save.resetAll(); },
};

/* ---------------- 档案变化后的统一收尾 ----------------
   任何“记了一笔”（落子、提示、撤销、报错、读史话、走完引导）之后都走这里：
   重新判定成就 → 弹提示 → 刷新界面上的计数 → 若正在档案室则重画。
   判定是纯函数且只有 40 来条，开销可以忽略，但保证成就不会漏发。 */
function afterProfileChange() {
  const news = save.syncAchievements();
  if (news.length) showToasts(news);
  renderProgressNumbers();
  if (screen === 'archive') renderArchive();
}

function showToasts(list) {
  const box = $('toasts');
  if (!box) return;
  for (const a of list) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span class="toast__icon cube">' + cubeInner(a.icon || '★') + '</span><span>' +
      '<span class="toast__kicker">成就解锁 · ' + escapeHtml(TIER_NAME[a.tier] || '') + '</span>' +
      '<span class="toast__name">' + escapeHtml(a.name) + '</span>' +
      '<span class="toast__desc">' + escapeHtml(a.desc) + '</span></span>';
    box.appendChild(el);
    // 提示自己消失；打桩环境里没有 window/定时器也照样能跑
    const drop = () => {
      el.className = 'toast toast--out';
      setTimeout(() => {
        try {
          if (el.parentNode && typeof el.parentNode.removeChild === 'function') el.parentNode.removeChild(el);
          else if (typeof box.removeChild === 'function') box.removeChild(el);
        } catch (e) { /* 忽略 */ }
      }, 260);
    };
    setTimeout(drop, 4200);
  }
}

/* ---------------- 新手引导接线 ---------------- */
coach.configure({
  onHistory: (hid) => { if (save.markHistoryRead(hid)) afterProfileChange(); },
  onComplete: (m) => {
    if (m.tour) save.setGuideTourSeen();
    if (m.levelId) save.markGuideDone(m.levelId);
    afterProfileChange();
  },
  onSkip: (m) => {
    if (m.tour) save.setGuideTourSeen();
    if (m.levelId) save.markGuideSkipped(m.levelId);
    setStatus('已跳过引导。想重看时点“本关引导”，也可以在档案室里重新打开全部引导。', 'warn');
    afterProfileChange();
  },
});
if (typeof coach.bind === 'function') coach.bind();

/* 该不该自动起引导：整体关掉过就不起；全景导览没看过就带上；这一关看过/跳过就不再自动弹。 */
function maybeStartGuide(force) {
  if (!state) return false;
  const prefs = save.readGuidePrefs();
  if (!force && prefs.off) return false;
  const withTour = force ? false : !prefs.tour;
  if (!force && !withTour && !save.guideNeeded(state.level.id)) return false;
  return coach.startForLevel(state.level, { withTour, goalText: P(state.goal) });
}

let state = null;
let selected = [];
let hintIndex = 0;

/* 屏幕状态：start（开始页）/ select（证明选择）/ desk（证明台）/ archive（档案室） */
const SCREENS = ['start', 'select', 'desk', 'archive'];
const SCREEN_CLASS = {
  start: 'screen screen--start', select: 'screen screen--select',
  desk: 'screen screen--desk', archive: 'screen screen--archive',
};
const WIPE_SWAP = 400;      // 遮罩盖满、换屏的时刻
const WIPE_OUT = 300;       // 遮罩撤出的时长
let screen = 'start';
let wiping = false;
let pickedId = null;
let pickedTier = 'L0';
let cardEls = [];

// 打桩环境里没有 setAttribute / window，统一走这里，缺了就跳过
function attr(el, k, v) { if (el && typeof el.setAttribute === 'function') el.setAttribute(k, v); }
const reducedMotion = (() => {
  try { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
})();

function setScreenNow(name) {
  for (const s of SCREENS) {
    const el = $('screen-' + s);
    if (!el) continue;
    el.hidden = s !== name;
    el.className = SCREEN_CLASS[s] + (s === name ? ' is-active' : '');
  }
  screen = name;
  if (name === 'select') renderSelect();
  if (name === 'archive') renderArchive();
  if (name === 'desk') maybeStartGuide();
  // 屏幕可直接深链接：#levels / #desk / #archive（file:// 下 replaceState 可能被拒，失败就只是不改地址栏）
  try {
    if (typeof history !== 'undefined' && history.replaceState) {
      const hash = name === 'start' ? '#' : '#' + (name === 'select' ? 'levels' : name);
      history.replaceState(null, '', hash);
    }
  } catch (e) { /* 忽略 */ }
  try { if (typeof window !== 'undefined') window.scrollTo(0, 0); } catch (e) { /* 忽略 */ }
}

/* 载入时按 hash 直接进屏（不做过渡） */
function applyHash() {
  const h = (typeof location !== 'undefined' && location.hash) ? location.hash : '';
  const want = h === '#levels' ? 'select' : h === '#desk' ? 'desk' : h === '#archive' ? 'archive' : '';
  if (want && want !== screen) setScreenNow(want);
}

/* 斜向擦除过渡：盖满 → 换屏 → 撤出 → 无动画归位 */
function go(name) {
  if (name === screen || wiping) return;
  const wipe = $('wipe');
  if (reducedMotion || !wipe) { setScreenNow(name); return; }
  wiping = true;
  wipe.className = 'wipe is-in';
  setTimeout(() => {
    setScreenNow(name);
    wipe.className = 'wipe is-out';
    setTimeout(() => {
      wipe.className = 'wipe is-reset';
      setTimeout(() => { wipe.className = 'wipe'; wiping = false; }, 40);
    }, WIPE_OUT);
  }, WIPE_SWAP);
}

/* ---------------- 关卡列表 ---------------- */
function renderLevelList() {
  const box = $('level-list');
  box.innerHTML = '';
  const done = new Set(store.done);
  for (const tier of ['L0', 'L1']) {
    const head = document.createElement('div');
    head.className = 'lx-tier';
    head.textContent = tier + ' · ' + (TIERS[tier] || tier);
    box.appendChild(head);
    for (const lv of LEVELS.filter((l) => l.tier === tier)) {
      const now = lv.id === state.level.id;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'lx' + (now ? ' lx--now' : '') + (done.has(lv.id) ? ' lx--done' : '');
      item.innerHTML = '<span class="lx__no">' + escapeHtml(lv.id.slice(3)) + '</span>' +
        '<span class="lx__name">' + escapeHtml(lv.title) + '</span>' +
        '<span class="lx__st">' + (done.has(lv.id) ? 'DONE' : (now ? 'NOW' : '—')) + '</span>';
      item.onclick = () => openLevel(lv.id);
      box.appendChild(item);
    }
  }
  renderProgressNumbers(done.size);
}

/* 所有“数字声明”在一处更新：关卡数、成就数、史话条目数都从数据实时算，
   免得改了关卡表还要回来手改界面上的硬编码数字。 */
function renderProgressNumbers(doneCount) {
  const done = doneCount === undefined ? store.done.length : doneCount;
  const sum = save.summary();
  const set = (id, text) => { const el = $(id); if (el) el.textContent = String(text); };
  set('progress-text', done + ' / ' + LEVELS.length);
  set('select-progress-num', done);
  set('select-progress-den', '/ ' + LEVELS.length);
  set('start-progress', '已通关 ' + done + ' / ' + LEVELS.length);
  set('meta-levels', LEVELS.length);
  set('meta-ach', sum.unlocked);
  set('meta-ach-total', sum.total);
  set('meta-hist', save.readHistory().length);
  set('meta-hist-total', TOTALS.history);
  set('meta-saves', SLOT_COUNT);
  set('archive-ach-num', sum.unlocked);
  set('archive-ach-den', '/ ' + sum.total);
}

/* ---------------- 证明选择 ---------------- */
function opClass(id, done) {
  const now = !!(state && state.level && id === state.level.id);
  return 'op' + (id === pickedId ? ' op--sel' : '') + (done.has(id) ? ' op--done' : '') + (now ? ' op--now' : '');
}
function markCards() {
  const done = new Set(store.done);
  for (const c of cardEls) c.el.className = opClass(c.id, done);
}
function renderSelect() {
  if (!state) return;
  const done = new Set(store.done);
  // 还没选中过任何关卡（或选中的关卡已不存在）时，用“当前打开的这一关”兜底
  if (!pickedId || !LEVELS.some((l) => l.id === pickedId)) {
    pickedId = state.level.id;
    pickedTier = state.level.tier || 'L0';
  }
  // 注意：这里**不能**再用 pickedId 那一关的层级去覆盖 pickedTier。
  // pickedTier 是“正在浏览哪一层”，pickedId 是“右边详情面板里选中的是哪一关”，
  // 两者可以不在同一层。原先那一行是无条件覆盖，于是点 L1 标签刚设好就被改回 L0，
  // 表现出来就是“点 L1 没反应”。

  const tabs = $('tier-tabs');
  tabs.innerHTML = '';
  for (const tier of ['L0', 'L1']) {
    const list = LEVELS.filter((l) => l.tier === tier);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tier-tab' + (tier === pickedTier ? ' is-on' : '');
    attr(b, 'role', 'tab');
    attr(b, 'aria-selected', tier === pickedTier ? 'true' : 'false');
    const cn = document.createElement('span');
    cn.className = 'tier-tab__cn';
    cn.textContent = tier + ' ' + (TIERS[tier] || tier);
    const en = document.createElement('span');
    en.className = 'tier-tab__en';
    en.textContent = list.filter((l) => done.has(l.id)).length + ' / ' + list.length + ' cleared';
    b.appendChild(cn); b.appendChild(en);
    b.onclick = () => {
      pickedTier = tier;
      // 详情面板也跟着切到这一层的第一个关卡，否则右边会停在另一层的那一关上
      const cur = LEVELS.find((l) => l.id === pickedId);
      if (!cur || cur.tier !== tier) {
        const first = LEVELS.find((l) => l.tier === tier);
        if (first) pickedId = first.id;
      }
      renderSelect();
    };
    tabs.appendChild(b);
  }

  const grid = $('op-grid');
  grid.innerHTML = '';
  cardEls = [];
  LEVELS.filter((l) => l.tier === pickedTier).forEach((lv, i) => {
    const isDone = done.has(lv.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = opClass(lv.id, done);
    b.style.cssText = '--i:' + Math.min(i, 14);
    b.innerHTML = '<span class="op__state">' + (isDone ? 'CLEAR' : ((lv.script && !lv.noScript) ? '—' : 'OPEN')) + '</span>' +
      '<span class="op__no">' + escapeHtml(lv.id.slice(3)) + '</span>' +
      '<span class="op__name">' + escapeHtml(lv.title) + '</span>' +
      '<span class="op__code">' + escapeHtml(lv.id) + '</span>';
    b.onclick = () => { pickLevel(lv.id); markCards(); renderDetail(); };
    grid.appendChild(b);
    cardEls.push({ id: lv.id, el: b });
  });
  renderDetail();
}

/* 选中某一关：详情面板与“正在浏览的层级”一起跟上，免得两处显示不同层 */
function pickLevel(id) {
  const lv = LEVELS.find((l) => l.id === id);
  if (!lv) return;
  pickedId = lv.id;
  pickedTier = lv.tier || pickedTier;
}

function renderDetail() {
  const box = $('detail');
  if (!box) return;
  const lv = LEVELS.find((l) => l.id === pickedId) || state.level;
  const done = new Set(store.done);
  const compiled = compileLevel(lv);
  box.innerHTML = '';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'detail__eyebrow';
  eyebrow.textContent = 'Selected Operation';
  const code = document.createElement('span');
  code.className = 'detail__code';
  code.textContent = lv.id;
  const title = document.createElement('h3');
  title.className = 'detail__title';
  title.textContent = lv.title;

  const goal = document.createElement('div');
  goal.className = 'detail__goal';
  const gl = document.createElement('span'); gl.className = 'lbl'; gl.textContent = '要证明的结论';
  const gf = document.createElement('span'); gf.className = 'fx'; gf.textContent = P(compiled.goal);
  goal.appendChild(gl); goal.appendChild(gf);

  const ruleNames = (lv.rules || []).filter((r) => RULES[r]).map((r) => RULES[r].name).join('、') || '—';
  const premises = compiled.parsedPremises.length
    ? compiled.parsedPremises.map((p) => P(p.f)).join('，')
    : '本关没有题设';

  const rows = document.createElement('dl');
  rows.className = 'detail__rows';
  const pairs = [
    ['所属层级', lv.tier + ' ' + (TIERS[lv.tier] || lv.tier)],
    ['可用规则', ruleNames],
    ['题设', premises],
    ['状态', done.has(lv.id) ? '已通关' : '未通关'],
  ];
  for (const [k, v] of pairs) {
    const row = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    row.appendChild(dt); row.appendChild(dd);
    rows.appendChild(row);
  }

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'btn btn--advanced btn--block';
  start.textContent = done.has(lv.id) ? '重新证明' : '开始证明';
  start.onclick = () => openLevel(lv.id);

  // 存档入口放在这里：这是玩家最常停留的一屏，
  // 只把存档藏在档案室的第三个小标签里，很多人根本不会发现。
  const saves = document.createElement('button');
  saves.type = 'button';
  saves.className = 'btn btn--outline btn--block';
  saves.textContent = '存档 / 读档';
  saves.onclick = () => goArchive('save');

  const saveHint = document.createElement('p');
  saveHint.className = 'detail__note';
  saveHint.textContent = '每一步都会自动存档（关掉再打开接着推）；另有 3 个手动槽位，可导出成文件或文本带到别的机器。';

  box.appendChild(eyebrow); box.appendChild(code); box.appendChild(title);
  box.appendChild(goal); box.appendChild(rows); box.appendChild(start);
  box.appendChild(saves); box.appendChild(saveHint);
}

function openLevel(id) {
  loadLevel(id);
  pickLevel(id);
  const lv = LEVELS.find((l) => l.id === id);
  setStatus('已载入 ' + id + '：' + (lv ? lv.title : '') + '。先读上面的说明，再选前提、点规则。', '');
  // 引导由 setScreenNow('desk') 统一负责起（擦除过渡结束后、或 reduced-motion 下立即切换时都会经过那里）
  go('desk');
}

/* ---------------- 载入关卡 ---------------- */
function loadLevel(id) {
  const lv = LEVELS.find((l) => l.id === id) || LEVELS[0];
  state = createState(lv);
  selected = [];
  hintIndex = 0;
  historyOpen = false;                      // 换关时把史话卡收起来
  // 这一关如果推到一半，现场就在自动存档里；有现场就接着上次那次“尝试”继续记统计
  const scene = save.autoScene(lv.id);
  if (scene) save.noteResume(lv.id); else save.notePlay(lv.id);
  const resumed = scene ? applyScene(state, scene) : { ok: false };
  renderAll();
  const base = '已载入 ' + lv.id + '：' + lv.title + '。';
  if (resumed.ok && resumed.steps) {
    setStatus(base + '已恢复到上次的现场：这一关已经推了 ' + resumed.steps + ' 步（想退回去可以点“撤销一步”）。', 'ok');
  } else if (scene && !resumed.ok) {
    setStatus(base + '（' + resumed.error + '）', 'warn');
  } else {
    setStatus(base + '先读一读上面的说明，再选前提、点规则。', '');
  }
}

function renderAll() {
  const lv = state.level;
  $('level-code').textContent = lv.id;
  $('level-title').textContent = lv.title;
  $('level-tier').textContent = lv.tier + ' · ' + (TIERS[lv.tier] || lv.tier);
  $('goal-text').textContent = P(state.goal);
  const ov = [...state.compiled.openVars];
  $('goal-openvars').textContent = ov.length ? ov.join('、') + ' 视为任意取定的量，可直接用于实例化公理' : '';
  $('level-teach').textContent = lv.teach || '';
  $('level-premises').textContent = (lv.premiseText || '') + (lv.hintText ? '　提示：' + lv.hintText : '');
  renderFacts();
  renderRules();
  renderProof();
  renderAxioms();
  renderHistoryCard();
  renderLevelList();
  renderDone();
  if (matchedFact(state)) onSolved();
}

/* 通关面板 */
function renderDone() {
  const box = $('done-panel');
  if (!box) return;
  const solved = !!matchedFact(state);
  box.hidden = !solved;
  if (solved) {
    const msg = $('done-msg');
    if (msg) msg.textContent = '结论已推出：' + P(state.goal);
  }
}

/* ---------------- 事实表 ---------------- */
function renderFacts() {
  const box = $('facts');
  box.innerHTML = '';
  const vis = visibleFacts(state);
  if (!vis.length) {
    // 空题设的关卡（例如“证明 A → A”）载入后一条事实都没有，
    // 必须明确告诉玩家下一步该干什么，否则界面看上去像坏的。
    const empty = document.createElement('div');
    empty.className = 'facts-empty';
    const g = state.goal;
    let tip = '本关没有题设。';
    if (g && g.k === 'imp') tip += '要证 ' + P(g) + '，请先在下方“子证明”里假设 ' + P(g.a) + '（或直接点规则区的“蕴含引入”看引导）。';
    else if (g && g.k === 'not') tip += '要证 ' + P(g) + '，请先假设 ' + P(g.a) + ' 并推出矛盾。';
    else tip += '可以先点下方“打开假设”开一个子证明，或看看规则区的引导。';
    empty.textContent = tip;
    box.appendChild(empty);
  }
  for (const f of vis) {
    const el = document.createElement('div');
    const cls = f.rule === 'assume' ? ' fact--assume' : (f.given ? '' : ' fact--derived');
    el.className = 'fact' + cls;
    attr(el, 'aria-pressed', selected.indexOf(f.id) >= 0 ? 'true' : 'false');
    el.innerHTML = '<span class="fact__id">' + escapeHtml(f.id) + '</span><span><span class="fact__fx">' + escapeHtml(P(f.f)) +
      '</span><span class="fact__meta">' + escapeHtml(factLabel(f)) + '</span></span>';
    el.onclick = () => toggleSelect(f.id);
    box.appendChild(el);
  }
  $('select-hint').textContent = '已选 ' + selected.length + ' 条' + (selected.length ? '：' + selected.join(', ') : '');
  renderScopes();
}

/* 把“当前打开的子证明”显式列出来：玩家据此知道现在处在哪一层，
   也才知道 ∨E / ↔I 这类需要合上两支的规则该收哪一层。 */
function renderScopes() {
  const box = $('scope-list');
  if (!box) return;
  const stack = state.scopeStack || [];
  box.innerHTML = '';
  if (!stack.length) {
    box.innerHTML = '<span class="scope-none">当前没有打开的子证明</span>';
    return;
  }
  stack.forEach((id, i) => {
    const sp = document.createElement('span');
    sp.className = 'scope-chip';
    const f = state.assumptions && state.assumptions[id];
    sp.innerHTML = '<span class="scope-hex cube">' + cubeInner(i + 1) + '</span>' + escapeHtml(id + (f ? '：' + P(f) : ''));
    sp.title = '第 ' + (i + 1) + ' 层子证明，合上时收最内层';
    box.appendChild(sp);
  });
}

function factLabel(f) {
  if (f.rule === 'premise') return '题设';
  if (f.rule === 'axiom') return '公理 ' + (f.ax ? f.ax.id : '') + (f.ax && f.ax.note ? ' · ' + f.ax.note : '');
  if (f.rule === 'assume') return '子证明假设（作用域 ' + f.scope + '）';
  if (f.rule === 'hyp') return '引用前提';
  const spec = RULES[f.rule];
  const terms = (f.terms || []).map((t) => termStr(t, [])).filter(Boolean);
  return (spec ? spec.name : f.rule) + (terms.length ? ' [' + terms.join('、') + ']' : '') + (f.scope ? ' · 依赖假设 ' + f.scope : '');
}

function toggleSelect(id) {
  const i = selected.indexOf(id);
  if (i >= 0) selected.splice(i, 1); else selected.push(id);
  renderFacts();
}

/* ---------------- 规则按钮 ---------------- */
function renderRules() {
  const box = $('rules');
  box.innerHTML = '';
  const avail = (state.level.rules || []).filter((r) => RULES[r]);
  for (const rid of RULE_ORDER.filter((r) => avail.indexOf(r) >= 0)) {
    const spec = RULES[rid];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rule' + (rid === 'impE' || rid === 'ring' ? ' is-primary' : '');
    btn.innerHTML = '<span class="rule__nm">' + escapeHtml(spec.name) + '</span><span class="rule__en">' + escapeHtml(rid) + '</span>';
    btn.title = spec.hint;
    btn.onclick = () => useRule(rid);
    box.appendChild(btn);
  }
}

/* ---------------- 证明记录 ---------------- */
function renderProof() {
  const box = $('proof');
  box.innerHTML = '';
  let n = 0;
  const closed = new Set(state.closedScopes || []);
  for (const f of state.facts) {
    if (f.given) continue;
    n++;
    const li = document.createElement('li');
    const spec = RULES[f.rule];
    // 子证明的层次：作用域是 "H1|H2" 就说明处在第二层
    const depth = f.scope ? String(f.scope).split('|').filter(Boolean).length : 0;
    const parts = f.scope ? String(f.scope).split('|') : [];
    const isClosed = parts.some((id) => closed.has(id));
    li.className = (f.rule === 'assume' ? 'is-assume' : 'is-derived') + ' d' + Math.min(3, depth) + (isClosed ? ' is-closed' : '');
    const why = f.rule === 'assume'
      ? '假设（子证明 ' + f.scope + '）'
      : (spec ? spec.name : f.rule) + (f.scope ? ' · 依赖 ' + f.scope : '');
    li.innerHTML = '<span class="proof__fx">' + escapeHtml(P(f.f)) + '</span><span class="proof__why">' +
      escapeHtml(why) + (isClosed ? ' · 已合上' : '') + '</span>';
    box.appendChild(li);
  }
  $('proof-hint').textContent = n + ' 步' + (state.scopeStack.length ? '（子证明 ' + state.scopeStack.length + ' 层开着）' : '');
}

/* ---------------- 公理表 ---------------- */
function renderAxioms() {
  const box = $('axioms');
  box.innerHTML = '';
  const ax = state.compiled.axioms;
  if (!ax.length) { box.textContent = '本关不需要额外公理（只用逻辑规则）。'; return; }
  const table = document.createElement('table');
  for (const a of ax) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="n">' + escapeHtml(a.id) + '</td><td class="f">' + escapeHtml(P(a.f)) + '</td><td class="d">' + escapeHtml(a.note || '') + '</td>';
    table.appendChild(tr);
  }
  box.appendChild(table);
}

/* ---------------- 数学史：证明台上的“这一关的来历” ---------------- */
/* 展开状态自己管：不依赖 index.html 上的 hidden 属性，换关时自动收起，
   这样 renderAll() 被反复调用时卡片不会被“重新弹开”。 */
let historyOpen = false;
function renderHistoryCard() {
  const box = $('history-card');
  if (!box) return;
  const items = historyForLevel(state.level.id);
  const btn = $('btn-history');
  if (btn) btn.textContent = items.length ? '数学史 · 这一关的来历（' + items.length + '）' : '数学史 · 本关暂无关联条目';
  box.innerHTML = '';
  box.hidden = !historyOpen || !items.length;
  if (!items.length) return;
  for (const h of items) box.appendChild(deskHistoryEl(h));
}

function deskHistoryEl(h) {
  const el = document.createElement('div');
  el.className = 'hist-entry';
  const meta = document.createElement('div');
  meta.className = 'hist-entry__meta';
  const year = document.createElement('span'); year.className = 'hist-entry__year'; year.textContent = h.year;
  const title = document.createElement('span'); title.className = 'hist-entry__title'; title.textContent = h.title;
  const ppl = document.createElement('span'); ppl.className = 'hist-entry__people'; ppl.textContent = h.people;
  meta.appendChild(year); meta.appendChild(title); meta.appendChild(ppl);
  const summary = document.createElement('p'); summary.className = 'hist-entry__summary'; summary.textContent = h.summary;
  const detail = document.createElement('p'); detail.className = 'hist-entry__detail'; detail.textContent = h.detail;
  const tags = document.createElement('div'); tags.className = 'hist-entry__tags';
  for (const t of h.tags || []) {
    const s = document.createElement('span'); s.className = 'hist-tag'; s.textContent = t; tags.appendChild(s);
  }
  el.appendChild(meta); el.appendChild(summary); el.appendChild(detail); el.appendChild(tags);
  return el;
}

/* ---------------- 档案室：成就 + 数学史长廊 ---------------- */
let archiveTab = 'ach';
const archiveOpen = new Set();      // 已展开全文的史话条目（重画界面时保留展开状态）

function renderArchive() {
  renderProgressNumbers();
  const tabs = $('archive-tabs');
  if (tabs) {
    tabs.innerHTML = '';
    const sum = save.summary();
    const auto = describeAutoSave(save.readAutoSave());
    const defs = [
      { id: 'ach', cn: '成就', en: sum.unlocked + ' / ' + sum.total + ' unlocked' },
      { id: 'hist', cn: '数学史', en: save.readHistory().length + ' / ' + TOTALS.history + ' read' },
      { id: 'save', cn: '存档', en: auto.levels + ' scene(s) · ' + save.readSlots().filter(Boolean).length + ' slot(s)' },
    ];
    for (const d of defs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tier-tab' + (archiveTab === d.id ? ' is-on' : '');
      attr(b, 'role', 'tab');
      attr(b, 'aria-selected', archiveTab === d.id ? 'true' : 'false');
      const cn = document.createElement('span'); cn.className = 'tier-tab__cn'; cn.textContent = d.cn;
      const en = document.createElement('span'); en.className = 'tier-tab__en'; en.textContent = d.en;
      b.appendChild(cn); b.appendChild(en);
      b.onclick = () => { archiveTab = d.id; renderArchive(); };
      tabs.appendChild(b);
    }
  }
  const body = $('archive-body');
  if (body) {
    body.innerHTML = '';
    if (archiveTab === 'hist') renderArchiveHistory(body);
    else if (archiveTab === 'save') renderArchiveSave(body);
    else renderArchiveAchievements(body);
  }
  renderArchiveSide();
}

function renderArchiveAchievements(body) {
  const sum = save.summary();
  const pctv = sum.total ? Math.round((sum.unlocked / sum.total) * 100) : 0;
  const head = document.createElement('div');
  head.className = 'ach-sum';
  const bar = document.createElement('span');
  bar.className = 'ach-bar';
  const fill = document.createElement('i');
  fill.className = 'ach-bar__fill';
  if (fill.style) fill.style.width = pctv + '%';
  bar.appendChild(fill);
  const label = document.createElement('span');
  label.className = 'panel-right';
  label.textContent = '已解锁 ' + sum.unlocked + ' / ' + sum.total + '（' + pctv + '%）';
  head.appendChild(bar); head.appendChild(label);
  body.appendChild(head);

  for (const g of ACHIEVEMENT_GROUPS) {
    const items = sum.list.filter((a) => a.group === g.id);
    const sec = document.createElement('section');
    sec.className = 'ach-group';
    const gh = document.createElement('div');
    gh.className = 'ach-group__head';
    const h3 = document.createElement('h3'); h3.textContent = g.name;
    const en = document.createElement('span'); en.className = 'eyebrow'; en.textContent = g.en;
    const cnt = document.createElement('span');
    cnt.textContent = items.filter((a) => a.unlocked).length + ' / ' + items.length;
    gh.appendChild(h3); gh.appendChild(en); gh.appendChild(cnt);
    sec.appendChild(gh);
    const grid = document.createElement('div');
    grid.className = 'ach-grid';
    for (const a of items) grid.appendChild(achievementCard(a));
    sec.appendChild(grid);
    body.appendChild(sec);
  }
}

function achievementCard(a) {
  const el = document.createElement('article');
  el.className = 'ach ach--' + a.tier + (a.unlocked ? ' ach--on' : ' ach--locked');
  const icon = document.createElement('span');
  icon.className = 'ach__icon cube';
  icon.innerHTML = cubeInner(a.icon || '★');
  const box = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'ach__name';
  name.textContent = a.name;
  const tier = document.createElement('span');
  tier.className = 'ach__tier';
  tier.textContent = (TIER_NAME[a.tier] || '') + (a.unlocked ? ' · 已解锁' : '');
  name.appendChild(tier);
  const desc = document.createElement('div');
  desc.className = 'ach__desc';
  desc.textContent = a.desc;
  const foot = document.createElement('div');
  foot.className = 'ach__foot';
  const bar = document.createElement('span');
  bar.className = 'ach__bar';
  const fill = document.createElement('i');
  if (fill.style) fill.style.width = Math.round(a.ratio * 100) + '%';
  bar.appendChild(fill);
  const pctEl = document.createElement('span');
  pctEl.className = 'ach__pct';
  pctEl.textContent = a.cur + ' / ' + a.max;
  foot.appendChild(bar); foot.appendChild(pctEl);
  box.appendChild(name); box.appendChild(desc); box.appendChild(foot);

  const h = a.history ? HISTORY_BY_ID[a.history] : null;
  if (h) {
    const hb = document.createElement('button');
    hb.type = 'button';
    hb.className = 'ach__hist';
    hb.textContent = '史话 · ' + h.year + '　' + h.title;
    hb.onclick = () => {
      archiveTab = 'hist';
      archiveOpen.add(h.id);
      save.markHistoryRead(h.id);
      afterProfileChange();
    };
    box.appendChild(hb);
  }
  el.appendChild(icon); el.appendChild(box);
  return el;
}

function renderArchiveHistory(body) {
  const read = new Set(save.readHistory());
  for (const era of historyByEra()) {
    const head = document.createElement('div');
    head.className = 'era-head';
    head.innerHTML = '<h3>' + escapeHtml(era.name) + '</h3><span>' + escapeHtml(era.en) +
      '</span><em>' + escapeHtml(era.span) + '</em>';
    body.appendChild(head);
    const list = document.createElement('div');
    list.className = 'hist-list';
    for (const h of era.items) list.appendChild(archiveHistoryEl(h, read.has(h.id)));
    body.appendChild(list);
  }
}

function archiveHistoryEl(h, isRead) {
  const el = document.createElement('article');
  el.className = 'hist-item' + (isRead ? ' hist-item--read' : '');
  const head = document.createElement('div');
  head.className = 'hist-item__head';
  const year = document.createElement('span'); year.className = 'hist-item__year'; year.textContent = h.year;
  const title = document.createElement('h4'); title.className = 'hist-item__title'; title.textContent = h.title;
  const ppl = document.createElement('span'); ppl.className = 'hist-item__people'; ppl.textContent = h.people;
  head.appendChild(year); head.appendChild(title); head.appendChild(ppl);
  const summary = document.createElement('p'); summary.className = 'hist-item__summary'; summary.textContent = h.summary;
  el.appendChild(head); el.appendChild(summary);

  const open = archiveOpen.has(h.id);
  if (open) {
    const d = document.createElement('p');
    d.className = 'hist-item__body';
    d.textContent = h.detail;
    el.appendChild(d);
  }
  const foot = document.createElement('div');
  foot.className = 'hist-item__foot';
  const tbtn = document.createElement('button');
  tbtn.type = 'button';
  tbtn.className = 'btn btn--outline';
  tbtn.textContent = open ? '收起' : '读全文';
  tbtn.onclick = () => {
    if (open) archiveOpen.delete(h.id);
    else { archiveOpen.add(h.id); save.markHistoryRead(h.id); }
    afterProfileChange();                       // 会连带重画档案室（含展开状态）
  };
  foot.appendChild(tbtn);
  for (const t of h.tags || []) {
    const s = document.createElement('span'); s.className = 'hist-tag'; s.textContent = t; foot.appendChild(s);
  }
  for (const lvId of h.levels || []) {
    const lb = document.createElement('button');
    lb.type = 'button';
    lb.className = 'hist-lv';
    lb.textContent = lvId;
    lb.title = '进入这一关';
    lb.onclick = () => openLevel(lvId);
    foot.appendChild(lb);
  }
  const mark = document.createElement('span');
  mark.className = 'hist-item__state';
  mark.textContent = isRead ? '✓ 已读' : '';
  foot.appendChild(mark);
  el.appendChild(foot);
  return el;
}

/* ---------------- 档案室 · 存档分页 ---------------- */
/* 一句话反馈就放在分页顶部：档案室里没有证明台那条状态栏，
   而 afterProfileChange() 会重画整个分页，所以提示要存在模块变量里才不会一闪就没。 */
let saveNotice = null;
/* 导出的存档文本与文本框内容：也放在模块里，重画分页时不会丢 */
let archiveShowText = '';

function mkEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}
function mkBtn(label, cls, fn, title) {
  const b = mkEl('button', cls || 'btn btn--outline', label);
  b.type = 'button';
  if (title) b.title = title;
  b.onclick = fn;
  return b;
}
/* 破坏性操作不用浏览器弹窗（早期版本吃过 prompt 被拦的亏），改成“再点一次确认” */
function mkConfirmBtn(label, confirmLabel, fn) {
  const b = mkEl('button', 'btn btn--outline', label);
  b.type = 'button';
  let armed = false;
  b.onclick = () => {
    if (!armed) {
      armed = true;
      b.textContent = confirmLabel;
      b.className = 'btn btn--outline is-armed';
      setTimeout(() => { armed = false; b.textContent = label; b.className = 'btn btn--outline'; }, 4000);
      return;
    }
    armed = false;
    b.textContent = label;
    b.className = 'btn btn--outline';
    fn();
  };
  return b;
}
function saveRows(pairs) {
  const dl = mkEl('dl', 'save-rows');
  for (const [k, v] of pairs) {
    const row = mkEl('div');
    row.appendChild(mkEl('dt', null, k));
    row.appendChild(mkEl('dd', null, v));
    dl.appendChild(row);
  }
  return dl;
}
function saveCard(title, en, sub) {
  const box = mkEl('section', 'save-card');
  const head = mkEl('div', 'save-card__head');
  head.appendChild(mkEl('h3', null, title));
  head.appendChild(mkEl('span', 'eyebrow', en));
  box.appendChild(head);
  if (sub) box.appendChild(mkEl('p', 'save-card__sub', sub));
  return box;
}
function saveActions(buttons) {
  const row = mkEl('div', 'save-actions');
  for (const b of buttons) row.appendChild(b);
  return row;
}
function note(text, kind) { saveNotice = { text, kind: kind || 'ok' }; }

function renderArchiveSave(body) {
  const auto = describeAutoSave(save.readAutoSave());
  const prof = save.profile();

  if (saveNotice) {
    const n = mkEl('div', 'save-notice save-notice--' + saveNotice.kind, saveNotice.text);
    body.appendChild(n);
  }

  /* ---- 1 · 当前进度 / 自动存档 ---- */
  const sum = save.summary();
  const autoCard = saveCard('自动存档 · 当前进度', 'Auto Save',
    auto.lastLevel
      ? '上次停在 ' + auto.lastLevel + '，那一关已推 ' + auto.steps + ' 步（' + auto.when + ' 记录）。每次落子都会自动写一次，关掉游戏再打开就能接着推。'
      : '还没有推到一半的关卡。开始证明后每一步都会自动记下来。');
  autoCard.appendChild(saveRows([
    ['通关', prof.solvedCount + ' / ' + prof.totalLevels],
    ['成就', sum.unlocked + ' / ' + sum.total],
    ['数学史', prof.historyRead + ' / ' + prof.historyTotal],
    ['保留现场', auto.levels ? auto.levels + ' 关（合计 ' + auto.steps + ' 步）' : '无'],
  ]));
  autoCard.appendChild(saveActions([
    mkBtn('导出存档文件', 'btn btn--advanced', () => {
      const r = downloadSave(currentSave());
      note(r.ok
        ? '已生成 ' + r.name + '。窗口若没有弹出保存对话框，请改用右边的“存档文本”复制保存。'
        : '导出失败：' + r.error, r.ok ? 'ok' : 'bad');
      afterProfileChange();
    }),
    mkBtn('存档文本', 'btn btn--outline', () => {
      archiveShowText = exportSaveText(currentSave());
      note('存档文本已生成，复制下面框里的内容保存即可。', 'ok');
      afterProfileChange();
    }, '把存档变成一段文本，方便复制到别处'),
    mkBtn('清空全部现场', 'btn btn--outline', () => {
      save.clearAutoSave();
      note('已清空自动存档里的证明现场；通关进度、统计与成就都不受影响。', 'warn');
      afterProfileChange();
    }, '只丢掉“推到一半”的现场，不动进度'),
  ]));
  body.appendChild(autoCard);

  /* ---- 2 · 手动存档槽 ---- */
  const slots = save.readSlots();
  const slotCard = saveCard('存档槽位 · ' + slots.filter(Boolean).length + ' / ' + SLOT_COUNT, 'Save Slots',
    '手动存档会连“当前这一关推到哪一步”一起存下来。重置进度不会删除槽位里的存档。');
  for (let i = 0; i < SLOT_COUNT; i++) slotCard.appendChild(slotRow(i, slots[i]));
  body.appendChild(slotCard);

  /* ---- 3 · 导入 ---- */
  const impCard = saveCard('导入存档', 'Import',
    '可以选择导出过的 .json 文件，也可以把存档文本直接粘进来。导入会覆盖当前的进度与现场。');
  impCard.appendChild(filePicker((text, err) => {
    if (err) { note(err, 'bad'); afterProfileChange(); return; }
    doImport(text);
  }));
  const ta = document.createElement('textarea');
  ta.className = 'save-textarea';
  ta.placeholder = '把存档文本粘到这里…';
  ta.value = archiveShowText || '';
  ta.oninput = () => { archiveShowText = ta.value; };
  impCard.appendChild(ta);
  impCard.appendChild(saveActions([
    mkBtn('从文本导入', 'btn btn--advanced', () => doImport(archiveShowText || ta.value || '')),
    mkBtn('复制文本框内容', 'btn btn--outline', () => {
      archiveShowText = ta.value || archiveShowText;
      note(copyText(archiveShowText) ? '已复制到剪贴板。' : '这个环境不允许自动复制，请手动全选复制。', 'ok');
      afterProfileChange();
    }),
    mkBtn('清空文本框', 'btn btn--outline', () => {
      archiveShowText = '';
      ta.value = '';
      note('文本框已清空。', 'ok');
      afterProfileChange();
    }),
  ]));
  if (archiveShowText) {
    impCard.appendChild(mkEl('p', 'save-card__sub', '文本框里现有 ' + archiveShowText.length + ' 个字符。'));
  }
  body.appendChild(impCard);

  /* ---- 4 · 危险操作 ---- */
  const danger = saveCard('危险操作', 'Danger Zone', '这些操作不可撤销。');
  danger.appendChild(saveActions([
    mkConfirmBtn('清空全部进度', '再点一次确认清空', () => {
      store.reset();
      coach.stop();
      saveNotice = null;
      renderLevelList();
      renderSelect();
      afterProfileChange();
      note('进度、统计、成就、史话阅读与自动存档已清空（手动存档槽保留）。', 'warn');
      afterProfileChange();
    }),
    mkConfirmBtn('删除全部存档槽', '再点一次确认删除', () => {
      for (let i = 0; i < SLOT_COUNT; i++) save.clearSlot(i);
      note('三个存档槽都已删除。', 'warn');
      afterProfileChange();
    }),
  ]));
  body.appendChild(danger);
}

/* 存档文本放在模块里，重画分页时不至于丢掉 */
function slotRow(i, sv) {
  const row = mkEl('div', 'save-slot' + (sv ? ' save-slot--full' : ''));
  const head = mkEl('div', 'save-slot__head');
  const slotNo = mkEl('span', 'save-slot__no cube');
  slotNo.innerHTML = cubeInner(i + 1);
  head.appendChild(slotNo);
  const nameInput = document.createElement('input');
  nameInput.className = 'input save-slot__name';
  nameInput.value = sv ? (sv.name || '存档 ' + (i + 1)) : '空槽位 ' + (i + 1);
  nameInput.placeholder = '给这个存档起个名字';
  if (sv) {
    nameInput.onchange = () => {
      save.writeSlot(i, { ...sv, name: String(nameInput.value || '').slice(0, 40) });
      note('槽位 ' + (i + 1) + ' 已改名为「' + nameInput.value + '」。', 'ok');
      afterProfileChange();
    };
  } else {
    nameInput.disabled = true;
  }
  head.appendChild(nameInput);
  row.appendChild(head);

  if (sv) {
    const d = describeSave(sv);
    row.appendChild(saveRows([
      ['存档时间', d.when],
      ['现场', d.hasScene ? d.levelId + ' · ' + d.steps + ' 步' : '（只存了进度）'],
      ['通关', d.solved + ' / ' + LEVELS.length],
      ['成就', d.ach + ' / ' + TOTALS.achievements],
    ]));
    row.appendChild(saveActions([
      mkConfirmBtn('读取此槽', '再点一次覆盖当前进度', () => doLoadSlot(i)),
      mkBtn('覆盖存入', 'btn btn--advanced', () => {
        save.writeSlot(i, currentSave(sv.name));
        note('已把当前进度写入槽位 ' + (i + 1) + '。', 'ok');
        afterProfileChange();
      }),
      mkBtn('导出', 'btn btn--outline', () => {
        const r = downloadSave(sv);
        note(r.ok ? '已导出 ' + r.name + '。' : '导出失败：' + r.error, r.ok ? 'ok' : 'bad');
        afterProfileChange();
      }),
      mkConfirmBtn('删除', '再点一次确认删除', () => {
        save.clearSlot(i);
        note('槽位 ' + (i + 1) + ' 已删除。', 'warn');
        afterProfileChange();
      }),
    ]));
  } else {
    row.appendChild(saveRows([['状态', '空'], ['可存内容', '当前进度 + 当前这一关的现场']]));
    row.appendChild(saveActions([
      mkBtn('存入此槽', 'btn btn--advanced', () => {
        save.writeSlot(i, currentSave('存档 ' + (i + 1)));
        note('已把当前进度与现场写入槽位 ' + (i + 1) + '。', 'ok');
        afterProfileChange();
      }),
    ]));
  }
  return row;
}

function doLoadSlot(i) {
  const sv = save.readSlot(i);
  if (!sv) { note('槽位 ' + (i + 1) + ' 是空的。', 'bad'); afterProfileChange(); return; }
  const r = applySaveToSession(sv);
  note('已读取槽位 ' + (i + 1) + '（' + r.solved + ' 关通关 · ' + r.ach + ' 项成就' +
    (r.levelId ? ' · 现场回到 ' + r.levelId : '') + '）。', 'ok');
  if (screen === 'archive') afterProfileChange();
}

function doImport(text) {
  const r = parseSave(text);
  if (!r.ok) { note('导入失败：' + r.error, 'bad'); afterProfileChange(); return; }
  if (saveIsEmpty(r.save)) {
    note('这份存档是空的（没有通关记录、没有成就、也没有现场），已忽略。', 'warn');
    afterProfileChange();
    return;
  }
  const info = applySaveToSession(r.save);
  archiveShowText = '';
  note('导入成功：' + info.solved + ' 关通关 · ' + info.ach + ' 项成就 · ' + info.levelId +
    '（现场已装回）。', 'ok');
  if (screen === 'archive') afterProfileChange();
}

function filePicker(onText) {
  const wrap = mkEl('div', 'save-import');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.className = 'input save-import__file';
  input.onchange = () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (typeof FileReader === 'undefined') { onText(null, '当前环境不能读文件，请把存档文本粘到下面的框里。'); return; }
    try {
      const fr = new FileReader();
      fr.onload = () => onText(String(fr.result || ''));
      fr.onerror = () => onText(null, '读文件失败，请改用“存档文本”。');
      fr.readAsText(f);
    } catch (e) { onText(null, '读文件失败：' + String((e && e.message) || e)); }
  };
  wrap.appendChild(input);
  return wrap;
}

function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 忽略：复制失败不影响导出文本本身 */ }
  return false;
}

function renderArchiveSide() {
  const box = $('archive-side');
  if (!box) return;
  box.innerHTML = '';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'detail__eyebrow';
  eyebrow.textContent = 'Profile';
  const title = document.createElement('h3');
  title.className = 'detail__title';
  title.textContent = '你的证明档案';
  box.appendChild(eyebrow); box.appendChild(title);

  const p = save.profile();
  const rows = document.createElement('dl');
  rows.className = 'detail__rows';
  const pairs = [
    ['关卡', p.solvedCount + ' / ' + p.totalLevels + '（L0 ' + p.l0Solved + '/' + p.l0Total + ' · L1 ' + p.l1Solved + '/' + p.l1Total + '）'],
    ['零提示通关', p.noHintLevels + ' 关'],
    ['一气呵成', p.cleanLevels + ' 关'],
    ['累计落子', p.steps + ' 步'],
    ['提示 / 撤销 / 报错', p.hints + ' / ' + p.undos + ' / ' + p.errors],
    ['用过规则', p.rulesUsed + ' / ' + p.playableRules + ' 种'],
    ['最深子证明', p.maxScopeDepth + ' 层'],
    ['数学史', p.historyRead + ' / ' + p.historyTotal + ' 条'],
  ];
  for (const [k, v] of pairs) {
    const row = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    row.appendChild(dt); row.appendChild(dd);
    rows.appendChild(row);
  }
  box.appendChild(rows);

  /* 引导开关 */
  const prefs = save.readGuidePrefs();
  const gwrap = document.createElement('div');
  gwrap.className = 'guide-switch';
  const gb = document.createElement('button');
  gb.type = 'button';
  gb.className = 'btn btn--outline btn--block';
  gb.textContent = prefs.off ? '重新打开新手引导' : '关闭新手引导（不再自动弹出）';
  gb.onclick = () => { save.setGuideOff(!prefs.off); afterProfileChange(); };
  const gs = document.createElement('span');
  gs.className = 'guide-switch__state';
  gs.textContent = prefs.off ? '当前：已关闭' : '当前：开启（只对没看过的关卡弹）';
  gwrap.appendChild(gb); gwrap.appendChild(gs);
  const rb = document.createElement('button');
  rb.type = 'button';
  rb.className = 'btn btn--outline btn--block';
  rb.textContent = '回到证明台重看这一关的引导';
  rb.onclick = () => { setScreenNow('desk'); maybeStartGuide(true); };
  gwrap.appendChild(rb);
  box.appendChild(gwrap);

  /* 最接近解锁的成就 */
  const up = save.upcoming(4);
  if (up.length) {
    const h4 = document.createElement('span');
    h4.className = 'detail__eyebrow';
    h4.textContent = 'Next Achievements';
    box.appendChild(h4);
    const list = document.createElement('dl');
    list.className = 'detail__rows';
    for (const a of up) {
      const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = a.name;
      const dd = document.createElement('dd'); dd.textContent = a.desc + '（' + a.cur + ' / ' + a.max + '）';
      row.appendChild(dt); row.appendChild(dd);
      list.appendChild(row);
    }
    box.appendChild(list);
  }

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn--advanced btn--block';
  back.textContent = '返回证明选择';
  back.onclick = () => go('select');
  box.appendChild(back);
}

/* 被拒绝的一步：既要给出可读原因，也要记进档案（成就里有一条“错误是老师”） */
function refuse(msg, kind) {
  if (state) save.noteError(state.level.id);
  setStatus(msg, kind || 'bad');
  afterProfileChange();
}

/* ---------------- 自动存档：每一步都写一次现场 ----------------
   存档粒度是“每一关各推到哪儿了”，而不是只有一个全局现场：
   玩家在关卡索引里来回跳时，不该把别的关推到一半的东西弄丢。 */
function autosaveScene() {
  if (!state) return null;
  // 已经过关的关卡不必再留现场（下次进来是干净的，而不是一进去就“已完成”）
  const keep = matchedFact(state) ? null : sceneFromState(state);
  return save.noteScene(state.level.id, keep && !sceneIsEmpty(keep) ? keep : null);
}

/* 一份“完整存档”：当前全部进度 + 当前这一关的现场（已通关的关卡不留现场） */
function currentSave(name) {
  const solved = state ? !!matchedFact(state) : false;
  return makeSave({
    progress: save.snapshotAll(),
    scene: state && !solved ? sceneFromState(state) : null,
    lastLevel: state ? state.level.id : null,
    name: name || '',
  });
}

/* 把一份存档装进当前会话：进度覆盖，现场写进自动存档，然后跳到那一关 */
function applySaveToSession(sv) {
  save.applyProgress(sv.progress);
  const scene = sv.scene;
  const lvId = scene && scene.levelId && LEVELS.some((l) => l.id === scene.levelId) ? scene.levelId : null;
  if (lvId) save.noteScene(lvId, scene);
  afterProfileChange();
  if (lvId) {
    pickLevel(lvId);
    loadLevel(lvId);                      // loadLevel 会把刚写进去的现场装上
    go('desk');
  } else {
    renderSelect();
  }
  return { levelId: lvId, solved: sv.progress.done.length, ach: sv.progress.ach.length };
}

/* 导出成文件；不支持下载的环境（某些 file:// 场景）就退回到“复制文本” */
function downloadSave(sv) {
  const text = exportSaveText(sv);
  const name = saveFileName(sv);
  try {
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
      return { ok: false, error: '当前环境不支持直接下载文件，请用下面的“存档文本”复制保存。' };
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    if (typeof document !== 'undefined' && document.body && document.body.appendChild) {
      document.body.appendChild(a);
      if (typeof a.click === 'function') a.click();
      document.body.removeChild(a);
    } else if (typeof a.click === 'function') a.click();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }, 1000);
    return { ok: true, name };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/* ---------------- 走一步 ---------------- */
function useRule(rid) {
  const spec = RULES[rid];
  if (!spec) return;
  // 不用浏览器弹窗：由 candidates 模块算出所有成立的分支，再决定自动执行还是让玩家点选
  const cands = candidateSteps(state, rid, selected.slice());
  // 前提数量不对时，如果存在引导（例如“分情况讨论”），就先把引导给玩家看，
  // 只报“需要恰好 N 个前提”会让人卡住——他本来就需要先知道要开哪两支。
  if (spec.arity !== null && selected.length !== spec.arity) {
    if (cands.some((c) => c.guide)) { showChoices(rid, cands); return; }
    refuse('“' + spec.name + '”需要恰好 ' + spec.arity + ' 个前提，当前选了 ' + selected.length + ' 个。' + (spec.arity === 2 ? '（按住 Ctrl 可多选）' : ''), 'warn');
    return;
  }
  if (!cands.length) {
    const probe = tryStep(state, { rule: rid, ids: selected.slice() });
    refuse('这一步不成立：' + (probe.error || '没有可用的结果。先看看前提选对了没有。'));
    return;
  }
  // 引导型候选（例如分情况讨论的说明）不是可执行的步骤，要单独渲染
  if (cands.every((c) => c.guide)) { showChoices(rid, cands); return; }
  const steps = cands.filter((c) => c.step);
  if (steps.length === 1) { commit(steps[0].step); return; }
  const hit = pickGoalCandidate(state, steps, state.goal) || pickCaseSplitCandidate(state, steps, state.goal);
  if (hit) { commit(hit.step); return; }
  showChoices(rid, cands);
}

/* 把候选步骤渲染成一行可选择的结果 */
function showChoices(rid, cands, base) {
  const spec = RULES[rid];
  const box = $('choices');
  box.hidden = false;
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'choices__head';
  head.textContent = '“' + spec.name + '”有多种可能，点一个执行：';
  box.appendChild(head);
  // 引导型：把“每一支要推出什么”摆出来，并给一键“开始这一支”
  for (const c of cands.filter((x) => x.guide === 'caseSplit')) {
    const g = document.createElement('div');
    g.className = 'guide';
    g.innerHTML = '<div class="guide__head">' + escapeHtml(c.label) + '</div>';
    box.appendChild(g);
    for (const b of c.branches) {
      const row = document.createElement('div');
      row.className = 'branch' + (b.done ? ' branch--done' : '');
      row.innerHTML = '<span class="branch__mark cube">' + cubeInner(b.done ? '✓' : '·') + '</span><span>' + escapeHtml(b.text) + '</span>';
      if (!b.done) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--advanced';
        btn.textContent = '开始这一支：假设 ' + b.assume;
        btn.onclick = () => { hideChoices(); $('assume-input').value = b.assume; openAssumption(); };
        row.appendChild(btn);
      }
      g.appendChild(row);
    }
    const tip = document.createElement('div');
    tip.className = 'guide__tip';
    tip.textContent = '两支都合上后，再选中这个析取与两条结论一起点 ∨E 就能收尾。';
    g.appendChild(tip);
  }
  // 引导型：引入类规则（→I / ¬I / ⊥C）要先开子证明——直接告诉他假设什么，并能一键打开
  for (const c of cands.filter((x) => x.guide === 'intro')) {
    const g = document.createElement('div');
    g.className = 'guide';
    g.innerHTML = '<div class="guide__head">' + escapeHtml(c.label) + '</div>';
    const row = document.createElement('div');
    row.className = 'branch';
    row.innerHTML = '<span class="branch__mark cube">' + cubeInner('·') + '</span><span>子证明里要' + escapeHtml(c.need) + '</span>';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--advanced';
    btn.textContent = '开始：假设 ' + c.assume;
    btn.onclick = () => { hideChoices(); $('assume-input').value = c.assume; openAssumption(); };
    row.appendChild(btn);
    g.appendChild(row);
    if (c.hint) {
      const tip = document.createElement('div');
      tip.className = 'guide__tip';
      tip.textContent = c.hint;
      g.appendChild(tip);
    }
    box.appendChild(g);
  }
  for (const c of cands.filter((x) => x.step).slice(0, 16)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--outline';
    b.textContent = c.label;
    b.title = '结果：' + c.label;
    b.onclick = () => { hideChoices(); commit(c.step); };
    box.appendChild(b);
  }
  // 允许自己写一个结果式（例如中间步骤 -3 ≤ 0）
  const customInput = document.createElement('input');
  customInput.className = 'input';
  customInput.placeholder = '或者自己写结果式，回车确认';
  customInput.onkeydown = () => {};
  const customBtn = document.createElement('button');
  customBtn.type = 'button';
  customBtn.className = 'btn btn--outline';
  customBtn.textContent = '用我写的式子';
  customBtn.onclick = () => {
    const raw = (customInput.value || '').trim();
    if (!raw) { setStatus('请先在输入框里写出结果式。', 'warn'); return; }
    hideChoices();
    commit({ rule: rid, ids: selected.slice(), pick: base.pick, op: base.op, formula: raw });
  };
  box.appendChild(customInput);
  box.appendChild(customBtn);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--outline';
  cancel.textContent = '取消';
  cancel.onclick = () => { hideChoices(); setStatus('已取消这一步。', ''); };
  box.appendChild(cancel);
  setStatus('请在上方“候选结果”里选一个（' + cands.length + ' 种可能），也可以自己写结果式。', 'warn');
}
function hideChoices() { const b = $('choices'); b.hidden = true; b.innerHTML = ''; }

function commit(step) {
  hideChoices();
  try {
    const fact = applyStep(state, step);
    selected = [];
    hintIndex = 0;
    setStatus('✓ ' + P(fact.f) + '　（' + (RULES[fact.rule] ? RULES[fact.rule].name : fact.rule) + '）', 'ok');
    // 统计埋点：只有内核认下的步骤才算“落下的一步”
    save.noteStep(state.level.id, RULES[fact.rule] ? fact.rule : null);
    if (fact.rule === 'assume') save.noteScopeDepth((state.scopeStack || []).length);
    coach.notify(fact.rule === 'assume' ? 'assume' : 'step');   // 引导里等这个动作的步骤自动前进
    renderAll();
    autosaveScene();                    // 每落一步都写一次现场，随时关掉都能接着推
    afterProfileChange();
  } catch (e) {
    save.noteError(state.level.id);       // 被内核拒绝也是一次记录：成就里有“错误是老师”
    setStatus('✗ ' + (e instanceof RuleError ? e.message : String(e.message || e)), 'bad');
    afterProfileChange();
  }
}

/* ---------------- 假设 / 撤销 / 实例化 / 提示 ---------------- */
function openAssumption() {
  const raw = $('assume-input').value.trim();
  if (!raw) { setStatus('请先写出要假设的式子，例如 A 或 not B。', 'warn'); return; }
  commit({ assume: raw });
  $('assume-input').value = '';
}

function doUndo() {
  const last = undo(state);
  if (!last) { setStatus('没有可撤销的步骤。', 'warn'); return; }
  save.noteUndo(state.level.id);
  selected = [];
  setStatus('已撤销一步：' + P(last.f), '');
  renderAll();
  autosaveScene();
  afterProfileChange();
}

function doInstantiate() {
  const created = instantiateAxioms(state, 400);
  if (created.length) save.noteInstantiate();
  setStatus(created.length ? '自动实例化了 ' + created.length + ' 条公理实例，已放进上面的“可用事实”。' : '没有新的可实例化公理（可能已经展开过）。', created.length ? 'ok' : 'warn');
  renderAll();
  if (created.length) { autosaveScene(); afterProfileChange(); }
}

function doHint() {
  const lv = state.level;
  if (matchedFact(state)) { setStatus('这一关已经完成啦，可以点左边继续下一关。', 'ok'); return; }
  // 提示来源：优先手写标准证明，没有就用解算器自动搜到的证明
  const found = FOUND_PROOFS[lv.id];
  const plan = (lv.script && !lv.noScript) ? lv.script : (found ? found.steps : null);
  const fromSolver = !(lv.script && !lv.noScript) && !!found;
  if (!plan) {
    setStatus('本题是开放练习，解算器也还没搜出证明。' + (lv.scriptNote || '') + '　建议：先“展开全称公理”，再用 ∀E 与 →E 逐步推进。', 'warn');
    return;
  }
  const step = plan[hintIndex];
  if (!step) {
    setStatus('提示已经用完了。' + (lv.scriptNote || ''), 'warn');
    return;
  }
  const tag = fromSolver ? '（自动搜出的证明）' : '';
  setStatus('提示 ' + (hintIndex + 1) + '/' + plan.length + tag + '：' + describeStep(step), 'warn');
  hintIndex++;
  save.noteHint(lv.id);
  afterProfileChange();
}

function describeStep(step) {
  if (step.assume !== undefined) return '打开子证明，假设 ' + step.assume;
  const spec = RULES[step.rule];
  const ids = (step.ids || []).join(', ');
  const extra = [
    step.term ? '项 ' + step.term : '',
    step.pick ? '选择 ' + step.pick : '',
    step.formula ? '结果式 ' + step.formula : '',
    step.op ? '运算 ' + step.op.name + (step.op.n !== undefined ? ' ' + step.op.n : '') : '',
  ].filter(Boolean).join('，');
  return '选 ' + (ids || '（无前提）') + ' → 点“' + (spec ? spec.name : step.rule) + '”' + (extra ? '（' + extra + '）' : '');
}

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  const box = $('status-box');
  if (box) box.className = 'notice' + (kind === 'ok' ? ' notice--ok' : kind === 'bad' ? ' notice--bad' : kind === 'warn' ? ' notice--warn' : '');
  const code = $('status-code');
  if (code) code.textContent = kind === 'ok' ? 'PRTS / OK' : kind === 'bad' ? 'PRTS / ERR' : kind === 'warn' ? 'CAUTION' : 'RI / INFO';
}

function onSolved() {
  const id = state.level.id;
  const first = store.mark(id);      // 内部会盖章 noHint / clean 并把 id 写进 lpg.done
  if (first) {
    setStatus('完成 ' + id + '！结论已推出：' + P(state.goal), 'ok');
    coach.notify('solved');          // 引导里等“过关”的步骤自动收尾
  }
  save.noteScene(id, null);          // 过关了就不必再留现场，下次进来是干净的
  renderLevelList();
  renderDone();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 事件绑定 ---------------- */
$('btn-assume').onclick = openAssumption;
$('assume-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') openAssumption(); });
$('btn-undo').onclick = doUndo;
$('btn-instantiate').onclick = doInstantiate;
$('btn-hint').onclick = doHint;
$('btn-guide').onclick = () => {
  const started = maybeStartGuide(true);
  if (!started) setStatus('这一关暂时没有可用的引导步骤。', 'warn');
};
const doReset = () => {
  store.reset();
  coach.stop();
  renderLevelList();
  renderSelect();
  afterProfileChange();
  setStatus('本地进度、统计与成就已全部清空。', '');
};
$('btn-reset').onclick = doReset;
$('btn-reset-desk').onclick = doReset;
$('btn-axioms').onclick = () => { const a = $('axioms'); a.hidden = !a.hidden; };
/* 重开本关：自动存档会把现场带回来，所以必须给一个“清掉现场、从第一步重来”的出口 */
let restartArmed = false;
let restartTimer = null;
const disarmRestart = () => {
  restartArmed = false;
  clearTimeout(restartTimer);
  const b = $('btn-restart');
  b.textContent = '重开本关';
  b.className = 'btn btn--outline';
};
$('btn-restart').onclick = () => {
  if (matchedFact(state)) { setStatus('这一关已经完成了，不用重开。', 'warn'); return; }
  if (!restartArmed) {
    restartArmed = true;
    const b = $('btn-restart');
    b.textContent = '再点一次：清空本关现场';
    b.className = 'btn btn--outline is-armed';
    clearTimeout(restartTimer);
    restartTimer = setTimeout(disarmRestart, 4000);
    return;
  }
  disarmRestart();
  const id = state.level.id;
  save.noteScene(id, null);
  loadLevel(id);
  setStatus('已清空 ' + id + ' 推到一半的现场，从第一步重来。', 'warn');
  afterProfileChange();
};
$('btn-history').onclick = () => {
  historyOpen = !historyOpen;
  renderHistoryCard();
  if (historyOpen) {
    // 展开就算读过：史话阅读进度与成就都记在这里
    save.markHistoriesRead(historyForLevel(state.level.id).map((h) => h.id));
    afterProfileChange();
  }
};

/* 屏幕之间的跳转（全部走斜向擦除过渡） */
/* 存档入口：档案室的「存档」分页在三个顶栏与证明台上都有直达按钮，
   免得玩家根本不知道有这个功能。 */
function goArchive(tab) {
  if (tab) {
    if (tab !== archiveTab) saveNotice = null;
    archiveTab = tab;
  }
  go('archive');
}
$('btn-start').onclick = () => { pickLevel(state.level.id); go('select'); };
$('nav-start').onclick = () => go('start');
$('nav-select').onclick = () => go('select');
$('nav-back').onclick = () => go('select');
$('btn-done-select').onclick = () => go('select');
$('btn-start-archive').onclick = () => goArchive('ach');
$('nav-archive').onclick = () => goArchive('ach');
$('nav-archive-desk').onclick = () => goArchive('ach');
$('nav-save').onclick = () => goArchive('save');
$('nav-save-desk').onclick = () => goArchive('save');
$('btn-saves').onclick = () => goArchive('save');
$('nav-levels-archive').onclick = () => go('select');
$('nav-start-archive').onclick = () => go('start');
$('btn-next').onclick = () => {
  const i = LEVELS.findIndex((l) => l.id === state.level.id);
  const next = LEVELS[i + 1];
  if (!next) { go('select'); return; }
  pickLevel(next.id);
  loadLevel(next.id);
  setStatus('已载入 ' + next.id + '：' + next.title + '。', '');
};

/* ---------------- 测试钩子（供无浏览器冒烟测试调用） ---------------- */
export function debugState() { return state; }
export function debugLevelId() { return state && state.level.id; }
export function debugGoalText() { return $('goal-text').textContent; }
export function debugStatusText() { return $('status').textContent; }
export function debugSolved() { return !!matchedFact(state); }
export function debugSelect(ids) { selected = ids.slice(); renderFacts(); }
export function debugUseRule(rid) { useRule(rid); }
export function debugAssumption(raw) { $('assume-input').value = raw; openAssumption(); }
export function debugHint() { doHint(); }
export function debugScreen() { return screen; }
export function debugGo(name) { setScreenNow(name); }        // 瞬间切换，不给过渡
export function debugNavigate(name) { go(name); }             // 走真实的过渡路径
/* 走“界面的真实路径”：设置选择 → useRule（含候选计算与自动挑选） */
export function debugSelectAndUse(ids, rid) {
  selected = ids.slice();
  renderFacts();
  useRule(rid);
  return debugStatusText();
}
/* 当前可见的事实（id → 公式文本） */
export function debugFacts() {
  return visibleFacts(state).map((f) => ({ id: f.id, text: P(f.f), rule: f.rule, scope: f.scope }));
}
/* 当前打开的子证明层数 */
export function debugScopes() { return (state.scopeStack || []).slice(); }
/* 当前候选（不执行） */
export function debugCandidates(ids, rid) {
  return candidateSteps(state, rid, ids.slice()).map((c) => c.label);
}
/* 候选里有没有“引导型”（分情况讨论 / 开子证明的说明） */
export function debugGuides(ids, rid) {
  return candidateSteps(state, rid, ids.slice())
    .filter((c) => c.guide)
    .map((c) => ({
      guide: c.guide,
      label: c.label,
      assume: c.assume,
      need: c.need,
      branches: (c.branches || []).map((b) => b.text),
    }));
}
/* 候选面板里渲染出来的按钮文字（走的是真实渲染路径） */
export function debugChoiceButtons() {
  const box = $('choices');
  if (!box) return [];
  const out = [];
  const walk = (el) => {
    if (!el) return;
    if (el.tagName === 'BUTTON') out.push(el.textContent || '');
    for (const c of el.children || []) walk(c);
  };
  walk(box);
  return out;
}
/* 可用事实面板里的文字（含空状态提示） */
export function debugFactsText() {
  const box = $('facts');
  if (!box) return '(没有 facts 容器)';
  const out = [];
  const walk = (el, d) => {
    if (!el || d > 5) return;
    out.push('  '.repeat(d) + (el.tagName || '?') + (el.className ? '.' + el.className : '') + ' :: ' + (el.textContent || el._html || ''));
    for (const c of el.children || []) walk(c, d + 1);
  };
  walk(box, 0);
  return out.join('\n');
}

/* 候选面板里的文字内容（诊断用） */
export function debugChoicesText() {
  const box = $('choices');
  if (!box) return '(没有 choices 容器)';
  const out = [];
  const walk = (el, d) => {
    if (!el || d > 5) return;
    out.push('  '.repeat(d) + (el.tagName || '?') + (el.className ? '.' + el.className : '') + ' :: ' + (el.textContent || el._html || ''));
    for (const c of el.children || []) walk(c, d + 1);
  };
  walk(box, 0);
  return out.join('\n');
}

/* 点击候选面板里第 i 个按钮 */
export function debugClickChoice(i) {
  const box = $('choices');
  const btns = [];
  const walk = (el) => {
    if (!el) return;
    if (el.tagName === 'BUTTON') btns.push(el);
    for (const c of el.children || []) walk(c);
  };
  walk(box);
  const b = btns[i];
  if (!b) return false;
  if (b.onclick) b.onclick();
  return true;
}
export function debugDescribe(step) { return describeStep(step); }
export { loadLevel };

/* ---------------- 新手引导 / 成就 / 数学史的测试钩子 ---------------- */
export function debugGuide() { return coach.state(); }
export function debugGuideStart(force) { return maybeStartGuide(force !== false); }
export function debugGuideNext() { return coach.next(); }
export function debugGuidePrev() { return coach.prev(); }
export function debugGuideSkip() { return coach.skip(); }
export function debugGuideStop() { return coach.stop(); }
export function debugGuideFinish() { return coach.finish(); }
export function debugGuideNotify(kind) { return coach.notify(kind); }
/* 一关的引导清单（不带全景导览）：只把测试关心的字段挑出来 */
export function debugGuideSteps(levelId) {
  const lv = LEVELS.find((l) => l.id === levelId) || state.level;
  return coach.guideListFor(lv, { withTour: false }).map((s) => ({
    id: s.id, title: s.title, text: s.text || '', target: s.target || null,
    advance: s.advance || 'next', history: s.history || null,
  }));
}
export function debugProfile() { return save.profile(); }
export function debugAchievements() { return save.achievements(); }
export function debugUnlocked() { return save.achievements().filter((a) => a.unlocked).map((a) => a.id); }
/* 存档分页的 tab 切换：清掉上一次的提示，免得旧消息挂在新页面上 */
export function debugArchiveTab(tab) {
  if (tab) {
    if (tab !== archiveTab) saveNotice = null;
    archiveTab = tab;
    renderArchive();
  }
  return archiveTab;
}
export function debugArchive() { renderArchive(); return $('archive-body'); }
export function debugMarkHistory(id) { save.markHistoryRead(id); afterProfileChange(); }
export function debugGuidePrefs() { return save.readGuidePrefs(); }
export function debugSetGuideOff(off) { save.setGuideOff(off); afterProfileChange(); }
export function debugHistoryOpen(ids) { archiveOpen.clear(); for (const id of ids || []) archiveOpen.add(id); }
export function debugDone() { return save.readDone(); }
export function debugStats() { return save.readStats(); }
/* ---- 存档相关 ---- */
export function debugAutoSave() { return describeAutoSave(save.readAutoSave()); }
export function debugAutoScenes() { const a = save.readAutoSave(); return a.scenes; }
export function debugSlots() { return save.readSlots().map((s) => (s ? describeSave(s) : null)); }
export function debugSaveText() { return exportSaveText(currentSave()); }
export function debugImport(text) { doImport(text); return saveNotice ? saveNotice.text : ''; }
export function debugSaveToSlot(i) { save.writeSlot(i, currentSave('测试存档')); afterProfileChange(); return true; }
export function debugLoadSlot(i) { doLoadSlot(i); return saveNotice ? saveNotice.text : ''; }
export function debugClearAuto() { save.clearAutoSave(); afterProfileChange(); }
export function debugSaveNotice() { return saveNotice; }
export function debugBootLevel() { return bootLevelId(); }
/* 提示条上的文字：真实 DOM 里 textContent 就够了；打桩环境里 setInnerHTML 的内容
   只落在 _html 上，所以两个都读，测试才看得到内容。 */
export function debugToasts() {
  const box = $('toasts');
  if (!box) return [];
  return (box.children || []).map((c) => String(c.textContent || '') + String(c._html || ''));
}

/* 启动时该进哪一关：自动存档里最后动过、且还留着现场的那一关；
   都没有就从第一关开始。 */
function bootLevelId() {
  const id = describeAutoSave(save.readAutoSave()).lastLevel;
  return id && LEVELS.some((l) => l.id === id) ? id : LEVELS[0].id;
}

loadLevel(bootLevelId());
applyHash();
