// data/achievements.js —— 成就表
// 每条成就只依赖一份“玩家档案”（profile，由 core/achievements.js 从存档算出），
// 因此判定是纯函数：给定同一份档案，结果永远相同，测试可以直接构造档案来验证。
//
// 字段说明：
//   tier     铜 / 银 / 金 / 白金，只影响界面配色
//   group    分组（见 ACHIEVEMENT_GROUPS）
//   desc     解锁条件的说明文案
//   history  可选的数学史条目 id：成就卡上会显示对应的史话
//   check    判定函数
//   progress 进度条：[当前, 上限]

export const ACHIEVEMENT_GROUPS = [
  { id: 'progress', name: '推进战绩', en: 'Progress' },
  { id: 'logic', name: '推理技法', en: 'Technique' },
  { id: 'challenge', name: '自律挑战', en: 'Challenge' },
  { id: 'desk', name: '证明台', en: 'Desk' },
  { id: 'history', name: '数学史', en: 'History' },
];

export const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'];
export const TIER_NAME = { bronze: '铜', silver: '银', gold: '金', platinum: '白金' };

const pct = (a, b) => [Math.min(a, b), b];
const has = (p, id) => p.levels[id] !== undefined;

export const ACHIEVEMENTS = [
  /* ---------------- 推进战绩 ---------------- */
  {
    id: 'a-first', group: 'progress', tier: 'bronze', icon: '⊢', history: 'H-PASCAL',
    name: '踏上证明之路', desc: '完成任意一关。',
    check: (p) => p.solvedCount >= 1, progress: (p) => pct(p.solvedCount, 1),
  },
  {
    id: 'a-l0-8', group: 'progress', tier: 'bronze', icon: '◈',
    name: '逻辑学徒', desc: '通过 L0 命题逻辑训练场的 8 关。',
    check: (p) => p.l0Solved >= 8, progress: (p) => pct(p.l0Solved, 8),
  },
  {
    id: 'a-l0-all', group: 'progress', tier: 'gold', icon: '∀', history: 'H-GENTZEN',
    name: '命题逻辑通关', desc: '通过 L0 全部 16 关。',
    check: (p) => p.l0Solved >= p.l0Total, progress: (p) => pct(p.l0Solved, p.l0Total),
  },
  {
    id: 'a-l1-all', group: 'progress', tier: 'gold', icon: '=', history: 'H-ALKHWARIZMI',
    name: '代数证明通关', desc: '通过 L1 代数证明全部 16 关。',
    check: (p) => p.l1Solved >= p.l1Total, progress: (p) => pct(p.l1Solved, p.l1Total),
  },
  {
    id: 'a-all', group: 'progress', tier: 'platinum', icon: '★', history: 'H-LEAN',
    name: '证明之路 · 全程', desc: '通过全部 32 关。',
    check: (p) => p.solvedCount >= p.totalLevels, progress: (p) => pct(p.solvedCount, p.totalLevels),
  },

  /* ---------------- 推理技法 ---------------- */
  {
    id: 'a-impE', group: 'logic', tier: 'bronze', icon: '→', history: 'H-ARISTOTLE-SYL',
    name: '假言推理', desc: '用一次蕴含消去 →E。',
    check: (p) => p.rules.impE >= 1, progress: (p) => pct(p.rules.impE, 1),
  },
  {
    id: 'a-andE', group: 'logic', tier: 'bronze', icon: '∧', history: 'H-BOOLE',
    name: '拆开合取', desc: '用一次合取消去 ∧E。',
    check: (p) => p.rules.andE >= 1, progress: (p) => pct(p.rules.andE, 1),
  },
  {
    id: 'a-andI', group: 'logic', tier: 'bronze', icon: '⊓',
    name: '两边都要证', desc: '用一次合取引入 ∧I。',
    check: (p) => p.rules.andI >= 1, progress: (p) => pct(p.rules.andI, 1),
  },
  {
    id: 'a-orE', group: 'logic', tier: 'silver', icon: '∨', history: 'H-FOUR-COLOR',
    name: '分情况讨论', desc: '用一次析取消去 ∨E 完成分情况讨论。',
    check: (p) => p.rules.orE >= 1, progress: (p) => pct(p.rules.orE, 1),
  },
  {
    id: 'a-negI', group: 'logic', tier: 'silver', icon: '¬', history: 'H-ZENO',
    name: '归谬法', desc: '用一次否定引入 ¬I。',
    check: (p) => p.rules.negI >= 1, progress: (p) => pct(p.rules.negI, 1),
  },
  {
    id: 'a-raa', group: 'logic', tier: 'silver', icon: '⊥', history: 'H-EUCLID-PRIME',
    name: '反证法', desc: '用一次反证法 ⊥C。',
    check: (p) => p.rules.raa >= 1, progress: (p) => pct(p.rules.raa, 1),
  },
  {
    id: 'a-em', group: 'logic', tier: 'silver', icon: '⊻', history: 'H-ARISTOTLE-LEM',
    name: '排中律的信徒', desc: '用一次排中律 A ∨ ¬A。',
    check: (p) => p.rules.excludedMiddle >= 1, progress: (p) => pct(p.rules.excludedMiddle, 1),
  },
  {
    id: 'a-allE', group: 'logic', tier: 'bronze', icon: '∀', history: 'H-PEANO',
    name: '从普遍到具体', desc: '用一次全称消去 ∀E 把公理用到具体对象上。',
    check: (p) => p.rules.allE >= 1, progress: (p) => pct(p.rules.allE, 1),
  },
  {
    id: 'a-ring', group: 'logic', tier: 'bronze', icon: '×', history: 'H-PRINCIPIA',
    name: '代数化简', desc: '用一次代数化简 Ring。',
    check: (p) => p.rules.ring >= 1, progress: (p) => pct(p.rules.ring, 1),
  },
  {
    id: 'a-arith', group: 'logic', tier: 'bronze', icon: '±', history: 'H-BOLZANO-CAUCHY',
    name: '数值计算', desc: '用一次数值计算判定具体数值关系。',
    check: (p) => p.rules.arith >= 1, progress: (p) => pct(p.rules.arith, 1),
  },
  {
    id: 'a-sub', group: 'logic', tier: 'bronze', icon: '⇄', history: 'H-EUCLID-CN',
    name: '等量代换', desc: '用一次等量代换 =Sub 把等式代进式子里。',
    check: (p) => p.rules.eqRewrite >= 1, progress: (p) => pct(p.rules.eqRewrite, 1),
  },
  {
    id: 'a-eqop', group: 'logic', tier: 'silver', icon: '⇔', history: 'H-NINE-CHAPTERS',
    name: '两边同时运算', desc: '用一次“两边同时运算”解方程。',
    check: (p) => p.rules.eqOp >= 1, progress: (p) => pct(p.rules.eqOp, 1),
  },
  {
    id: 'a-rules-12', group: 'logic', tier: 'silver', icon: '⌗',
    name: '十二般兵器', desc: '累计用过 12 种不同的推理规则。',
    check: (p) => p.rulesUsed >= 12, progress: (p) => pct(p.rulesUsed, 12),
  },
  {
    id: 'a-rules-all', group: 'logic', tier: 'platinum', icon: 'Ω', history: 'H-GENTZEN',
    name: '规则全集', desc: '把本游戏里出现过的推理规则全部用过一遍。',
    check: (p) => p.rulesUsed >= p.playableRules, progress: (p) => pct(p.rulesUsed, p.playableRules),
  },

  /* ---------------- 自律挑战 ---------------- */
  {
    id: 'a-nohint-1', group: 'challenge', tier: 'bronze', icon: '☝',
    name: '第一次不看提示', desc: '不看提示完成一关。',
    check: (p) => p.noHintLevels >= 1, progress: (p) => pct(p.noHintLevels, 1),
  },
  {
    id: 'a-nohint-5', group: 'challenge', tier: 'silver', icon: '✋',
    name: '独立自主', desc: '不看提示完成 5 关。',
    check: (p) => p.noHintLevels >= 5, progress: (p) => pct(p.noHintLevels, 5),
  },
  {
    id: 'a-nohint-l0', group: 'challenge', tier: 'gold', icon: '⛨', history: 'H-BROUWER',
    name: '无需提示的逻辑学家', desc: 'L0 全部 16 关都不看提示完成。',
    check: (p) => p.l0NoHint >= p.l0Total, progress: (p) => pct(p.l0NoHint, p.l0Total),
  },
  {
    id: 'a-clean-1', group: 'challenge', tier: 'bronze', icon: '✓',
    name: '一气呵成', desc: '某一关既不点提示、也不撤销、不被内核拒绝一次。',
    check: (p) => p.cleanLevels >= 1, progress: (p) => pct(p.cleanLevels, 1),
  },
  {
    id: 'a-clean-10', group: 'challenge', tier: 'gold', icon: '✦',
    name: '一次成型', desc: '10 关做到零提示、零撤销、零报错。',
    check: (p) => p.cleanLevels >= 10, progress: (p) => pct(p.cleanLevels, 10),
  },
  {
    id: 'a-deep-3', group: 'challenge', tier: 'silver', icon: '⧉', history: 'H-FITCH',
    name: '三层嵌套', desc: '在某一关同时打开 3 层子证明。',
    check: (p) => p.maxScopeDepth >= 3, progress: (p) => pct(p.maxScopeDepth, 3),
  },
  {
    id: 'a-err-20', group: 'challenge', tier: 'bronze', icon: '⚡', history: 'H-PARALLEL',
    name: '错误是老师', desc: '累计被内核拒绝 20 次——推错本身也是学习。',
    check: (p) => p.errors >= 20, progress: (p) => pct(p.errors, 20),
  },

  /* ---------------- 证明台 ---------------- */
  {
    id: 'a-instantiate', group: 'desk', tier: 'bronze', icon: '⇊', history: 'H-TARSKI',
    name: '展开公理', desc: '用过一次“展开全称公理”。',
    check: (p) => p.instantiate >= 1, progress: (p) => pct(p.instantiate, 1),
  },
  {
    id: 'a-hint', group: 'desk', tier: 'bronze', icon: '?',
    name: '提示是工具', desc: '用过一次提示。看不懂时就用它，这不丢人。',
    check: (p) => p.hints >= 1, progress: (p) => pct(p.hints, 1),
  },
  {
    id: 'a-undo', group: 'desk', tier: 'bronze', icon: '↺',
    name: '撤销也是推理', desc: '用过一次“撤销一步”。',
    check: (p) => p.undos >= 1, progress: (p) => pct(p.undos, 1),
  },
  {
    id: 'a-steps-100', group: 'desk', tier: 'silver', icon: '⋯',
    name: '百步穿杨', desc: '累计在证明台上落下 100 步。',
    check: (p) => p.steps >= 100, progress: (p) => pct(p.steps, 100),
  },
  {
    id: 'a-guide-skip', group: 'desk', tier: 'bronze', icon: '⇥',
    name: '跳过也是选择', desc: '跳过任意一关的新手引导。',
    check: (p) => p.guideSkipped >= 1, progress: (p) => pct(p.guideSkipped, 1),
  },
  {
    id: 'a-guide-5', group: 'desk', tier: 'silver', icon: '⚑', history: 'H-EUCLID',
    name: '有耐心的读者', desc: '完整看完 5 关的新手引导。',
    check: (p) => p.guideCompleted >= 5, progress: (p) => pct(p.guideCompleted, 5),
  },

  /* ---------------- 数学史 ---------------- */
  {
    id: 'a-hist-1', group: 'history', tier: 'bronze', icon: '❧',
    name: '读史使人明智', desc: '读完任意一条数学史条目。',
    check: (p) => p.historyRead >= 1, progress: (p) => pct(p.historyRead, 1),
  },
  {
    id: 'a-hist-10', group: 'history', tier: 'silver', icon: '❦',
    name: '数学史读者', desc: '读完 10 条数学史条目。',
    check: (p) => p.historyRead >= 10, progress: (p) => pct(p.historyRead, 10),
  },
  {
    id: 'a-hist-all', group: 'history', tier: 'gold', icon: '☰',
    name: '数学史长廊', desc: '读完全部数学史条目。',
    check: (p) => p.historyRead >= p.historyTotal, progress: (p) => pct(p.historyRead, p.historyTotal),
  },
  {
    id: 'a-euclid', group: 'history', tier: 'silver', icon: '△', history: 'H-EUCLID',
    name: '欧几里得的继承人', desc: '读完《几何原本》的史话，并通过 L0-01。',
    check: (p) => p.readHistory.indexOf('H-EUCLID') >= 0 && has(p, 'L0-01'),
    progress: (p) => pct((p.readHistory.indexOf('H-EUCLID') >= 0 ? 1 : 0) + (has(p, 'L0-01') ? 1 : 0), 2),
  },
  {
    id: 'a-brouwer', group: 'history', tier: 'silver', icon: '⊘', history: 'H-BROUWER',
    name: '与布劳威尔唱反调', desc: '通过 L0-11（双重否定消去——直觉主义不承认它）。',
    check: (p) => has(p, 'L0-11'), progress: (p) => pct(has(p, 'L0-11') ? 1 : 0, 1),
  },
  {
    id: 'a-gentzen', group: 'history', tier: 'silver', icon: '⊣', history: 'H-GENTZEN',
    name: '自然演绎的两条腿', desc: '通过 L0-02（蕴含引入）与 L0-07（析取消去）。',
    check: (p) => has(p, 'L0-02') && has(p, 'L0-07'),
    progress: (p) => pct((has(p, 'L0-02') ? 1 : 0) + (has(p, 'L0-07') ? 1 : 0), 2),
  },
  {
    id: 'a-smullyan', group: 'history', tier: 'silver', icon: '♞', history: 'H-SMULLYAN',
    name: '骑士与骗子', desc: '通过 L0-12 的逻辑谜题。',
    check: (p) => has(p, 'L0-12'), progress: (p) => pct(has(p, 'L0-12') ? 1 : 0, 1),
  },
  {
    id: 'a-demorgan', group: 'history', tier: 'silver', icon: '⊻', history: 'H-DEMORGAN',
    name: '德摩根的近亲', desc: '通过 L0-16（¬A ∨ B，等价于 A → B）。',
    check: (p) => has(p, 'L0-16'), progress: (p) => pct(has(p, 'L0-16') ? 1 : 0, 1),
  },
  {
    id: 'a-bruijn', group: 'history', tier: 'gold', icon: 'λ', history: 'H-BRUUN',
    name: '无名变量', desc: '读过德布鲁因的史话，并通过 L0-10（嵌套子证明正是 de Bruijn 索引的用武之地）。',
    check: (p) => p.readHistory.indexOf('H-BRUUN') >= 0 && has(p, 'L0-10'),
    progress: (p) => pct((p.readHistory.indexOf('H-BRUUN') >= 0 ? 1 : 0) + (has(p, 'L0-10') ? 1 : 0), 2),
  },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
