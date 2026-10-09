// tests/ui-guide.test.mjs —— 界面层集成：新手引导、成就触发、档案室、数学史
// 这里走的是「真实界面路径」：点按钮、点规则、点引导浮标，而不是直接调内核。
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { installDom, clearStorage, flatten, clickButton } from './_dom.mjs';

const { registry } = installDom();
const app = await import('../src/ui/app.js');
const { DESK_TOUR, LEVEL_GUIDES, guideForLevel } = await import('../src/data/tutorial.js');
const { ACHIEVEMENTS } = await import('../src/data/achievements.js');
const { HISTORY } = await import('../src/data/math-history.js');

/* 全新玩家：清空存档，载入某一关并真正走进证明台 */
function fresh(levelId) {
  clearStorage();
  app.debugGuideStop();
  app.loadLevel(levelId);
  app.debugGo('desk');
}
const el = (id) => registry.get(id);
const prefs = () => app.debugGuidePrefs();

test('首次进入证明台：自动弹出「全景导览 + 本关引导」', () => {
  fresh('L0-01');
  const g = app.debugGuide();
  assert.equal(g.active, true, '首次进证明台应当自动起引导');
  assert.equal(g.tour, true, '第一次应当带上全景导览');
  assert.equal(g.total, DESK_TOUR.length + LEVEL_GUIDES['L0-01'].length, '总步数应当是导览 + 本关引导');
  assert.ok(g.title.length > 0, '浮标应当有标题');
  assert.ok(g.text.length > 0, '浮标应当有正文');
  // 浮标上三个按钮都要接好（打桩环境里读不到 index.html 的按钮文案，所以查绑定）
  assert.equal(typeof el('coach-next').onclick, 'function', '“下一步”应当已接线');
  assert.equal(typeof el('coach-prev').onclick, 'function', '“上一步”应当已接线');
  assert.equal(typeof el('coach-skip').onclick, 'function', '“跳过引导”应当已接线');
  assert.equal(el('coach-prev').disabled, true, '第一步的“上一步”应当禁用');
});

test('浮标按钮：下一步 / 上一步 / 跳过都真的生效', () => {
  fresh('L0-01');
  assert.equal(app.debugGuide().index, 0);
  assert.equal(app.debugGuidePrev(), false, '第一步没有上一步');
  assert.equal(app.debugGuideNext(), true);
  assert.equal(app.debugGuide().index, 1);
  assert.equal(app.debugGuidePrev(), true);
  assert.equal(app.debugGuide().index, 0);
  // 走到底：最后一步点“完成引导”应当收尾
  const total = app.debugGuide().total;
  for (let i = 0; i < total; i++) app.debugGuideNext();
  assert.equal(app.debugGuide().active, false, '走完应当自动收起');
  assert.equal(prefs().done.length, 1, '走完应当记进“看完过”的清单');
  assert.ok(prefs().tour, '走完导览后应当记住导览看过了');
});

test('跳过引导：立刻收起，且这一关不再自动弹，但可以手动重看', () => {
  fresh('L0-01');
  assert.equal(app.debugGuideSkip(), true);
  assert.equal(app.debugGuide().active, false, '跳过后应当收起');
  assert.deepEqual(prefs().skipped, ['L0-01'], '应当记下跳过的关卡');
  assert.ok(prefs().tour, '跳过导览后也不该再弹导览');

  // 再进这一关：不该自动弹
  app.debugGo('select');
  app.debugGo('desk');
  assert.equal(app.debugGuide().active, false, '跳过过的关卡不该自动再弹');

  // 手动点“本关引导”还能看
  const started = app.debugGuideStart(true);
  assert.equal(started, true, '“本关引导”应当能重新打开');
  assert.equal(app.debugGuide().tour, false, '手动重看时不再重复全景导览');
  assert.equal(app.debugGuide().total, LEVEL_GUIDES['L0-01'].length);
});

test('引导里带史话的步骤会把它标成已读，并解锁对应成就', () => {
  fresh('L0-01');
  app.debugGuideSkip();                       // 先跳过（顺带清掉导览）
  assert.ok(app.debugUnlocked().indexOf('a-hist-1') < 0, '还没读史话就不该有这条成就');
  app.debugGuideStart(true);                  // 本关第一步就带《几何原本》的史话
  const g = app.debugGuide();
  assert.equal(g.history, 'H-EUCLID', 'L0-01 的第一步应当带《几何原本》史话：' + JSON.stringify(g));
  assert.ok(el('coach-hist').textContent.indexOf('几何原本') >= 0, '浮标上应当显示史话：' + el('coach-hist').textContent);
  assert.equal(el('coach-hist').hidden, false, '带史话的步骤应当把史话条露出来');
  assert.ok(app.debugUnlocked().indexOf('a-hist-1') >= 0, '读过史话应当解锁“读史使人明智”');
  assert.ok(app.debugToasts().some((t) => /读史使人明智/.test(t)), '应当弹出成就提示：' + JSON.stringify(app.debugToasts()));
});

test('行动式引导：打开子证明 / 落下一步会推动引导前进', () => {
  fresh('L0-02');
  app.debugGuideSkip();
  app.debugGuideStart(true);                  // 只看 L0-02 的引导
  const before = app.debugGuide().index;
  // L0-02 引导的第 3 步（下标 2）在等“打开子证明”
  while (app.debugGuide().advance !== 'assume' && app.debugGuide().active) app.debugGuideNext();
  assert.equal(app.debugGuide().advance, 'assume', 'L0-02 引导里应当有一步在等“打开假设”');
  const idx = app.debugGuide().index;
  app.debugAssumption('A');                   // 走真实路径打开假设
  assert.notEqual(app.debugGuide().index, idx, '打开假设后引导应当前进');
  // 再往后走一步：引用前提会推进 advance === 'step' 的那一步
  while (app.debugGuide().active && app.debugGuide().advance !== 'step') app.debugGuideNext();
  if (app.debugGuide().active) {
    const i2 = app.debugGuide().index;
    const h = app.debugFacts().find((f) => f.rule === 'assume');
    app.debugSelectAndUse([h.id], 'hyp');
    assert.notEqual(app.debugGuide().index, i2, '落下一步后引导应当前进');
  }
});

test('不看提示通关：记进统计并解锁“第一次不看提示 / 一气呵成”', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugSelect(['p1']);
  app.debugUseRule('hyp');
  assert.ok(app.debugSolved(), 'L0-01 应当一步通关');
  assert.deepEqual(app.debugDone(), ['L0-01'], '进度应当已记录');
  const ids = app.debugUnlocked();
  assert.ok(ids.indexOf('a-first') >= 0, '应当解锁“踏上证明之路”：' + ids.join(','));
  assert.ok(ids.indexOf('a-nohint-1') >= 0, '应当解锁“第一次不看提示”');
  assert.ok(ids.indexOf('a-clean-1') >= 0, '应当解锁“一气呵成”');
  assert.ok(ids.indexOf('a-hint') < 0, '没用过提示就不该有提示成就');
  const st = app.debugStats()['L0-01'];
  assert.equal(st.hints, 0);
  assert.equal(st.errors, 0);
  assert.equal(st.attSteps, 1, '本次尝试只落了一步');
  assert.ok(st.noHint && st.clean, '应当在通关时盖章');
});

test('用过提示会记账：解锁提示成就，并且这一关不再算“零提示”', () => {
  fresh('L0-13');
  app.debugGuideSkip();
  app.debugHint();
  assert.ok(/提示 1\//.test(app.debugStatusText()), '提示应当给出第一步：' + app.debugStatusText());
  assert.ok(app.debugUnlocked().indexOf('a-hint') >= 0, '应当解锁“提示是工具”');
  assert.equal(app.debugStats()['L0-13'].hints, 1);
  const p = app.debugProfile();
  assert.equal(p.noHintLevels, 0, '刚提示过，还没有零提示通关的关卡');
});

test('撤销与被拒绝的步骤都记进统计，并能解锁“错误是老师”', () => {
  fresh('L0-13');
  app.debugGuideSkip();
  for (let i = 0; i < 22; i++) { app.debugSelect([]); app.debugUseRule('hyp'); }
  const p1 = app.debugProfile();
  assert.ok(p1.errors >= 22, '被拒绝的步骤应当累计：' + p1.errors);
  assert.ok(app.debugUnlocked().indexOf('a-err-20') >= 0, '应当解锁“错误是老师”');
  // 撤销：先落一步，再用“撤销一步”把它撤掉
  app.debugSelect(['p1']);
  app.debugUseRule('hyp');                     // 引用前提 p1，得到一条新事实
  app.debugAssumption('A');
  el('btn-undo').onclick();
  const p2 = app.debugProfile();
  assert.equal(p2.undos, 1, '撤销应当被记录');
  assert.equal(app.debugScopes().length, 0, '撤销掉的应当是刚才那层假设');
});

test('子证明层数会被记录（三层嵌套成就）', () => {
  fresh('L0-10');
  app.debugGuideSkip();
  app.debugAssumption('not B');
  app.debugAssumption('A');
  const p = app.debugProfile();
  assert.equal(p.maxScopeDepth, 2, '应当记录到 2 层');
  assert.ok(app.debugUnlocked().indexOf('a-deep-3') < 0, '两层还拿不到三层成就');
  app.debugAssumption('C');
  const p3 = app.debugProfile();
  assert.equal(p3.maxScopeDepth, 3);
  assert.ok(app.debugUnlocked().indexOf('a-deep-3') >= 0, '三层子证明应当解锁“三层嵌套”');
});

test('规则使用会被累计：→E 用过就解锁假言推理', () => {
  fresh('L0-03');
  app.debugGuideSkip();
  assert.ok(app.debugUnlocked().indexOf('a-impE') < 0, '还没用过 →E');
  app.debugSelect(['p1', 'p2']);
  app.debugUseRule('impE');
  assert.ok(app.debugSolved(), 'L0-03 应当通关');
  assert.ok(app.debugUnlocked().indexOf('a-impE') >= 0, '应当解锁“假言推理”');
  assert.ok(app.debugProfile().rulesUsed >= 1);
});

test('“展开全称公理”会被记录并解锁对应成就', () => {
  fresh('L1-04');
  app.debugGuideSkip();
  el('btn-instantiate').onclick();
  assert.ok(app.debugUnlocked().indexOf('a-instantiate') >= 0, '应当解锁“展开公理”');
  assert.ok(app.debugProfile().instantiate >= 1);
});

test('证明台上的史话卡：展开即记为已读', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  const card = el('history-card');
  assert.equal(card.hidden, true, '默认应当是收起的');
  assert.ok(flatten(el('btn-history')).indexOf('这一关的来历') >= 0);
  el('btn-history').onclick();
  assert.equal(card.hidden, false, '点一下应当展开');
  const text = flatten(card);
  assert.ok(text.indexOf('几何原本') >= 0, '史话卡应当有《几何原本》：' + text.slice(0, 300));
  assert.ok(text.indexOf('欧几里得') >= 0, '史话卡应当写出人物');
  assert.ok(text.indexOf('公元前 300 年') >= 0, '史话卡应当写出年份');
  assert.ok(app.debugUnlocked().indexOf('a-hist-1') >= 0, '展开史话卡应当算作已读');
});

test('档案室：成就分页渲染出全部成就卡，并按分组归类', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugGo('archive');
  app.debugArchiveTab('ach');
  // 分页标签上写着“成就”
  assert.ok(flatten(el('archive-tabs')).indexOf('成就') >= 0, '分页标签应当有“成就”');
  const text = flatten(el('archive-body'));
  assert.ok(text.indexOf('已解锁') >= 0, '应当有总进度：' + text.slice(0, 200));
  for (const a of ACHIEVEMENTS.slice(0, 6)) {
    assert.ok(text.indexOf(a.name) >= 0, '成就卡里缺少 ' + a.name);
  }
  assert.ok(text.indexOf('推进战绩') >= 0, '应当有分组标题');
  assert.ok(text.indexOf('数学史') >= 0, '应当有数学史分组');
  // 侧栏：档案统计 + 引导开关
  const side = flatten(el('archive-side'));
  assert.ok(side.indexOf('你的证明档案') >= 0, '侧栏应当有档案统计');
  assert.ok(side.indexOf('累计落子') >= 0, '侧栏应当有落子统计');
  assert.equal(app.debugAchievements().length, ACHIEVEMENTS.length);
});

test('档案室：数学史分页渲染出全部条目与时代分组', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugGo('archive');
  app.debugArchiveTab('hist');
  const text = flatten(el('archive-body'));
  for (const h of HISTORY) assert.ok(text.indexOf(h.title) >= 0, '数学史分页缺少「' + h.title + '」');
  assert.ok(text.indexOf('古代：从公理到证明') >= 0, '应当有时代分组标题');
  assert.ok(text.indexOf('现代：谜题、机器与证明助手') >= 0, '应当有最后一个时代');
  // 条目上的关卡按钮可以跳关
  const btns = [];
  (function walk(x) { if (!x) return; if (x.tagName === 'BUTTON') btns.push(x); for (const c of x.children || []) walk(c); })(el('archive-body'));
  const lvBtn = btns.find((b) => b.textContent === 'L0-11');
  assert.ok(lvBtn, '应当有跳转到 L0-11 的按钮');
  lvBtn.onclick();
  assert.equal(app.debugLevelId(), 'L0-11', '点关卡按钮应当切到那一关');
});

test('档案室：引导开关能关掉自动弹出，也能重新打开', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugGo('archive');
  assert.equal(clickButton(el('archive-side'), /关闭新手引导/), true, '侧栏应当有引导开关');
  assert.equal(prefs().off, true, '点一下应当关掉引导');
  app.loadLevel('L0-02');                       // 换一关没跳过、没看完的
  app.debugGo('desk');
  assert.equal(app.debugGuide().active, false, '关掉之后不该再自动弹');
  app.debugArchiveTab('ach');
  assert.equal(clickButton(el('archive-side'), /重新打开新手引导/), true);
  assert.equal(prefs().off, false, '再点一下应当重新打开');
  app.loadLevel('L0-03');
  app.debugGo('desk');
  assert.equal(app.debugGuide().active, true, '重新打开后应当恢复自动弹出');
});

test('成就提示会真的弹出来，并且内容里有成就名', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugSelect(['p1']);
  app.debugUseRule('hyp');
  const toasts = app.debugToasts();
  assert.ok(toasts.length >= 1, '通关应当弹出成就提示');
  assert.ok(toasts.some((t) => /踏上证明之路/.test(t)), '提示里应当有成就名：' + JSON.stringify(toasts));
  assert.ok(toasts.some((t) => /成就解锁/.test(t)), '提示里应当标注“成就解锁”');
});

test('重置进度：进度、统计、成就、史话全部清空', () => {
  fresh('L0-01');
  app.debugGuideSkip();
  app.debugSelect(['p1']);
  app.debugUseRule('hyp');
  assert.ok(app.debugDone().length >= 1);
  el('btn-reset-desk').onclick();
  assert.deepEqual(app.debugDone(), [], '重置后不该还有通关记录');
  assert.equal(app.debugProfile().solvedCount, 0);
  assert.deepEqual(app.debugUnlocked(), [], '重置后不该还有成就');
  assert.equal(app.debugProfile().historyRead, 0, '重置后史话阅读记录也该清空');
  assert.equal(app.debugGuidePrefs().off, false, '重置后引导应当是打开状态');
});

test('L1 关卡没有手写引导时也能自动生成一份简版引导', () => {
  fresh('L1-07');
  const g = app.debugGuide();
  assert.equal(g.active, true, 'L1 关卡也该给引导');
  const steps = app.debugGuideSteps('L1-07');
  assert.ok(steps.length >= 3, '自动生成的引导步骤太少：' + steps.length);
  assert.ok(steps.every((s) => s.title && s.text), '每步都要有内容');
  assert.ok(steps[0].target === 'goal-text', '第一步应当指向目标');
});

test('每一关的引导清单都非空且字段齐全（走界面用的同一条路径）', () => {
  for (const lv of ['L0-01', 'L0-07', 'L0-16', 'L1-01', 'L1-16']) {
    const steps = app.debugGuideSteps(lv);
    assert.ok(steps.length >= 3, lv + ' 的引导太少');
    for (const s of steps) {
      assert.ok(s.id && s.title && s.text, lv + ' 的步骤缺字段：' + JSON.stringify(s));
      assert.ok(['next', 'step', 'assume', 'solved', 'select'].indexOf(s.advance) >= 0, lv + ' 的推进方式不合法：' + s.advance);
    }
  }
});

test('界面取到的引导步骤数与数据文件一致（没有偷偷丢步）', () => {
  for (const id of Object.keys(LEVEL_GUIDES)) {
    assert.equal(app.debugGuideSteps(id).length, LEVEL_GUIDES[id].length, id + ' 的步骤数对不上');
    assert.equal(app.debugGuideSteps(id).length, guideForLevel({ id, tier: 'L0', title: 'x', goal: 'A', rules: ['hyp'] }).length);
  }
});
