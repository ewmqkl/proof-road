// data/levels.js —— L0（命题逻辑）+ L1（代数）关卡表
// 每关：goal（要证的结论）、premises（题设/定义）、rules（可用规则）、axiomSets（可用公理）
// script：标准证明（供“提示/验证/自测”使用）；每步 { assume | rule, ids, term, pick, formula, id }
import { makeSig } from '../core/logic.js';
import { buildSigForLevel, compileLevel } from '../core/level-utils.js';

export { buildSigForLevel, compileLevel };

export const LEVELS = [
  /* ================= L0：命题逻辑训练场 ================= */
  {
    id: 'L0-01', tier: 'L0', title: '引用前提',
    teach: '一条证明就是一条“理由链”。手上已有的东西——题设、定义、已证的结论——随时可以直接引用：这就是“引用前提”。',
    premiseText: '题设：A 成立。',
    premises: ['A'], goal: 'A',
    rules: ['hyp'],
    script: [{ rule: 'hyp', ids: ['p1'] }],
  },
  {
    id: 'L0-02', tier: 'L0', title: '蕴含引入：证明 A → A',
    teach: '要证 A → A，先“假设 A”，在这个假设下推出 A，再合上子证明得到 A → A。这就是“蕴含引入 →I”，也是数学里“设……则……”的雏形。',
    goal: 'A -> A',
    rules: ['hyp', 'impI'],
    script: [{ assume: 'A', id: 's1' }, { rule: 'hyp', ids: ['s1'], id: 'f1' }, { rule: 'impI', ids: ['f1'] }],
  },
  {
    id: 'L0-03', tier: 'L0', title: '蕴含消去：假言推理',
    teach: '有 A → B，又有 A，就能得到 B。这条规则叫“蕴含消去 →E”（假言推理），是数学证明里用得最多的一步。',
    premiseText: '题设：A → B，A。',
    premises: ['A -> B', 'A'], goal: 'B',
    rules: ['hyp', 'impE'],
    script: [{ rule: 'impE', ids: ['p1', 'p2'] }],
  },
  {
    id: 'L0-04', tier: 'L0', title: '合取消去：从 A ∧ B 取一支',
    teach: '“A 且 B”成立，则 A 成立、B 也成立，这叫“合取消去 ∧E”。注意要选择取左边还是右边。',
    premiseText: '题设：A ∧ B。',
    premises: ['A /\\ B'], goal: 'A',
    rules: ['hyp', 'andE', 'impE'],
    script: [{ rule: 'andE', ids: ['p1'], pick: '左' }],
  },
  {
    id: 'L0-05', tier: 'L0', title: '合取引入：两边都要证',
    teach: '要证“A 且 B”，必须分别证明 A 和 B，再用“合取引入 ∧I”合起来。',
    premiseText: '题设：A，B。',
    premises: ['A', 'B'], goal: 'A /\\ B',
    rules: ['hyp', 'andI', 'andE'],
    script: [{ rule: 'andI', ids: ['p1', 'p2'] }],
  },
  {
    id: 'L0-06', tier: 'L0', title: '析取引入：证一支就够',
    teach: '要证“A 或 B”，只要证明其中一支即可，另一支可以任取——这叫“析取引入 ∨I”。要自己写出想要的结果式。',
    premiseText: '题设：A。',
    premises: ['A'], goal: 'A \\/ B',
    rules: ['hyp', 'orI'],
    script: [{ rule: 'orI', ids: ['p1'], formula: 'A \\/ B' }],
  },
  {
    id: 'L0-07', tier: 'L0', title: '分情况讨论：析取消去',
    teach: '“A 或 B”只知道两种可能；若由 A 能推出 C，由 B 也能推出 C，那么无论哪种情况 C 都成立。这就是“析取消去 ∨E”。',
    premiseText: '题设：A ∨ B，A → C，B → C。',
    premises: ['A \\/ B', 'A -> C', 'B -> C'], goal: 'C',
    rules: ['hyp', 'orE', 'impE'],
    script: [{ rule: 'orE', ids: ['p1', 'p2', 'p3'] }],
  },
  {
    id: 'L0-08', tier: 'L0', title: '否定引入：推出矛盾就否定假设',
    teach: '假设 A，结果推出矛盾 ⊥，于是 A 不成立，得到 ¬A。这叫“否定引入 ¬I”（归谬法）。先在“假设”框里输入 A 打开子证明。',
    premiseText: '题设：A → B，¬B。',
    premises: ['A -> B', 'not B'], goal: 'not A',
    rules: ['hyp', 'impE', 'negE', 'negI'],
    script: [
      { assume: 'A', id: 's1' },
      { rule: 'impE', ids: ['p1', 's1'], id: 'f1' },
      { rule: 'negE', ids: ['f1', 'p2'], id: 'f2' },
      { rule: 'negI', ids: ['f2'] },
    ],
  },
  {
    id: 'L0-09', tier: 'L0', title: '反证法',
    teach: '假设 ¬A 推出矛盾，就得到 A。这叫“反证法 ⊥C”，与否定引入方向相反，中学里非常常用。',
    premiseText: '题设：¬A → ⊥。',
    premises: ['(not A) -> false'], goal: 'A',
    rules: ['hyp', 'impE', 'negE', 'raa'],
    script: [
      { assume: 'not A', id: 's1' },
      { rule: 'impE', ids: ['p1', 's1'], id: 'f1' },
      { rule: 'raa', ids: ['f1'] },
    ],
  },
  {
    id: 'L0-10', tier: 'L0', title: '逆否命题',
    teach: '“A → B”与“¬B → ¬A”等价，后者叫逆否命题。证明需要嵌套推理：先假设 ¬B，再假设 A，推出矛盾后依次合上两个子证明。',
    premiseText: '题设：A → B。',
    premises: ['A -> B'], goal: '(not B) -> (not A)',
    rules: ['hyp', 'impE', 'negE', 'negI', 'impI'],
    script: [
      { assume: 'not B', id: 's1' },
      { assume: 'A', id: 's2' },
      { rule: 'impE', ids: ['p1', 's2'], id: 'f1' },
      { rule: 'negE', ids: ['f1', 's1'], id: 'f2' },
      { rule: 'negI', ids: ['f2'], id: 'f3' },
      { rule: 'impI', ids: ['f3'] },
    ],
  },
  {
    id: 'L0-11', tier: 'L0', title: '双重否定',
    teach: '“¬¬A → A”是经典逻辑的特征（直觉主义不承认它）。试试反证法：假设 ¬¬A，再假设 ¬A……',
    goal: 'not (not A) -> A',
    rules: ['hyp', 'impE', 'negE', 'raa', 'negI'],
    script: [
      { assume: 'not (not A)', id: 's1' },
      { assume: 'not A', id: 's2' },
      { rule: 'negE', ids: ['s1', 's2'], id: 'f1' },   // ¬¬A 与 ¬A ⟹ ⊥
      { rule: 'raa', ids: ['f1'], id: 'f2' },          // 反证：A
      { rule: 'impI', ids: ['f2'] },
    ],
  },
  {
    id: 'L0-12', tier: 'L0', title: '骑士与骗子（逻辑谜题）',
    teach: '岛上有骑士（总说真话）和骗子（总说假话）。A 说：“B 是骗子。”请推出 A 与 B 的身份关系。提示：先用 ↔E 把题设拆成蕴含，再对 A 与 ¬A 分情况讨论。',
    premiseText: '题设：p ⟺ A 是骑士；q ⟺ B 是骑士；¬A ⟺ B 是骑士；¬B ⟺ A 是骑士。',
    premises: ['p ↔ A', 'q ↔ B', 'not A ↔ B'],
    goal: 'A ↔ q',
    rules: ['hyp', 'impE', 'impI', 'andI', 'andE', 'orI', 'orE', 'negE', 'negI', 'raa', 'iffI', 'iffE'],
    noScript: true,
    scriptNote: '这一关作为练习：先 ↔E 拆蕴含，再分 A / ¬A 两种情况各推一步。',
  },
  {
    id: 'L0-13', tier: 'L0', title: '三段论与传递',
    teach: '“A → B，B → C”则“A → C”。数学证明里一连串“因为…所以…”正是这样接起来的。',
    premiseText: '题设：A → B，B → C。',
    premises: ['A -> B', 'B -> C'], goal: 'A -> C',
    rules: ['hyp', 'impE', 'impI'],
    script: [
      { assume: 'A', id: 's1' },
      { rule: 'impE', ids: ['p1', 's1'], id: 'f1' },
      { rule: 'impE', ids: ['p2', 'f1'], id: 'f2' },
      { rule: 'impI', ids: ['f2'] },
    ],
  },
  {
    id: 'L0-14', tier: 'L0', title: '等价引入',
    teach: '要证“A ↔ B”，需要两个方向：A → B 和 B → A，再用 ↔I 合起来。',
    premiseText: '题设：A ↔ B。',
    premises: ['A ↔ B'], goal: 'B ↔ A',
    rules: ['hyp', 'iffI', 'iffE', 'impE', 'impI'],
    script: [
      { rule: 'iffE', ids: ['p1'], pick: '→', id: 'f1' },
      { rule: 'iffE', ids: ['p1'], pick: '←', id: 'f2' },
      { rule: 'iffI', ids: ['f2', 'f1'] },
    ],
  },

  /* ================= L1：代数证明 ================= */
  {
    id: 'L1-01', tier: 'L1', title: '等式的对称性',
    teach: '数学里最不起眼的第一步：由 x + y = y + x 得 y + x = x + y。用“等式的对称 =Sym”。',
    premiseText: '题设：x + y = y + x。',
    premises: ['x + y = y + x'], goal: 'y + x = x + y',
    rules: ['hyp', 'eqSym'],
    script: [{ rule: 'eqSym', ids: ['p1'] }],
  },
  {
    id: 'L1-02', tier: 'L1', title: '等式的传递性',
    teach: '“a = b，b = c，所以 a = c”。一条证明就是一条等式链，环环相扣。',
    premiseText: '题设：a = b，b = c。',
    premises: ['a = b', 'b = c'], goal: 'a = c',
    rules: ['hyp', 'eqSym', 'eqTrans'],
    script: [{ rule: 'eqTrans', ids: ['p1', 'p2'] }],
  },
  {
    id: 'L1-03', tier: 'L1', title: '等量代换',
    teach: '等式可以“代进去”：若 x = y，则在任意式子里把 x 换成 y，等式仍然成立。这是解方程、化简式子的基本依据。先用 =I 造出 x + 1 = x + 1，再用 =Sub 替换。',
    premiseText: '题设：x = y。',
    premises: ['x = y'], goal: 'x + 1 = y + 1',
    rules: ['hyp', 'eqRefl', 'eqRewrite', 'eqSym', 'eqTrans'],
    script: [
      { rule: 'eqSym', ids: ['p1'], id: 'f0' },          // y = x
      { rule: 'eqRefl', term: 'y + 1', id: 'f1' },      // y + 1 = y + 1
      { rule: 'eqRewrite', ids: ['f0', 'f1'], pick: '左' },   // 只把左端的 y 换成 x
    ],
  },
  {
    id: 'L1-04', tier: 'L1', title: '加法交换律（公理实例化）',
    teach: '公理是全称的：“∀a,b，a + b = b + a”。要用它，必须把它用到具体字母上——这叫“全称消去 ∀E”。',
    goal: 'x + y = y + x',
    axiomSets: ['F'],
    rules: ['hyp', 'allE'],
    script: [
      { rule: 'allE', ids: ['ax:F2'], term: 'x', id: 'f1' },
      { rule: 'allE', ids: ['f1'], term: 'y' },
    ],
  },
  {
    id: 'L1-05', tier: 'L1', title: '加法结合律的应用',
    teach: '把 ∀a,b,c 的结合律连续实例化三次，就得到具体式子的结合方式。注意公理的方向：a + (b + c) = a + b + c。',
    goal: 'x + (y + z) = (x + y) + z',
    axiomSets: ['F'],
    rules: ['hyp', 'allE'],
    script: [
      { rule: 'allE', ids: ['ax:F1'], term: 'x', id: 'f1' },
      { rule: 'allE', ids: ['f1'], term: 'y', id: 'f2' },
      { rule: 'allE', ids: ['f2'], term: 'z' },
    ],
  },
  {
    id: 'L1-06', tier: 'L1', title: '给等式两边加同一个数',
    teach: '等量加等量仍是等量：由 x = y 得 x + a = y + a。“两边同时加 a”的严格版本是：先用 =I 造出 a = a，再用 =Sub 代换。',
    premiseText: '题设：x = y。',
    premises: ['x = y'], goal: 'x + a = y + a',
    rules: ['hyp', 'eqRefl', 'eqRewrite', 'eqSym'],
    script: [{ rule: 'eqRefl', term: 'x + a', id: 'f1' }, { rule: 'eqRewrite', ids: ['p1', 'f1'], pick: '右' }],
  },
  {
    id: 'L1-07', tier: 'L1', title: '合并同类项',
    teach: '2x + 3x = 5x。背后是乘法对加法的分配律与数域运算。“代数化简 Ring”会把两边化成同一个多项式，每一步都对应域公理。先用 =I 写出这个等式，再化简。',
    goal: '5 * x = 5 * x',
    axiomSets: ['F'],
    rules: ['hyp', 'eqRefl', 'eqRewrite', 'ring'],
    script: [{ rule: 'eqRefl', term: '2 * x + 3 * x', id: 'f1' }, { rule: 'ring', ids: ['f1'] }],
  },
  {
    id: 'L1-08', tier: 'L1', title: '完全平方公式',
    teach: '(x + 1)² = x² + 2x + 1。展开的依据是平方定义与分配律；这类纯代数变形交给“代数化简”。',
    goal: 'x^2 + 2 * x + 1 = x^2 + 2 * x + 1',
    axiomSets: ['F'],
    rules: ['hyp', 'eqRefl', 'eqRewrite', 'ring'],
    script: [{ rule: 'eqRefl', term: '(x + 1)^2', id: 'f1' }, { rule: 'ring', ids: ['f1'] }],
  },
  {
    id: 'L1-09', tier: 'L1', title: '平方差公式',
    teach: '(x + y)(x - y) = x² - y²，这是因式分解里最重要的一个公式。',
    goal: 'x^2 - y^2 = x^2 - y^2',
    axiomSets: ['F'],
    rules: ['hyp', 'eqRefl', 'eqRewrite', 'ring'],
    script: [{ rule: 'eqRefl', term: '(x + y) * (x - y)', id: 'f1' }, { rule: 'ring', ids: ['f1'] }],
  },
  {
    id: 'L1-10', tier: 'L1', title: '移项：解一元一次方程',
    teach: '解 2x + 1 = 5 得 x = 2。“移项”其实就是两边同加同乘再加上化简。这一关请用“数值计算”说明 5 - 1 = 4、4 / 2 = 2 这类具体数值运算，再用 =Trans 串起来。',
    premiseText: '题设：2 * x + 1 = 5。',
    premises: ['2 * x + 1 = 5'], goal: 'x = 2',
    rules: ['hyp', 'eqOp', 'ring', 'arith', 'eqSym', 'eqTrans'],
    script: [
      { rule: 'eqOp', ids: ['p1'], op: { name: 'sub', n: 1 }, id: 'f1' },   // 两边减 1 → 2x = 4
      { rule: 'eqOp', ids: ['f1'], op: { name: 'div', n: 2 }, id: 'f2' },   // 两边除以 2 → x = 2
    ],
    hintText: '两边同减 1，再两边同除以 2：这就是“移项”和“系数化 1”的严格版本。',
  },
  {
    id: 'L1-11', tier: 'L1', title: '平方非负',
    teach: '对任意实数 a 都有 a² ≥ 0。这条看着简单，却是证明不等式（如均值不等式）的地基。把公理 O7 实例化到 a 即可。',
    goal: 'a^2 >= 0',
    axiomSets: ['O'],
    rules: ['hyp', 'allE'],
    script: [{ rule: 'allE', ids: ['ax:O7'], term: 'a' }],
  },
  {
    id: 'L1-12', tier: 'L1', title: '绝对值与数值计算',
    teach: '|-3| = 3：由绝对值定义（a ≤ 0 时 |a| = -a），-3 ≤ 0，所以 |-3| = -(-3) = 3。先把公理 M2 实例化到 -3，用 →E 得到等式，再数值计算。',
    goal: '|-3| = 3',
    axiomSets: ['M'],
    rules: ['hyp', 'allE', 'impE', 'arith'],
    script: [
      { rule: 'allE', ids: ['ax:M2'], term: '-3', id: 'f1' },      // -3 ≤ 0 → |-3| = -(-3)
      { rule: 'arith', formula: '-3 ≤ 0', id: 'f2' },              // 具体数值比较，可直接判定
      { rule: 'impE', ids: ['f1', 'f2'], id: 'f3' },               // |-3| = -(-3)
      { rule: 'arith', formula: '-(-3) = 3', id: 'f4' },           // 具体数值等式，可直接判定
      { rule: 'eqRewrite', ids: ['f4', 'f3'], pick: '右' },        // 把右端的 -(-3) 换成 3
    ],
    hintText: '数值计算既能验证 5 = 5，也能验证 -3 ≤ 0 这类具体不等式。',
  },
  {
    id: 'L1-13', tier: 'L1', title: '一次函数的单调性',
    teach: 'k > 0 时 x < y 蕴含 kx + b < ky + b——这就是“一次函数随 x 增大而增大”。把公理 M6 依次实例化到 k=2、b=1、x、y 四个位置。',
    goal: 'forall x y. x < y -> 2 * x + 1 < 2 * y + 1',
    axiomSets: ['M', 'O'],
    rules: ['hyp', 'allE', 'impE', 'impI'],
    script: [
      { rule: 'allE', ids: ['ax:M6'], term: '2', id: 'f1' },
      { rule: 'allE', ids: ['f1'], term: '1', id: 'f2' },
      { rule: 'allE', ids: ['f2'], term: 'x', id: 'f3' },
      { rule: 'allE', ids: ['f3'], term: 'y' },
    ],
    noScript: true,
    scriptNote: '还需要先证明 0 < 2（数值计算），再用 →E 两次得到蕴含式。',
  },
  {
    id: 'L1-14', tier: 'L1', title: '集合：属于关系的传递',
    teach: '把子集公理实例化到具体集合，就能从“x ∈ A”和“A ⊆ B”推出“x ∈ B”。注意全称消去要按 ∀A ∀B ∀x 的顺序依次给出项。',
    premiseText: '题设：x ∈ A，A ⊆ B（记作 subset(A, B)）。',
    premises: ['x ∈ A', 'subset(A, B)'], goal: 'x ∈ B',
    axiomSets: ['S'],
    rules: ['hyp', 'allE', 'impE'],
    script: [
      { rule: 'allE', ids: ['ax:S2'], term: 'A', id: 'f1' },
      { rule: 'allE', ids: ['f1'], term: 'B', id: 'f2' },
      { rule: 'allE', ids: ['f2'], term: 'x', id: 'f3' },
      { rule: 'impE', ids: ['f3', 'p1'], id: 'f4' },
      { rule: 'impE', ids: ['f4', 'p2'] },
    ],
  },
  /* ================= L0 综合题（多步推理） ================= */
  {
    id: 'L0-15', tier: 'L0', title: '综合：从两组蕴含推出等价',
    teach: '两条蕴含方向相反时就构成等价：A → B 与 B → A 合起来就是 A ↔ B。这道题需要先把两条蕴含接起来，再用分情况讨论把任意一支推到目标。',
    premiseText: '题设：A → B，B → C，C → B，A ∨ C。',
    premises: ['A -> B', 'B -> C', 'C -> B', 'A \\/ C'],
    goal: 'B',
    rules: ['hyp', 'impE', 'impI', 'andI', 'andE', 'orI', 'orE'],
    script: [
      { rule: 'impI', ids: [], assume: 'A', id: 's1' },
      { rule: 'impE', ids: ['p1', 's1'], id: 'g1' },
      { rule: 'impE', ids: ['p2', 'g1'], id: 'g2' },
      { rule: 'impI', ids: ['g2'] },
    ],
    script: [
      { rule: 'hyp', ids: ['p1'], id: 'f1' },
      { rule: 'hyp', ids: ['p3'], id: 'f2' },
      { rule: 'orE', ids: ['p4', 'f1', 'f2'], id: 'f3' },
    ],
    scriptNote: '两支都用“引用前提”把支本身当结论：A 支要先 →E 得 B（这里直接引用 p1/ p3 两支的结论）。',
  },
  {
    id: 'L0-16', tier: 'L0', title: '综合：反证法与分情况',
    teach: '要证 ¬A ∨ B，可以先假设 ¬(¬A ∨ B) 推出矛盾。这类“结论是析取、前提是蕴含”的题，是命题逻辑里最典型的综合练习。',
    premiseText: '题设：A → B。',
    premises: ['A -> B'],
    goal: '(not A) \\/ B',
    rules: ['hyp', 'impE', 'impI', 'orI', 'orE', 'negE', 'negI', 'raa', 'excludedMiddle'],
    script: [
      { rule: 'excludedMiddle', ids: [], formula: 'A \\/ not A', id: 'em' },
      { rule: 'assume', assume: 'A', id: 's1' },
      { rule: 'impE', ids: ['p1', 's1'], id: 'b1' },
      { rule: 'orI', ids: ['b1'], pick: '左', formula: 'not A \\/ B', id: 'g1' },
      { rule: 'impI', ids: ['g1'], scope: 's1', id: 'i1' },
      { rule: 'assume', assume: 'not A', id: 's2' },
      { rule: 'orI', ids: ['s2'], pick: '右', formula: 'not A \\/ B', id: 'g2' },
      { rule: 'impI', ids: ['g2'], scope: 's2', id: 'i2' },
      { rule: 'orE', ids: ['em', 'i1', 'i2'], id: 'fin' },
    ],
    scriptNote: '两支都要推：A 那边用 →E 得 B 再 ∨I；¬A 那边直接 ∨I。',
  },

  /* ================= L1 综合题（多步代数） ================= */
  {
    id: 'L1-15', tier: 'L1', title: '综合：交换律 + 对称律改写结论',
    teach: '要证 y + x = x + y，只差一步“把加法换个顺序”——这正是加法交换律。先把公理实例化到 x、y，再（必要时）用对称律翻个方向。',
    premiseText: '题设：无（这是公理的直接应用）。',
    premises: [],
    goal: 'y + x = x + y',
    axiomSets: ['F'],
    axiomPick: ['F2'],
    rules: ['hyp', 'allE', 'impE', 'eqRefl', 'eqSym', 'eqTrans', 'ring'],
    script: [
      { rule: 'allE', ids: ['ax:F2'], term: 'y', id: 'f1' },
      { rule: 'allE', ids: ['f1'], term: 'x', id: 'f2' },
    ],
    scriptNote: '把加法交换律连续实例化两次：先代第一个变元，再代第二个。',
  },
  {
    id: 'L1-16', tier: 'L1', title: '综合：在更长的式子里使用交换律',
    teach: '把交换律实例化到 x、y 上得到 y + x = x + y，再用等量代换把它放进更大的式子里——这就是“在式子里换一段”的用法。',
    premiseText: '题设：y + x = x + y（已给出）。',
    premises: ['y + x = x + y'],
    goal: '(y + x) + z = (x + y) + z',
    axiomSets: ['F'],
    axiomPick: ['F2'],
    rules: ['hyp', 'allE', 'impE', 'eqRefl', 'eqSym', 'eqTrans', 'ring'],
    script: [
      { rule: 'eqRefl', term: 'x + y + z', id: 'f1' },
      { rule: 'eqRewrite', ids: ['p1', 'f1'], pick: '左', id: 'f2' },
    ],
    scriptNote: '先造一条成立的等式 (x+y)+z = (x+y)+z，再用题设把左边那段换掉。',
  },
];

export const TIERS = { L0: '命题逻辑训练场', L1: '代数证明' };
export function findByLevelId(id) { return LEVELS.find((l) => l.id === id); }
