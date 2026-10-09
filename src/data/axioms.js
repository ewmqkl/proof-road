// data/axioms.js —— 公理库：一切证明的起点
// 说明：文本与中学课本一致；每条都标注适用对象（实数 / 集合）。
import { parse, alphaEq, fstr } from '../core/logic.js';

/* ---------------- 命题逻辑（L0 的基础，不是数学公理） ---------------- */
export const PROPOSITIONAL = {
  id: 'PL',
  title: '命题逻辑基本规律',
  items: [
    { id: 'PL1', src: 'A -> (B -> A)', note: '肯定前件的“重复”形式：已有 A 时 B 不改变 A' },
    { id: 'PL2', src: '(A -> (B -> C)) -> ((A -> B) -> (A -> C))', note: '蕴含的分配' },
    { id: 'PL3', src: 'A -> (B -> (A /\\ B))', note: '合取引入' },
    { id: 'PL4', src: '(A /\\ B) -> A', note: '合取消去（左）' },
    { id: 'PL5', src: '(A /\\ B) -> B', note: '合取消去（右）' },
    { id: 'PL6', src: 'A -> (A \\/ B)', note: '析取引入（左）' },
    { id: 'PL7', src: 'B -> (A \\/ B)', note: '析取引入（右）' },
    { id: 'PL8', src: '(A -> C) -> ((B -> C) -> ((A \\/ B) -> C))', note: '分情况讨论' },
    { id: 'PL9', src: '(A -> B) -> ((A -> ¬B) -> ¬A)', note: '归谬：两头推出矛盾则 A 假' },
    { id: 'PL10', src: '(¬A -> B) -> ((¬A -> ¬B) -> A)', note: '反证法' },
    { id: 'PL11', src: 'A \\/ ¬A', note: '排中律（经典逻辑）' },
    { id: 'PL12', src: '(A -> B) -> ((B -> A) -> (A ↔ B))', note: '等价引入' },
    { id: 'PL13', src: '(A ↔ B) -> (A -> B)', note: '等价消去（→方向）' },
    { id: 'PL14', src: '(A ↔ B) -> (B -> A)', note: '等价消去（←方向）' },
  ],
};

/* ---------------- 实数域公理（L1 代数） ---------------- */
export const FIELD = {
  id: 'F',
  title: '实数域公理（代数运算的地基）',
  items: [
    { id: 'F1', src: 'forall a b c. a + (b + c) = (a + b) + c', note: '加法结合律' },
    { id: 'F2', src: 'forall a b. a + b = b + a', note: '加法交换律' },
    { id: 'F3', src: 'forall a. a + 0 = a', note: '加法单位元' },
    { id: 'F4', src: 'forall a. a + (-a) = 0', note: '加法逆元' },
    { id: 'F5', src: 'forall a b c. a * (b * c) = (a * b) * c', note: '乘法结合律' },
    { id: 'F6', src: 'forall a b. a * b = b * a', note: '乘法交换律' },
    { id: 'F7', src: 'forall a. a * 1 = a', note: '乘法单位元' },
    { id: 'F8', src: 'forall a. a ≠ 0 -> a * (1 / a) = 1', note: '乘法逆元（a ≠ 0）' },
    { id: 'F9', src: 'forall a b c. a * (b + c) = a * b + a * c', note: '分配律' },
    { id: 'F10', src: '0 ≠ 1', note: '域非退化' },
    { id: 'F11', src: 'forall a b. a - b = a + (-b)', note: '减法定义' },
    { id: 'F12', src: 'forall a. a² = a * a', note: '平方定义' },
    { id: 'F13', src: 'forall a. a * 0 = 0', note: '零的乘法性质（可由公理推出，此处直接给出）' },
  ],
};

/* ---------------- 序公理 ---------------- */
export const ORDER = {
  id: 'O',
  title: '序公理（不等式的地基）',
  items: [
    { id: 'O1', src: 'forall a b. a < b \\/ a = b \\/ b < a', note: '三歧性（任意两个实数可比）' },
    { id: 'O2', src: 'forall a b c. a < b -> b < c -> a < c', note: '传递性' },
    { id: 'O3', src: 'forall a b c. a < b -> a + c < b + c', note: '不等式两边同加' },
    { id: 'O4', src: 'forall a b. 0 < a -> 0 < b -> 0 < a * b', note: '正数之积为正' },
    { id: 'O5', src: 'forall a. a < 0 ↔ 0 < -a', note: '相反数与序' },
    { id: 'O6', src: 'forall a b. a ≤ b ↔ (a < b \\/ a = b)', note: '≤ 的定义' },
    { id: 'O7', src: 'forall a. a² ≥ 0', note: '平方非负（课本结论）' },
    { id: 'O8', src: 'forall a b. a < b -> 0 < b - a', note: '差与序' },
    { id: 'O9', src: 'forall a b. a > b ↔ b < a', note: '> 记号的方向' },
  ],
};

/* ---------------- 绝对值与函数 ---------------- */
export const ABS_FUNC = {
  id: 'M',
  title: '绝对值与函数单调性',
  items: [
    { id: 'M1', src: 'forall a. a ≥ 0 -> |a| = a', note: '绝对值定义（非负分支）' },
    { id: 'M2', src: 'forall a. a ≤ 0 -> |a| = -a', note: '绝对值定义（负分支）' },
    { id: 'M3', src: 'forall a. |a| ≥ 0', note: '绝对值非负' },
    { id: 'M4', src: 'forall a b. |a * b| = |a| * |b|', note: '绝对值的乘法性质' },
    { id: 'M5', src: 'forall a b. |a + b| ≤ |a| + |b|', note: '三角不等式' },
    { id: 'M6', src: 'forall k b x y. 0 < k -> x < y -> k * x + b < k * y + b', note: '一次函数 k>0 时递增（定义展开）' },
    { id: 'M7', src: 'forall k b x y. k < 0 -> x < y -> k * y + b < k * x + b', note: '一次函数 k<0 时递减' },
  ],
};

/* ---------------- 集合（L1 末段 / L2 预告） ---------------- */
export const SETS = {
  id: 'S',
  title: '集合公理',
  items: [
    { id: 'S1', src: 'forall A B. A = B ↔ (forall x. x ∈ A ↔ x ∈ B)', note: '外延公理：集合由元素决定' },
    { id: 'S2', src: 'forall A B x. x ∈ A -> subset(A, B) -> x ∈ B', note: '子集定义的展开（subset 是 ⊆ 的谓词记号）' },
  ],
};

export const ALL_SETS = [PROPOSITIONAL, FIELD, ORDER, ABS_FUNC, SETS];
export const SET_BY_ID = Object.fromEntries(ALL_SETS.map((s) => [s.id, s]));

/* 解析成公式对象（做题时用） */
export function buildAxioms(setIds, sig, opts = {}) {
  const out = [];
  // pick：只取指定 id 的公理。用于“这题只需要交换律”这类精简，能显著缩小搜证空间
  const pick = opts.pick ? new Set(opts.pick) : null;
  for (const id of setIds) {
    const set = SET_BY_ID[id];
    if (!set) throw new Error('未知公理组: ' + id);
    for (const item of set.items) {
      if (pick && !pick.has(item.id)) continue;
      let f;
      try { f = parse(item.src, sig, opts); }
      catch (e) { throw new Error('公理 ' + item.id + ' 解析失败: ' + e.message + '  ←  ' + item.src); }
      out.push({ id: item.id, f, note: item.note, set: set.id, title: set.title, src: item.src });
    }
  }
  return out;
}

