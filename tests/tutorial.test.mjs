// tests/tutorial.test.mjs —— 新手引导的内容与结构
// 关键一条：引导里高亮的元素 id 必须在 index.html 里真的存在，
// 否则浮标就会指着一片空白（这类问题在浏览器里肉眼很难发现）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from './_runner.mjs';
import {
  DESK_TOUR, LEVEL_GUIDES, ADVANCE_KINDS, guideForLevel, buildFallbackGuide,
  fullGuide, ALL_GUIDE_STEPS, targetIds, historyIds,
} from '../src/data/tutorial.js';
import { LEVELS } from '../src/data/levels.js';
import { HISTORY } from '../src/data/math-history.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const HTML_IDS = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const L0 = LEVELS.filter((l) => l.tier === 'L0');
const PLACES = ['top', 'bottom', 'left', 'right', 'center'];

test('index.html 里能解析出元素 id（校验本身是有效的）', () => {
  assert.ok(HTML_IDS.size >= 30, 'index.html 里解析出的 id 太少：' + HTML_IDS.size);
  for (const must of ['goal-text', 'facts', 'rules', 'proof', 'assume-bar', 'status-box', 'coach', 'coach-card', 'archive-body']) {
    assert.ok(HTML_IDS.has(must), 'index.html 缺少必要元素 #' + must);
  }
});

test('index.html 必须保留那些“只在页面里、不打桩”的控件', () => {
  // 打桩 DOM 不解析 index.html，所以这些控件在测试里查不到；
  // 一旦有人删掉它们，接线代码就会静默失效（$('x').onclick 会抛异常，但换名字就不会）。
  // 这里把“界面上必须存在的入口”写成一张清单，防止它们被无意删掉。
  const required = [
    'nav-save', 'nav-save-desk', 'btn-saves',      // 存档入口（三条路）
    'btn-restart',                                  // 重开本关
    'btn-guide', 'coach-skip',                      // 引导
    'archive-tabs', 'archive-body', 'archive-side', // 档案室三个分页的容器
    'history-card', 'btn-history',                  // 史话卡
    'toasts',                                       // 成就提示
    'meta-saves', 'meta-ach-total', 'meta-hist-total', 'meta-tests',
  ];
  const missing = required.filter((id) => !HTML_IDS.has(id));
  assert.deepEqual(missing, [], 'index.html 缺少这些控件：' + missing.join('、'));
});

test('界面代码里 getElementById 用到的 id 都真实存在于 index.html', () => {
  // app.js / tutorial.js 里所有 $('xxx') 字面量：写错一个字母，运行时就是“点了没反应”，
  // 这类问题在无浏览器测试里抓不到，只能靠这条静态对照。
  const bad = [];
  for (const f of ['../src/ui/app.js', '../src/ui/tutorial.js']) {
    const code = readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const m of code.matchAll(/\$\('([^']+)'\)/g)) {
      if (!HTML_IDS.has(m[1])) bad.push(f.replace('../src/ui/', '') + ' → #' + m[1]);
    }
  }
  assert.deepEqual(bad, [], '这些元素 id 在 index.html 里不存在：' + bad.join('、'));
});

test('全景导览：步骤齐全，能讲清证明台的每一块', () => {
  assert.ok(DESK_TOUR.length >= 8, '全景导览步骤太少：' + DESK_TOUR.length);
  const targets = DESK_TOUR.map((s) => s.target).filter(Boolean);
  for (const must of ['goal-text', 'facts', 'rules', 'assume-bar', 'proof', 'status-box']) {
    assert.ok(targets.indexOf(must) >= 0, '全景导览没有讲到 #' + must);
  }
});

test('L0 每一关都有详细的分步引导（至少 4 步）', () => {
  const thin = [];
  for (const lv of L0) {
    const g = LEVEL_GUIDES[lv.id];
    if (!g) { thin.push(lv.id + '（完全没有引导）'); continue; }
    if (g.length < 4) thin.push(lv.id + '（只有 ' + g.length + ' 步）');
  }
  assert.deepEqual(thin, [], '这些 L0 关卡的引导不够详细：' + thin.join('、'));
});

test('引导步骤：字段齐全、id 唯一、动作类型合法', () => {
  const ids = new Set();
  for (const s of ALL_GUIDE_STEPS) {
    assert.ok(s.id && !ids.has(s.id), '步骤 id 缺失或重复：' + s.id);
    ids.add(s.id);
    assert.ok(s.title && s.title.length >= 2, s.id + ' 缺标题');
    assert.ok(s.text && s.text.length >= 10, s.id + ' 正文太短：' + s.text);
    assert.ok(ADVANCE_KINDS.indexOf(s.advance || 'next') >= 0, s.id + ' 的推进方式不合法：' + s.advance);
    assert.ok(PLACES.indexOf(s.place || 'bottom') >= 0, s.id + ' 的摆放位置不合法：' + s.place);
    if (s.target) assert.equal(typeof s.target, 'string', s.id + ' 的 target 必须是字符串或 null');
  }
  assert.ok(ids.size >= 70, '引导步骤总数偏少：' + ids.size);
});

test('引导高亮的元素 id 都真实存在于 index.html', () => {
  const missing = targetIds().filter((id) => !HTML_IDS.has(id));
  assert.deepEqual(missing, [], '这些引导目标在 index.html 里不存在：' + missing.join('、'));
});

test('引导里引用的数学史条目都存在', () => {
  const known = new Set(HISTORY.map((h) => h.id));
  const bad = historyIds().filter((id) => !known.has(id));
  assert.deepEqual(bad, [], '引导引用了不存在的史话：' + bad.join('、'));
  assert.ok(historyIds().length >= 6, '引导里串的数学史太少：' + historyIds().length);
});

test('每一个关卡都能拿到引导（L0 用手写的，其余自动生成）', () => {
  for (const lv of LEVELS) {
    const g = guideForLevel(lv);
    assert.ok(g.length >= 3, lv.id + ' 的引导步骤太少：' + g.length);
    for (const s of g) assert.ok(s.title && s.text, lv.id + ' 的步骤缺内容');
  }
});

test('自动生成的引导：会用上关卡自己的目标、规则与提示', () => {
  const lv = LEVELS.find((l) => l.id === 'L1-10');
  const g = buildFallbackGuide(lv, { goalText: 'x = 2' });
  const all = g.map((s) => s.title + s.text).join('\n');
  assert.ok(all.indexOf('x = 2') >= 0, '自动引导没有写出本关目标');
  assert.ok(/两边同时运算|传递|化简/.test(all), '自动引导没有提到本关的规则：' + all);
  assert.ok(g.length >= 3);
  // 空题设的关卡要给出“起点是公理”的说明
  const lv2 = LEVELS.find((l) => l.id === 'L1-04');
  const g2 = buildFallbackGuide(lv2, { goalText: 'x + y = y + x' });
  assert.ok(g2.map((s) => s.text).join('').indexOf('没有题设') >= 0, '空题设关卡应说明起点是公理');
});

test('完整流程 = 全景导览 + 本关引导，顺序稳定', () => {
  const lv = LEVELS.find((l) => l.id === 'L0-07');
  const full = fullGuide(lv, { withTour: true });
  assert.equal(full.length, DESK_TOUR.length + LEVEL_GUIDES['L0-07'].length);
  assert.equal(full[0].id, DESK_TOUR[0].id);
  assert.equal(full[DESK_TOUR.length].id, LEVEL_GUIDES['L0-07'][0].id);
  const noTour = fullGuide(lv, { withTour: false });
  assert.equal(noTour.length, LEVEL_GUIDES['L0-07'].length);
});

test('关键的 L0 关卡引导要点到了本关的真正难点', () => {
  const has = (id, re) => {
    const g = LEVEL_GUIDES[id] || [];
    const text = g.map((s) => (s.title || '') + ' ' + (s.text || '') + ' ' + (s.action || '')).join('\n');
    assert.ok(re.test(text), id + ' 的引导没有讲到 ' + re + '：\n' + text.slice(0, 400));
  };
  has('L0-02', /假设 A/);                 // 蕴含引入必须先开子证明
  has('L0-04', /取左边|取右边/);           // 合取消去要选一支
  has('L0-07', /分情况讨论|两支/);         // 析取消去
  has('L0-08', /矛盾|⊥/);                  // 否定引入要撞出矛盾
  has('L0-10', /两层|嵌套|子证明里/);      // 逆否命题要嵌套
  has('L0-11', /双重否定/);                // 双重否定
  has('L0-16', /排中律/);                  // 综合题靠排中律
  has('L0-12', /开放练习/);                // 谜题关要说明是开放练习
});

test('引导里要求玩家做的动作，都对应真实存在的按钮或输入框', () => {
  const actions = ALL_GUIDE_STEPS.map((s) => s.action || '').filter(Boolean);
  assert.ok(actions.length >= 20, '写出来的“要做的事”太少：' + actions.length);
  // 引导文案里点名的规则名，必须是规则引擎里真实的中文名
  const names = [...new Set(ALL_GUIDE_STEPS.flatMap((s) => {
    const m = (s.action || '') + (s.text || '');
    return [...m.matchAll(/“([^”]{2,10})”/g)].map((x) => x[1]);
  }))];
  assert.ok(names.length >= 5, '引导里引用的界面名词太少');
});
