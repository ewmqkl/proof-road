// ui/tutorial.js —— 新手引导的运行时：教练浮标 + 高亮 + 可跳过
// 设计取舍：
//   · 遮罩不拦截点击（pointer-events: none），玩家在引导期间照样能操作证明台；
//     高亮靠给目标元素加一圈“巨大外阴影”做聚光，目标本身抬到遮罩之上。
//   · 步骤可以要求“做了这个动作再继续”（advance: step / assume / solved）：
//     app.js 在相应时机调 notify()，引导自动前进；不想做也可以直接点“下一步”。
//   · 任何一步都能点“跳过引导”退出，退出后由 app.js 记进档案，不再自动弹出。
// 这一层从不接触证明状态，只读步骤数据、只动自己的 DOM，所以内核与测试都不受影响。

import { fullGuide, DESK_TOUR } from '../data/tutorial.js';
import { HISTORY_BY_ID } from '../data/math-history.js';

const $ = (id) => {
  try { return typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null; }
  catch (e) { return null; }
};

let steps = [];
let index = 0;
let active = false;
let meta = { levelId: null, tour: false, tourLen: 0 };
let hooks = { onHistory: null, onComplete: null, onSkip: null, onChange: null };
let highlighted = null;

export function configure(next = {}) { hooks = { ...hooks, ...next }; }
export function isActive() { return active; }
export function stepCount() { return steps.length; }
export function stepIndex() { return index; }

/** 供测试与界面查看的当前状态。 */
export function state() {
  const s = steps[index] || null;
  return {
    active, index, total: steps.length, levelId: meta.levelId,
    tour: meta.tour, tourLen: meta.tourLen,
    id: s ? s.id : null, title: s ? s.title : '', text: s ? s.text : '',
    action: s ? (s.action || '') : '', target: s ? (s.target || null) : null,
    history: s ? (s.history || null) : null,
    advance: s ? (s.advance || 'next') : 'next',
    canPrev: index > 0, canNext: index < steps.length - 1,
    atLast: index === steps.length - 1,
  };
}

function addClass(el, cls) {
  if (!el) return;
  try {
    if (el.classList && typeof el.classList.add === 'function') { el.classList.add(cls); return; }
    const cur = String(el.className || '');
    if (cur.split(/\s+/).indexOf(cls) < 0) el.className = (cur ? cur + ' ' : '') + cls;
  } catch (e) { /* 打桩环境里忽略 */ }
}
function removeClass(el, cls) {
  if (!el) return;
  try {
    if (el.classList && typeof el.classList.remove === 'function') { el.classList.remove(cls); return; }
    el.className = String(el.className || '').split(/\s+/).filter((c) => c && c !== cls).join(' ');
  } catch (e) { /* 忽略 */ }
}

function clearHighlight() {
  if (highlighted) { removeClass(highlighted, 'coach-target'); highlighted = null; }
}

/** 把聚光打到某个元素上；找不到元素就退化成居中卡片。 */
function highlight(targetId) {
  clearHighlight();
  const dim = $('coach-dim');
  const el = targetId ? $(targetId) : null;
  if (!el) { if (dim) dim.hidden = false; return null; }
  addClass(el, 'coach-target');
  highlighted = el;
  if (dim) dim.hidden = true;             // 由目标元素的巨大外阴影负责压暗其余部分
  try {
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch (e) { /* 打桩环境里忽略 */ }
  return el;
}

/* 把卡片摆到目标附近；拿不到几何信息（打桩环境）就居中。 */
function placeCard(el, place) {
  const card = $('coach-card');
  if (!card) return;
  const style = card.style || (card.style = {});
  const noGeom = !el || typeof el.getBoundingClientRect !== 'function';
  if (noGeom) {
    style.cssText = '';
    addClass(card, 'coach__card--center');
    return;
  }
  removeClass(card, 'coach__card--center');
  let r = null;
  try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
  if (!r || (!r.width && !r.height)) { addClass(card, 'coach__card--center'); style.cssText = ''; return; }
  let vw = 1200, vh = 800;
  try {
    if (typeof window !== 'undefined' && window.innerWidth) { vw = window.innerWidth; vh = window.innerHeight; }
  } catch (e) { /* 忽略 */ }
  const W = Math.min(420, vw - 24);
  const gap = 14;
  const wantTop = place === 'top';
  let left = r.left + r.width / 2 - W / 2;
  left = Math.max(12, Math.min(left, vw - W - 12));
  const estH = 236;
  let top = wantTop ? r.top - estH - gap : r.bottom + gap;
  if (top < 12) top = r.bottom + gap;                       // 上方放不下就翻到下面
  if (top + estH > vh - 12) top = Math.max(12, r.top - estH - gap);
  style.cssText = 'left:' + Math.round(left) + 'px;top:' + Math.round(top) + 'px;width:' + Math.round(W) + 'px;';
}

function renderDots() {
  const box = $('coach-dots');
  if (!box) return;
  try { box.innerHTML = ''; } catch (e) { return; }
  for (let i = 0; i < steps.length; i++) {
    const d = document.createElement('span');
    d.className = 'coach__dot' + (i === index ? ' is-now' : (i < index ? ' is-past' : ''));
    box.appendChild(d);
  }
  if (steps.length > 12) {
    const n = document.createElement('span');
    n.className = 'coach__dotnum';
    n.textContent = (index + 1) + ' / ' + steps.length;
    box.appendChild(n);
  }
}

function renderStep() {
  const s = steps[index];
  const box = $('coach');
  if (!box || !s) return;
  box.hidden = false;
  active = true;

  const stepEl = $('coach-step');
  if (stepEl) stepEl.textContent = (meta.tour && index < meta.tourLen ? '导览 ' : '引导 ') + (index + 1) + ' / ' + steps.length;
  const titleEl = $('coach-title');
  if (titleEl) titleEl.textContent = s.title || '';
  const textEl = $('coach-text');
  if (textEl) textEl.textContent = s.text || '';

  const act = $('coach-action');
  if (act) {
    act.hidden = !s.action;
    act.textContent = s.action ? '要做的事：' + s.action : '';
  }

  const hist = $('coach-hist');
  if (hist) {
    const h = s.history ? HISTORY_BY_ID[s.history] : null;
    hist.hidden = !h;
    if (h) {
      hist.textContent = '史话 · ' + h.year + '　' + h.title + '（' + h.people + '）';
      if (hooks.onHistory) { try { hooks.onHistory(h.id); } catch (e) { /* 忽略 */ } }
    }
  }

  const el = highlight(s.target);
  placeCard(el, s.place || 'bottom');
  renderDots();

  const prev = $('coach-prev');
  if (prev) prev.disabled = index <= 0;
  const next = $('coach-next');
  if (next) next.textContent = index === steps.length - 1 ? '完成引导' : '下一步';

  if (hooks.onChange) { try { hooks.onChange(state()); } catch (e) { /* 忽略 */ } }
}

/* ---------------- 对外控制 ---------------- */
export function start(list, options = {}) {
  const stepsIn = (list || []).filter(Boolean);
  if (!stepsIn.length) return false;
  steps = stepsIn;
  index = 0;
  meta = {
    levelId: options.levelId || null,
    tour: !!options.tour,
    tourLen: options.tourLen || 0,
  };
  renderStep();
  return true;
}

/** 按关卡起引导：包含全景导览（可选）+ 本关分步说明。 */
export function startForLevel(level, options = {}) {
  const withTour = options.withTour !== false;
  const list = fullGuide(level, { withTour, goalText: options.goalText });
  return start(list, { levelId: level.id, tour: withTour, tourLen: withTour ? DESK_TOUR.length : 0 });
}

/** 只取清单，不起引导（测试与“本关引导”按钮预览用）。 */
export function guideListFor(level, options = {}) {
  return fullGuide(level, { withTour: !!options.withTour, goalText: options.goalText });
}

export function next() {
  if (!active) return false;
  if (index >= steps.length - 1) { finish(); return false; }
  index++;
  renderStep();
  return true;
}
export function prev() {
  if (!active || index <= 0) return false;
  index--;
  renderStep();
  return true;
}

/** 正常走完引导。 */
export function finish() {
  const m = { ...meta, index, total: steps.length };
  stop();
  if (hooks.onComplete) { try { hooks.onComplete(m); } catch (e) { /* 忽略 */ } }
  return true;
}

/** 主动跳过。 */
export function skip() {
  const m = { ...meta, index, total: steps.length, skipped: true };
  stop();
  if (hooks.onSkip) { try { hooks.onSkip(m); } catch (e) { /* 忽略 */ } }
  return true;
}

/** 收起引导（不改档案、不回调）。 */
export function stop() {
  active = false;
  clearHighlight();
  const box = $('coach');
  if (box) box.hidden = true;
  const dim = $('coach-dim');
  if (dim) dim.hidden = true;
  if (hooks.onChange) { try { hooks.onChange(state()); } catch (e) { /* 忽略 */ } }
}

/**
 * 事件通知：当前步骤若在等这个动作，就自动前进。
 * kind ∈ 'step' | 'assume' | 'solved' | 'select'
 */
export function notify(kind) {
  if (!active) return false;
  const s = steps[index];
  if (!s) return false;
  const want = s.advance || 'next';
  if (want !== kind) return false;
  if (index >= steps.length - 1) { finish(); return true; }
  index++;
  renderStep();
  return true;
}

/** 绑定浮标上的按钮与键盘（缺 DOM 就打桩跳过）。 */
export function bind() {
  const on = (id, fn) => {
    const el = $(id);
    if (el && typeof el === 'object') el.onclick = fn;
  };
  on('coach-next', () => { if (index >= steps.length - 1) finish(); else next(); });
  on('coach-prev', prev);
  on('coach-skip', skip);
  on('coach-close', skip);
  try {
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('keydown', (e) => {
        if (!active || !e || !e.key) return;
        if (e.key === 'Escape') skip();
        else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (index >= steps.length - 1) finish(); else next(); }
        else if (e.key === 'ArrowLeft') prev();
      });
    }
  } catch (e) { /* 忽略 */ }
}
