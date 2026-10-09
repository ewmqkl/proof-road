// data/tutorial.js —— 新手引导的步骤脚本（纯数据）
// 引导分两部分：
//   ① DESK_TOUR   —— 第一次进证明台时的全景导览（讲清每个面板是干什么的）
//   ② LEVEL_GUIDES —— L0 每一关的分步引导（讲清这一关该怎么下手）
// L1 与未单独编写的关卡走 buildFallbackGuide 自动生成的简版引导。
//
// 每个步骤的字段：
//   id       步骤标识
//   target   要高亮的元素 id（null 表示居中显示，不指向具体元素）
//   place    卡片放在目标的上/下/左/右
//   title    标题
//   text     正文
//   action   需要玩家做的动作（显示成一条醒目提示）
//   history  数学史条目 id（卡片上会附一条“史话”，并把它记为已读）
//   advance  'next'（点下一步）| 'step'（落下一步推理后自动前进）
//            | 'assume'（打开子证明后自动前进）| 'solved'（过关后自动前进）
import { P } from '../core/logic.js';
import { RULES } from '../core/rules.js';
import { compileLevel } from '../core/level-utils.js';

export const ADVANCE_KINDS = ['next', 'step', 'assume', 'solved', 'select'];

/* ================= ① 证明台全景导览 ================= */
export const DESK_TOUR = [
  {
    id: 'tour-welcome', target: null, place: 'center', advance: 'next',
    title: '这里是证明台',
    text: '整个游戏只有四屏：开始页 → 证明选择 → 证明台 → 档案室。你现在在证明台上。接下来的几步我会指着屏幕告诉你每一块是干什么用的；随时可以点“跳过引导”，也可以之后点“本关引导”重新打开。',
    action: '看完点“下一步”',
  },
  {
    id: 'tour-goal', target: 'goal-text', place: 'bottom', advance: 'next',
    title: '① 要证明的结论',
    text: '最上面这块白底卡片写的是本关的结论（GOAL）。证明台上的所有操作，都是为了推出这一行式子。目标下方的小字是“自由变量”说明：它们被视为任意取定的量，可以直接拿去做公理实例化。',
    action: '先读一遍这一行',
  },
  {
    id: 'tour-teach', target: 'level-teach', place: 'bottom', advance: 'next',
    title: '② 本关的说明与题设',
    text: '这一行是这一关要练的推理规则，以及给你哪些题设（前提）。题设是你可以无条件引用的起点，公理表里的公理也一样。',
  },
  {
    id: 'tour-facts', target: 'facts', place: 'top', advance: 'next',
    title: '③ 可用事实（可点击）',
    text: '这里列出题设、公理，以及你推导出来的每一条结论。每条左侧是它的编号（p1、p2 是题设，ax:F2 是公理，H1 是子证明假设）。点一下就选中，再点一下取消；一条规则需要几个前提，就选几条。',
    action: '试着点一条事实，看它变成蓝色高亮',
  },
  {
    id: 'tour-rules', target: 'rules', place: 'top', advance: 'next',
    title: '④ 推理规则',
    text: '选好前提后，点这里的规则来落下一步。内核会检查这一步是否真的成立：成立就生成一条新事实，不成立会明确告诉你原因。如果这一步有多种可能的结果（比如取左还是取右），下方会弹出“候选结果”让你挑；也可以自己手写结果式。',
    action: '最常见的两条是“蕴含消去 →E”和“蕴含引入 →I”',
  },
  {
    id: 'tour-choices', target: 'choices', place: 'top', advance: 'next',
    title: '⑤ 候选结果与引导卡',
    text: '这一块平时是隐藏的，只在“这一步有好几种可能”或者“你需要先开一个子证明”时出现。引导卡会直接写清该怎么走，并按一个按钮就替你把子证明开好——遇到不知道怎么下手的时候，先点规则看有没有引导卡。',
  },
  {
    id: 'tour-assume', target: 'assume-bar', place: 'top', advance: 'next',
    title: '⑥ 子证明与假设',
    text: '要证“A → B”“¬A”“A（反证）”这类结论，必须先假设点什么，这就是子证明。在输入框里写假设式（例如 A、not B），点“打开假设”，或者直接点引入类规则让界面替你开。右边的六边形小牌子显示当前开着几层子证明——合上时只能从最内层开始收。',
    action: '子证明里推出来的结论，合上后才对全局有效',
  },
  {
    id: 'tour-proof', target: 'proof', place: 'top', advance: 'next',
    title: '⑦ 证明记录',
    text: '你落下的每一步都会按顺序记在这里，子证明里的事实会自动缩进。已经合上的整段会变灰并划掉——那表示里面的东西不能再引用了。这张记录就是你的“证明答卷”。',
  },
  {
    id: 'tour-status', target: 'status-box', place: 'top', advance: 'next',
    title: '⑧ 状态栏',
    text: '成功、失败、提示都在这条横幅里。推错时它会说清是形状不对、前提不够，还是作用域用错了——读它比瞎试快得多。',
  },
  {
    id: 'tour-tools', target: 'btn-hint', place: 'top', advance: 'next',
    title: '⑨ 提示与公理表',
    text: '“提示”会按本关的标准证明一步一条地告诉你该怎么走，不扣分、不锁成就（本游戏没有分数）。下方“查看本关公理表”可以看这一关允许使用的公理原文。左侧“关卡索引”可以随时跳关。',
    action: '卡住就用提示，这不丢人',
  },
  {
    id: 'tour-done', target: 'btn-guide', place: 'top', advance: 'next',
    title: '随时可以重来或跳过',
    text: '这个按钮是“本关引导”：点它可以重新看这一关的分步说明。不想看引导，点浮标上的“跳过引导”就能退出；想在别处也一并关掉，去档案室的侧栏切一下开关即可，重置进度后会恢复默认。准备好了，我们就从 L0-01 开始。',
    action: '开始吧',
  },
];

/* ================= ② L0 逐关引导 ================= */
export const LEVEL_GUIDES = {
  'L0-01': [
    {
      id: 'L0-01-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：把 A 推出来',
      text: '上面写着本关要证的结论是 A。A 是一个命题变量，它具体是什么不重要——重要的是它从哪来。',
      history: 'H-EUCLID',
    },
    {
      id: 'L0-01-2', target: 'facts', place: 'top', advance: 'next',
      title: '起点：题设已经给了 A',
      text: '“可用事实”里第一条 p1 就是题设 A。注意它左边的编号 p1 与灰色小字“题设”——凡是题设、公理，都是不用证明就能用的起点。',
      action: '点一下 p1 这条事实，它会高亮为“已选”',
    },
    {
      id: 'L0-01-3', target: 'rules', place: 'top', advance: 'step',
      title: '动作：引用它',
      text: '选好 p1 之后，点规则区里的“引用前提 hyp”。这条规则什么也不做，只是把一条已有的事实搬到证明记录里，让你能正式引用它。',
      action: '选 p1 → 点“引用前提”',
    },
    {
      id: 'L0-01-4', target: 'proof', place: 'top', advance: 'next',
      title: '它出现在证明记录里了',
      text: '看“证明记录”：刚才那一步被编了号，并注明是靠“引用前提”得到的。这就是一份证明的样子——每一步都记下来，并且写明理由。如果上一步没成功，状态栏会告诉你原因。',
    },
    {
      id: 'L0-01-5', target: 'status-box', place: 'top', advance: 'next',
      title: '这一步其实很深刻',
      text: '“引用前提”看着像废话，但它是所有证明的底座：任何推理都必须从某个已经站得住的东西出发。欧几里得在《几何原本》里做的事情，就是坚持把每一步都归到定义、公设或已证的命题上。',
      history: 'H-PASCAL',
    },
    {
      id: 'L0-01-6', target: null, place: 'center', advance: 'next',
      title: '本关完成',
      text: '这一关只有一步，用来看清“证明台怎么用”。点“下一关”，我们就去证第一个真正的定理：A → A。',
    },
  ],

  'L0-02': [
    {
      id: 'L0-02-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：证明 A → A',
      text: '“如果 A，那么 A”。这听起来像废话，但要证它，你手上一无所有——本关连一条题设都没有。',
    },
    {
      id: 'L0-02-2', target: 'facts', place: 'top', advance: 'next',
      title: '事实面板是空的',
      text: '看到“本关没有题设”这行提示了吗？这不是界面坏了。要证一个蕴含式，办法是“先假设前件，推出后件”：假设 A，在假设下推出 A，然后把假设合上，就得到 A → A。',
      action: '要证 A → B 时，永远先假设 A',
    },
    {
      id: 'L0-02-3', target: 'rules', place: 'top', advance: 'assume',
      title: '做法一：点“蕴含引入 →I”看引导',
      text: '什么都没选的时候点“蕴含引入”，界面会弹出一张引导卡，写清“要证 A → A：假设 A，推出 A，再合上子证明”，并给你一个按钮直接开好子证明。',
      action: '点“蕴含引入 →I”，再点引导卡里的“开始：假设 A”',
    },
    {
      id: 'L0-02-4', target: 'assume-bar', place: 'top', advance: 'next',
      title: '做法二：自己写假设',
      text: '也可以直接在“子证明 / 假设式”输入框里写 A，点“打开假设”（或按回车）。两条路等价——界面只是替你少打几个字。右边的六边形牌子从 1 开始编号，告诉你现在开着第几层子证明。',
      action: '子证明开好了：现在是第 1 层，假设是 A',
    },
    {
      id: 'L0-02-5', target: 'facts', place: 'top', advance: 'next',
      title: '子证明里的假设也能被引用',
      text: '看“可用事实”：多了一条琥珀色的 H1：A，标签写着“子证明假设”。它和题设一样可以被引用，区别是它只在子证明开着的时候有效。',
    },
    {
      id: 'L0-02-6', target: 'rules', place: 'top', advance: 'step',
      title: '动作：在假设下推出 A',
      text: '选中 H1（那条假设 A），点“引用前提”，把 A 记进证明记录。这一步的意思就是“在假设 A 的前提下，A 成立”——一句话，但必须真的走一遍。',
      action: '选 H1 → 点“引用前提”',
    },
    {
      id: 'L0-02-7', target: 'rules', place: 'top', advance: 'solved',
      title: '动作：合上子证明',
      text: '选中刚才推出的那条 A，再点“蕴含引入 →I”。子证明会被合上，里面的假设随之失效，而结论 A → A 留了下来。这就是“蕴含引入”的全部内容：假设 → 推出 → 合上。',
      action: '选那条 A → 点“蕴含引入 →I”',
    },
    {
      id: 'L0-02-8', target: null, place: 'center', advance: 'next',
      title: '为什么子证明要“合上”',
      text: '合上之后，子证明里的东西就不能再引用了——因为 A → A 成立并不代表 A 成立。这套“假设有作用域”的纪律，1952 年由耶鲁大学的费奇用竖线和缩进画了出来，你看到的缩进与变灰划掉就是在画它。',
      history: 'H-FITCH',
    },
  ],

  'L0-03': [
    {
      id: 'L0-03-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：B',
      text: '本关要推出 B。看看有什么可用的：p1 是 A → B，p2 是 A。',
    },
    {
      id: 'L0-03-2', target: 'facts', place: 'top', advance: 'next',
      title: '认出“条件 + 条件”的形状',
      text: '一条蕴含 A → B，再加上它的前件 A——这是数学证明里出现次数最多的形状。把它用掉的动作叫“蕴含消去 →E”，中学里叫假言推理。',
      action: '需要同时选中两条事实：p1 与 p2',
    },
    {
      id: 'L0-03-3', target: 'facts', place: 'top', advance: 'next',
      title: '多选：点两条',
      text: '先点 p1，再点 p2。面板右上角会显示“已选 2 条”。顺序无所谓——内核会自己认出哪条是蕴含、哪条是它的前件。',
      action: '选中 p1 与 p2',
    },
    {
      id: 'L0-03-4', target: 'rules', place: 'top', advance: 'step',
      title: '动作：点“蕴含消去 →E”',
      text: '这一步的结果只有一种可能（就是 B），所以界面会直接替你落下，不会弹候选。',
      action: '点“蕴含消去 →E”',
    },
    {
      id: 'L0-03-5', target: 'status-box', place: 'top', advance: 'next',
      title: '→E 是最常用的一步',
      text: '“因为 A → B，又知道 A，所以 B”——这句话在数学里出现的频率高到几乎不被意识到。它最早的明确形式来自亚里士多德的三段论，而“条件句为真当且仅当前件真后件假”这个现代定义，是公元前四世纪麦加拉学派的费罗提出的。',
      history: 'H-MEGARA',
    },
    {
      id: 'L0-03-6', target: null, place: 'center', advance: 'next',
      title: '注意：不要用反了',
      text: '由 A → B 与 B 推不出 A（那叫“肯定后件”，是错的）。你可以故意试一下：选中 p1 与 B 再点 →E，内核会拒绝，并告诉你形状不匹配。错误提示本身也是一份教材。',
    },
  ],

  'L0-04': [
    {
      id: 'L0-04-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：A，题设是 A ∧ B',
      text: '题设给的比要证的更多：它一次给了两个结论。要把其中一个取出来，用“合取消去 ∧E”。',
    },
    {
      id: 'L0-04-2', target: 'facts', place: 'top', advance: 'next',
      title: '选中那条合取',
      text: 'p1 是 A ∧ B。选中它，然后点 ∧E。',
      action: '选 p1',
    },
    {
      id: 'L0-04-3', target: 'rules', place: 'top', advance: 'next',
      title: '∧E 要你自己选：取左边还是取右边',
      text: '“A ∧ B”可以取出 A，也可以取出 B，两种都成立。所以界面不会替你决定，而是在下方弹出两个候选按钮：“取左边”“取右边”。这是本作里第一次出现“一步有多种结果”。',
      action: '点“取左边”，得到 A',
    },
    {
      id: 'L0-04-4', target: 'choices', place: 'top', advance: 'next',
      title: '候选面板：所有成立的结果都列在这里',
      text: '候选里的每一项都已经在内核里试算通过了，所以随便点一个都不会错。以后遇到 ∀E（代入哪个项）、=Sub（往哪边代）、∨I（另一支取什么）都会用到这块面板。',
    },
    {
      id: 'L0-04-5', target: 'status-box', place: 'top', advance: 'next',
      title: '“且”与“或”的代数',
      text: '布尔在 1854 年把“且”写成乘法、“或”写成加法，让逻辑推理变成了代数演算。你刚才做的 ∧E，在布尔代数里就是“乘积为真则每个因子为真”。',
      history: 'H-BOOLE',
    },
  ],

  'L0-05': [
    {
      id: 'L0-05-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：A ∧ B —— 方向反过来了',
      text: '上一关是从“且”里取出一支；这一关要反过来，把两支合成一个“且”。要证 A ∧ B，必须分别证明 A 和 B，一个都不能少。',
    },
    {
      id: 'L0-05-2', target: 'facts', place: 'top', advance: 'next',
      title: '题设正好给了两条',
      text: 'p1 是 A，p2 是 B。两条都要用到，所以这次必须真的选中两条。',
      action: '选中 p1 与 p2',
    },
    {
      id: 'L0-05-3', target: 'rules', place: 'top', advance: 'step',
      title: '动作：点“合取引入 ∧I”',
      text: '结果只有 A ∧ B 一种可能，界面会直接落下。注意结果里两支的顺序：按你选的顺序，先选的在左边。写证明时保持顺序一致，读起来更清楚。',
      action: '点“合取引入 ∧I”',
    },
    {
      id: 'L0-05-4', target: 'proof', place: 'top', advance: 'next',
      title: '引入规则与消去规则是成对的',
      text: '∧I 负责“造出”合取，∧E 负责“用掉”合取；→I 与 →E、∨I 与 ∨E、¬I 与 ¬E、↔I 与 ↔E 都是这样一对。1934 年根岑提出自然演绎时，正是按“一条引入规则配一条消去规则”来设计逻辑的。',
      history: 'H-GENTZEN',
    },
    {
      id: 'L0-05-5', target: null, place: 'center', advance: 'next',
      title: '试一试故意少选一条',
      text: '只选 p1 就点 ∧I，内核会报“需要恰好 2 个前提”。这类报错不是惩罚，而是告诉你形状还差一半。',
    },
  ],

  'L0-06': [
    {
      id: 'L0-06-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：A ∨ B，手上只有 A',
      text: '只要证明了其中一支，“或”就成立——另一支是真是假都不影响。这条规则叫“析取引入 ∨I”。',
    },
    {
      id: 'L0-06-2', target: 'facts', place: 'top', advance: 'next',
      title: '选中 A',
      text: 'p1 是 A。选中它，然后点 ∨I。',
      action: '选 p1',
    },
    {
      id: 'L0-06-3', target: 'choices', place: 'top', advance: 'next',
      title: '∨I 必须告诉内核“另一支是什么”',
      text: '由 A 可以得到 A ∨ B，也可以得到 A ∨ C、A ∨ ¬B……这些全都成立。所以 ∨I 会列出候选，让结果式由你来定。如果候选里正好有目标，界面会优先替你挑出来。',
      action: '点“A ∨ B”这个候选（或直接让界面自动落下）',
    },
    {
      id: 'L0-06-4', target: 'choices', place: 'top', advance: 'next',
      title: '候选里没有想要的写法？自己写',
      text: '候选面板底部有一个输入框，可以手写结果式（本关表达式语法：/\\ 是且，\\/ 是或，-> 是蕴含，not 是否定），回车或点“用我写的式子”即可。L1 里的数值中间结论也要靠这个入口。',
    },
    {
      id: 'L0-06-5', target: 'status-box', place: 'top', advance: 'next',
      title: '“或”为什么会这么弱',
      text: '∨I 的“弱”是有意的：证一支就够，代价是你从 A ∨ B 里得不到任何一支的具体信息。真正要用“或”的时候必须分情况讨论——那是下一关。',
      history: 'H-BOOLE',
    },
  ],

  'L0-07': [
    {
      id: 'L0-07-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：C —— 只能分情况讨论',
      text: '题设是 A ∨ B、A → C、B → C。你并不知道 A 和 B 哪一个成立，但两条路都通向 C，所以无论哪种情况 C 都成立。这就是“析取消去 ∨E”。',
    },
    {
      id: 'L0-07-2', target: 'facts', place: 'top', advance: 'next',
      title: '先只选那条析取',
      text: '选中 p1（A ∨ B），然后点 ∨E。不要急着去凑三条前提——你还没做那两支呢。',
      action: '选 p1 → 点“析取消去 ∨E”',
    },
    {
      id: 'L0-07-3', target: 'choices', place: 'top', advance: 'assume',
      title: '引导卡：两支分别要推出什么',
      text: '界面会给出一张“分情况讨论”引导卡，写清假设 A 要推出 C、假设 B 也要推出 C，并各配一个“开始这一支”按钮，点了就替你开好对应的子证明。',
      action: '点“开始这一支：假设 A”',
    },
    {
      id: 'L0-07-4', target: 'rules', place: 'top', advance: 'step',
      title: '支 1：在假设 A 下推出 C',
      text: '选中 H1（假设 A）与 p2（A → C），点“蕴含消去 →E”，得到 C。注意这个 C 带着作用域，只在假设 A 里有效。',
      action: '选 H1 与 p2 → 点 →E',
    },
    {
      id: 'L0-07-5', target: 'rules', place: 'top', advance: 'step',
      title: '支 1 要合上：把 C 变成 A → C',
      text: '选中刚才那个 C，点“蕴含引入 →I”。子证明合上，得到一条不带作用域的 A → C——这才是 ∨E 需要的那条蕴含。',
      action: '选 C → 点“蕴含引入 →I”',
    },
    {
      id: 'L0-07-6', target: 'rules', place: 'top', advance: 'next',
      title: '支 2：同样走一遍',
      text: '再点 ∨E 打开引导卡，这次点“开始这一支：假设 B”。用 H2 与 p3（B → C）做 →E 得 C，再用 →I 合上，得到 B → C。做完后引导卡会把这一支标成 ✓。',
      action: '重复一遍：假设 B → →E → →I',
    },
    {
      id: 'L0-07-7', target: 'rules', place: 'top', advance: 'solved',
      title: '收尾：析取 + 两条蕴含',
      text: '现在三条前提齐了：A ∨ B、A → C、B → C。把它们一起选中，点 ∨E，C 就出来了。这一步之后 A 与 B 的假设全部作废，只剩 C 立于全局。',
      action: '选三条 → 点 ∨E',
    },
    {
      id: 'L0-07-8', target: null, place: 'center', advance: 'next',
      title: '分情况讨论能有多大',
      text: '四色定理（1976 年，阿佩尔与哈肯）就是这种形状的极端版本：把所有可能的地图归入上千种“不可避免构型”，再逐一验证每一类都能用四色染好。骨架和你在这一关做的完全一样，只是“两支”变成了一千多支。',
      history: 'H-FOUR-COLOR',
    },
  ],

  'L0-08': [
    {
      id: 'L0-08-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：¬A',
      text: '题设是 A → B 与 ¬B。要证“A 不成立”，最自然的办法就是：假设 A 成立，看看会不会出事。',
    },
    {
      id: 'L0-08-2', target: 'rules', place: 'top', advance: 'assume',
      title: '点“否定引入 ¬I”会给出该假设什么的引导',
      text: '什么都不选就点 ¬I，界面会弹引导卡：“要证 ¬A：假设 A，推出矛盾 ⊥，再合上子证明”，并给一个按钮直接开好。这条规则在中学叫归谬法。',
      action: '点“否定引入 ¬I” → 点“开始：假设 A”',
    },
    {
      id: 'L0-08-3', target: 'rules', place: 'top', advance: 'step',
      title: '在假设 A 下得到 B',
      text: '选中 H1（假设 A）与 p1（A → B），点 →E，得到 B。现在子证明里同时有 B 和外面的 ¬B——两条事实撞在一起了。',
      action: '选 H1 与 p1 → 点“蕴含消去 →E”',
    },
    {
      id: 'L0-08-4', target: 'rules', place: 'top', advance: 'step',
      title: '把它们撞成矛盾 ⊥',
      text: '选中刚推出的 B 与 p2（¬B），点“否定消去 ¬E”。⊥ 是“假”，是逻辑里的爆炸点：一旦得到 ⊥，这个假设就站不住了。',
      action: '选 B 与 p2 → 点“否定消去 ¬E”',
    },
    {
      id: 'L0-08-5', target: 'rules', place: 'top', advance: 'solved',
      title: '合上：由 ⊥ 得到 ¬A',
      text: '选中那条 ⊥，点“否定引入 ¬I”。子证明合上，假设 A 被否定，结论 ¬A 成立。',
      action: '选 ⊥ → 点“否定引入 ¬I”',
    },
    {
      id: 'L0-08-6', target: null, place: 'center', advance: 'next',
      title: '这条办法有两千五百年历史',
      text: '芝诺用“承认它就会推出矛盾”来反驳运动，毕达哥拉斯学派用同样的办法发现 √2 不是有理数：假设 √2 = p/q 且 p、q 互素，会推出两者都是偶数，矛盾。你刚才那四步，和他们是同一个形状。',
      history: 'H-ZENO',
    },
  ],

  'L0-09': [
    {
      id: 'L0-09-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：A。题设：¬A → ⊥',
      text: '题设说“只要 ¬A，就会推出假”。那 ¬A 显然站不住，所以 A 成立。这条规则叫反证法 ⊥C，是和否定引入方向相反的另一半。',
    },
    {
      id: 'L0-09-2', target: 'rules', place: 'top', advance: 'assume',
      title: '点“反证法 ⊥C”看它建议假设什么',
      text: '与 ¬I 不同，反证法要假设的是“目标的否定”，也就是 ¬A。引导卡会写清楚这一点并替你开好子证明。',
      action: '点“反证法 ⊥C” → 点“开始：假设 not A”',
    },
    {
      id: 'L0-09-3', target: 'rules', place: 'top', advance: 'step',
      title: '在假设 ¬A 下得到 ⊥',
      text: '选中 H1（假设 ¬A）与 p1（¬A → ⊥），点 →E，直接得到 ⊥。这次连“撞两条事实”都不用，题设本身就是一条通向矛盾的路。',
      action: '选 H1 与 p1 → 点“蕴含消去 →E”',
    },
    {
      id: 'L0-09-4', target: 'rules', place: 'top', advance: 'solved',
      title: '合上：由 ⊥ 得到 A',
      text: '选中那条 ⊥，点“反证法 ⊥C”。¬A 被推翻，A 成立。',
      action: '选 ⊥ → 点“反证法 ⊥C”',
    },
    {
      id: 'L0-09-5', target: null, place: 'center', advance: 'next',
      title: '¬I 与 ⊥C 到底差在哪',
      text: '¬I：假设 A 得矛盾 → 结论 ¬A（否定一个肯定式）。⊥C：假设 ¬A 得矛盾 → 结论 A（肯定一个否定式）。后者是经典逻辑特有的：直觉主义承认 ¬I，但不承认 ⊥C。',
      history: 'H-EUCLID-PRIME',
    },
    {
      id: 'L0-09-6', target: null, place: 'center', advance: 'next',
      title: '顺带一提：反证法推不出矛盾时',
      text: '萨凯里 1733 年想用反证法证明欧几里得的平行公设，假设它不成立，结果推出一大堆“荒谬但互不矛盾”的命题。罗巴切夫斯基与鲍耶后来意识到：推不出矛盾，恰恰说明那条公设是独立的——非欧几何就这样诞生了。',
      history: 'H-PARALLEL',
    },
  ],

  'L0-10': [
    {
      id: 'L0-10-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：¬B → ¬A（逆否命题）',
      text: '题设只有 A → B。要证“¬B 蕴含 ¬A”，最外层当然是先假设 ¬B，可是接下来要证 ¬A——那又需要再假设一次。这就是嵌套子证明。',
    },
    {
      id: 'L0-10-2', target: 'assume-bar', place: 'top', advance: 'assume',
      title: '第一层：假设 ¬B',
      text: '在输入框里写 not B，点“打开假设”。因为目标是蕴含式，也可以点 →I 让界面替你开——它会认出前件是 ¬B。',
      action: '打开假设：not B',
    },
    {
      id: 'L0-10-3', target: 'assume-bar', place: 'top', advance: 'assume',
      title: '第二层：在子证明里再假设 A',
      text: '现在目标是 ¬A。要证否定，就假设它的肯定式：再打开一个子证明，假设 A。切记录看右边的六边形牌子，现在是两层。子证明里可以继续开子证明，层数不限。',
      action: '再打开一个假设：A',
    },
    {
      id: 'L0-10-4', target: 'rules', place: 'top', advance: 'step',
      title: '内层：推出 B',
      text: '选中 H2（假设 A）与 p1（A → B），点 →E，得到 B。注意 B 依赖两层假设，标签会写成 H1|H2 之类的形式。',
      action: '选 H2 与 p1 → 点 →E',
    },
    {
      id: 'L0-10-5', target: 'rules', place: 'top', advance: 'step',
      title: '内层：B 与外层的 ¬B 撞成 ⊥',
      text: '选中刚得到的 B 与 H1（¬B），点 ¬E，得到 ⊥。',
      action: '选 B 与 H1 → 点“否定消去 ¬E”',
    },
    {
      id: 'L0-10-6', target: 'rules', place: 'top', advance: 'step',
      title: '合上内层：得到 ¬A',
      text: '选中 ⊥，点 ¬I。最内层的子证明被合上，得到 ¬A——它仍然依赖外层假设 ¬B，这是对的。',
      action: '选 ⊥ → 点“否定引入 ¬I”',
    },
    {
      id: 'L0-10-7', target: 'rules', place: 'top', advance: 'solved',
      title: '合上外层：得到 ¬B → ¬A',
      text: '选中那条 ¬A，点 →I。外层合上，逆否命题成立。合上时只能收最内层，所以顺序不能颠倒——如果合错了层，内核会拒绝并提示作用域问题。',
      action: '选 ¬A → 点“蕴含引入 →I”',
    },
    {
      id: 'L0-10-8', target: null, place: 'center', advance: 'next',
      title: '嵌套子证明为什么难写对',
      text: '两层假设意味着结论上挂着“H1|H2”这样的作用域标签。如果实现时只存变量名，替换时就会“串味”（把内层的变量换成外层同名的变量）。德布鲁因 1972 年提出用“无名变量”（de Bruijn 索引）代替名字，从此替换抓错变量在结构上不可能发生——这个证明台的内核用的就是它。',
      history: 'H-BRUUN',
    },
  ],

  'L0-11': [
    {
      id: 'L0-11-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：¬¬A → A',
      text: '“不是不是 A”能推出 A 吗？在经典逻辑里可以，这条路叫“双重否定消去”。本关没有题设，全靠自己搭。',
    },
    {
      id: 'L0-11-2', target: 'rules', place: 'top', advance: 'assume',
      title: '第一层：假设 ¬¬A',
      text: '目标是蕴含式，所以先假设前件：点“蕴含引入 →I”让界面替你开，或者自己写 not (not A)。',
      action: '打开假设：not (not A)',
    },
    {
      id: 'L0-11-3', target: 'rules', place: 'top', advance: 'assume',
      title: '第二层：要证 A，就用反证法',
      text: '现在位于第一层子证明里，目标变成 A。直接推是推不出来的，改用反证法：再开一层，假设 ¬A。',
      action: '再打开一个假设：not A（或点“反证法 ⊥C”看引导）',
    },
    {
      id: 'L0-11-4', target: 'rules', place: 'top', advance: 'step',
      title: '把 ¬¬A 与 ¬A 撞成 ⊥',
      text: '选中 H1（¬¬A）与 H2（¬A），点“否定消去 ¬E”，得到 ⊥。¬E 的用途就是让一个命题和它的否定直接相撞。',
      action: '选 H1 与 H2 → 点 ¬E',
    },
    {
      id: 'L0-11-5', target: 'rules', place: 'top', advance: 'step',
      title: '合上第二层：反证得 A',
      text: '选中 ⊥，点“反证法 ⊥C”。假设 ¬A 被推翻，得到 A。这一步就是传说中的双重否定消去。',
      action: '选 ⊥ → 点“反证法 ⊥C”',
    },
    {
      id: 'L0-11-6', target: 'rules', place: 'top', advance: 'solved',
      title: '合上第一层：得到 ¬¬A → A',
      text: '选中 A，点“蕴含引入 →I”。两层子证明都收完，结论成立。',
      action: '选 A → 点“蕴含引入 →I”',
    },
    {
      id: 'L0-11-7', target: null, place: 'center', advance: 'next',
      title: '这条定理是有争议的',
      text: '1908 年布劳威尔指出：对无穷对象不能无条件使用排中律，因此 ¬¬A → A 在直觉主义逻辑里推不出来；海廷 1930 年把这种逻辑形式化了。所以这一关证出来的结论，是经典逻辑的一张“许可证”，不是所有数学家都签发的。',
      history: 'H-BROUWER',
    },
  ],

  'L0-12': [
    {
      id: 'L0-12-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '一个谜题：骑士与骗子',
      text: '岛上的骑士总说真话，骗子总说假话。A 说：“B 是骗子。”要证的是 A ↔ q，其中 p 表示“A 是骑士”、q 表示“B 是骑士”。本关是开放练习，没有标准答案。',
      history: 'H-SMULLYAN',
    },
    {
      id: 'L0-12-2', target: 'facts', place: 'top', advance: 'next',
      title: '题设是三条等价',
      text: 'p ↔ A 表示“A 是骑士”与“命题 A 为真”同真同假；¬A ↔ B 表示 A 说“B 是骗子”这句话的内容是 ¬A，而这句话的真假又等于 B 的身份。把口语翻成 ↔ 是本关的第一件事。',
      action: '先想清楚：↔ 要怎么用掉？',
    },
    {
      id: 'L0-12-3', target: 'rules', place: 'top', advance: 'next',
      title: '路线一：先用 ↔E 拆开等价',
      text: '选中一条 ↔ 前提，点“等价消去 ↔E”，界面会给两个候选（→ 方向和 ← 方向）。拆出来的蕴含才能配合 →E 使用。',
      action: '选 p1 → 点 ↔E → 挑一个方向',
    },
    {
      id: 'L0-12-4', target: 'rules', place: 'top', advance: 'next',
      title: '路线二：对 A 分情况',
      text: '目标是 A ↔ q，两个方向都要证。证 A → q 时可以假设 A，由 p ↔ A 反推出 p，再由 ¬A ↔ B 与 A 推出 ¬B……每一支都是短链，但要自己决定先动哪条。',
      action: '记住：↔I 需要两条方向相反的蕴含',
    },
    {
      id: 'L0-12-5', target: 'btn-hint', place: 'top', advance: 'next',
      title: '卡住了就点提示',
      text: '本关没有标准证明，但提示会给出路线与每一步该做什么。这是唯一的两关“开放练习”之一，慢慢试不用急。',
    },
  ],

  'L0-13': [
    {
      id: 'L0-13-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：A → C',
      text: '题设是 A → B 与 B → C。这就是“因为…所以…所以…”接起来的样子，中学叫三段论，逻辑里叫蕴含的传递。',
      history: 'H-ARISTOTLE-SYL',
    },
    {
      id: 'L0-13-2', target: 'rules', place: 'top', advance: 'assume',
      title: '结论是蕴含，就先假设前件',
      text: '点“蕴含引入 →I”让界面替你开子证明（它会认出前件是 A），或者自己写 A 打开假设。',
      action: '打开假设：A',
    },
    {
      id: 'L0-13-3', target: 'rules', place: 'top', advance: 'step',
      title: '第一跳：A → B 与 A 得 B',
      text: '选中 H1 与 p1，点 →E。',
      action: '选 H1 与 p1 → 点 →E',
    },
    {
      id: 'L0-13-4', target: 'rules', place: 'top', advance: 'step',
      title: '第二跳：B → C 与 B 得 C',
      text: '选中刚得到的 B 与 p2，再点一次 →E，得到 C。链式推理就是这样一环扣一环。',
      action: '选 B 与 p2 → 点 →E',
    },
    {
      id: 'L0-13-5', target: 'rules', place: 'top', advance: 'solved',
      title: '合上：得到 A → C',
      text: '选中 C，点 →I。假设 A 收起，结论 A → C 成立。',
      action: '选 C → 点 →I',
    },
    {
      id: 'L0-13-6', target: null, place: 'center', advance: 'next',
      title: '三段论与莱布尼茨的梦想',
      text: '亚里士多德在《前分析篇》里就把它整理成了“所有 M 是 P；所有 S 是 M；所以所有 S 是 P”。两千年后莱布尼茨设想一种“推理演算”，遇到争论时双方只需说“让我们来计算一下”——你刚才那三跳，正是他想要自动化的事情，只不过今天由你自己点出来。',
      history: 'H-LEIBNIZ',
    },
  ],

  'L0-14': [
    {
      id: 'L0-14-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '目标：B ↔ A（把等价反过来）',
      text: '题设是 A ↔ B。要证“B 当且仅当 A”，需要两个方向：B → A 和 A → B，再用 ↔I 合并。',
    },
    {
      id: 'L0-14-2', target: 'rules', place: 'top', advance: 'next',
      title: '先把等价拆成两条蕴含',
      text: '选中 p1，点“等价消去 ↔E”，候选里有“取 → 方向”（得到 A → B）和“取 ← 方向”（得到 B → A）。两个方向都要拆出来——因为 ↔I 需要两条蕴含。',
      action: '拆两次：→ 方向和 ← 方向',
    },
    {
      id: 'L0-14-3', target: 'rules', place: 'top', advance: 'step',
      title: '合并：↔I 的顺序有讲究',
      text: '选中刚刚得到的两条蕴含，点“等价引入 ↔I”。谁在左边由顺序决定：先选的那条成为 ↔ 的左方向（即左 → 右）。要得到 B ↔ A，先选 B → A。',
      action: '先选 B → A，再选 A → B → 点 ↔I',
    },
    {
      id: 'L0-14-4', target: 'status-box', place: 'top', advance: 'next',
      title: '等价就是“两个方向都成立”',
      text: '德摩根 1847 年系统讨论了这类“互相推出”的关系，布尔则把它写成等式。在数学写作里，↔ 常常被用作“定义”的记号——定义就是一条不需证明的等价。',
      history: 'H-DEMORGAN',
    },
  ],

  'L0-15': [
    {
      id: 'L0-15-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '综合题：目标 B，四条题设',
      text: '题设是 A → B、B → C、C → B、A ∨ C。没有任何一条直接给出 B，唯一的结构是最后那条析取——它告诉你“要么 A，要么 C”。',
    },
    {
      id: 'L0-15-2', target: 'rules', place: 'top', advance: 'next',
      title: '判断主干：这是分情况讨论',
      text: '只要能从 A 推出 B、从 C 推出 B，就能由 A ∨ C 得到 B。所以 ∨E 是主干，其余三条蕴含是两支里的燃料。',
      action: '选 p4（A ∨ C）→ 点 ∨E 看引导卡',
    },
    {
      id: 'L0-15-3', target: 'choices', place: 'top', advance: 'assume',
      title: '支 1：假设 A，推出 B',
      text: '点引导卡里的“开始这一支：假设 A”，然后在子证明里选 H1 与 p1（A → B）做 →E 得 B；也可以再走一步 p2 得 C，但这一关用不到。',
      action: '假设 A → →E 得 B',
    },
    {
      id: 'L0-15-4', target: 'rules', place: 'top', advance: 'step',
      title: '支 1 合上：A → B',
      text: '选中子证明里的 B，点 →I，得到一条全局的 A → B。注意：题设 p1 本来就是 A → B，所以也有更省事的走法——直接引用 p1 本身。两条路都对，但先走一遍子证明更有收获。',
      action: '选 B → 点 →I',
    },
    {
      id: 'L0-15-5', target: 'rules', place: 'top', advance: 'next',
      title: '支 2：假设 C，推出 B',
      text: '同样地打开第二支：假设 C，用 p3（C → B）做 →E 得 B，再 →I 合上。做完后引导卡会把两支都标成 ✓。',
      action: '重复一遍：假设 C → →E → →I',
    },
    {
      id: 'L0-15-6', target: 'rules', place: 'top', advance: 'solved',
      title: '收尾：三条前提一起交给 ∨E',
      text: '选中 A ∨ C、A → B、C → B 三条，点 ∨E。两支都被覆盖，B 成立。要检查自己的答案是否“干净”，可以看证明记录：合上的段落应该是灰的，最后那条 B 不带任何作用域标签。',
      action: '选三条 → 点 ∨E',
    },
    {
      id: 'L0-15-7', target: null, place: 'center', advance: 'next',
      title: '一关里用到了三种规则',
      text: '假设（子证明）、蕴含消去、蕴含引入、析取消去——你刚才做的事，在格哈德·根岑 1934 年的自然演绎里就是全部的工具箱了。',
      history: 'H-GENTZEN',
    },
  ],

  'L0-16': [
    {
      id: 'L0-16-1', target: 'goal-text', place: 'bottom', advance: 'next',
      title: '综合题：目标 ¬A ∨ B，题设只有 A → B',
      text: '结论里既有否定又有析取，题设却只有一条蕴含。硬拆前提是拆不动的——这一关要靠经典逻辑的一件特殊工具。',
    },
    {
      id: 'L0-16-2', target: 'rules', place: 'top', advance: 'next',
      title: '先想：¬A ∨ B 与 A → B 其实是一回事',
      text: '“不是 A，就是 B”与“如果 A 那么 B”在经典逻辑里等价。所以这一关要证的是这条等价的一个方向。要拆开它，需要一个能凭空造出析取的规则。',
      action: '看看规则区里有没有“排中律”',
    },
    {
      id: 'L0-16-3', target: 'rules', place: 'top', advance: 'step',
      title: '动作：点“排中律”',
      text: '排中律说 A ∨ ¬A 恒成立。界面会列出所有可以取排中的命题，并优先挑出对目标有用的那一个（对 A 取排中）。',
      action: '点“排中律”，挑“对 A 用排中律：A ∨ ¬A”',
    },
    {
      id: 'L0-16-4', target: 'choices', place: 'top', advance: 'assume',
      title: '支 1：假设 A',
      text: '点 ∨E 看引导卡，然后开始第一支：假设 A。在支里用 p1（A → B）做 →E 得 B，再用 ∨I 得 ¬A ∨ B（B 在右边）。',
      action: '假设 A → →E 得 B → ∨I（取右边）',
    },
    {
      id: 'L0-16-5', target: 'rules', place: 'top', advance: 'next',
      title: '支 2：假设 ¬A，直接就得目标',
      text: '第二支更省事：假设 ¬A 本身就是目标 ¬A ∨ B 的左边那一支，直接点 ∨I（取左边）就得到目标。然后两条支都用 →I 合上。',
      action: '假设 ¬A → ∨I（取左边）→ →I 合上',
    },
    {
      id: 'L0-16-6', target: 'rules', place: 'top', advance: 'solved',
      title: '收尾：排中律 + 两支 → ∨E',
      text: '把 A ∨ ¬A 与两条合上的蕴含一起选中，点 ∨E，结论 ¬A ∨ B 成立。整个证明的骨架是“凭空分两种情况，每种都到目标”。',
      action: '选三条 → 点 ∨E',
    },
    {
      id: 'L0-16-7', target: null, place: 'center', advance: 'next',
      title: '这一关的两个注脚',
      text: '德摩根律（1847）说明了否定如何与且、或互换，而 ¬A ∨ B 与 A → B 的等价则是“实质蕴含”的标准定义。另一方面，整关的关键一步是排中律——布劳威尔与直觉主义者拒绝无条件使用它，所以他们不承认这个证明。两种立场都有人认真坚持，这不是“谁算错了”。',
      history: 'H-DEMORGAN',
    },
    {
      id: 'L0-16-8', target: null, place: 'center', advance: 'next',
      title: 'L0 训练场完成',
      text: '到这里，命题逻辑的 16 个训练关就全部走完了：引用前提、蕴含、合取、析取与分情况讨论、否定与反证、等价、排中律。接下来是 L1 代数证明——那里你会把 ∀E 用到实数公理上，推出中学课本里的公式。',
    },
  ],
};

/* ================= ③ 自动生成的简版引导（L1 / 未单独编写） ================= */
export function buildFallbackGuide(level, opts = {}) {
  const out = [];
  let goalText = opts.goalText || '';
  if (!goalText) {
    try { goalText = P(compileLevel(level).goal); } catch (e) { goalText = level.goal || '（目标）'; }
  }
  const names = (level.rules || []).filter((r) => RULES[r]).map((r) => RULES[r].name);

  out.push({
    id: level.id + '-fb-1', target: 'goal-text', place: 'bottom', advance: 'next',
    title: '目标：' + goalText,
    text: (level.teach || '') + '　先看清结论的形状：是蕴含、是否定、是等式，还是合取？结论的形状决定了第一步该点哪条规则。',
  });
  if (level.premiseText || (level.premises || []).length) {
    out.push({
      id: level.id + '-fb-2', target: 'facts', place: 'top', advance: 'next',
      title: '题设与公理是可用的起点',
      text: (level.premiseText || '题设已经列在“可用事实”里。') + '　带有 ∀ 的公理需要先用“全称消去 ∀E”实例化到具体对象上，才能拿来用；公理较多时可以先点“展开全称公理”批量生成实例。',
      history: (level.axiomSets || []).indexOf('F') >= 0 ? 'H-HILBERT-GRUNDLAGEN' : undefined,
    });
  } else {
    out.push({
      id: level.id + '-fb-2', target: 'facts', place: 'top', advance: 'next',
      title: '本关没有题设',
      text: '没有题设时，起点就是公理表里的公理。点“查看本关公理表”看清楚有哪些可用，再决定先实例化哪一条。',
    });
  }
  out.push({
    id: level.id + '-fb-3', target: 'rules', place: 'top', advance: 'next',
    title: '本关可用规则',
    text: names.length ? '允许使用的规则是：' + names.join('、') + '。不确定该点哪一条时，先点你觉得最像的那条——如果前提不足或是缺了子证明，界面会给出引导卡或明确的报错，不会让你卡死在“没反应”上。' : '本关的规则表为空，请检查关卡数据。',
    action: '卡住就点“提示”，它会按标准证明逐步告诉你下一步',
  });
  if (level.hintText) {
    out.push({
      id: level.id + '-fb-4', target: 'btn-hint', place: 'top', advance: 'next',
      title: '本关提示',
      text: level.hintText,
    });
  }
  return out;
}

/** 取一关的引导：优先用逐关编写的版本，否则自动生成。 */
export function guideForLevel(level, opts = {}) {
  if (!level) return [];
  const own = LEVEL_GUIDES[level.id];
  if (own && own.length) return own;
  return buildFallbackGuide(level, opts);
}

/** 全景导览 + 本关引导拼成的完整流程。 */
export function fullGuide(level, opts = {}) {
  const withTour = opts.withTour !== false;
  return (withTour ? DESK_TOUR : []).concat(guideForLevel(level, opts));
}

/* 供测试与界面使用：所有编写过的步骤 */
export const ALL_GUIDE_STEPS = DESK_TOUR.concat(...Object.values(LEVEL_GUIDES));

/** 引导里提到过的元素 id 全集（测试用它核对 index.html 里真的有这些元素）。 */
export function targetIds() {
  return [...new Set(ALL_GUIDE_STEPS.map((s) => s.target).filter(Boolean))];
}

/** 引导里引用过的数学史条目 id 全集。 */
export function historyIds() {
  return [...new Set(ALL_GUIDE_STEPS.map((s) => s.history).filter(Boolean))];
}
