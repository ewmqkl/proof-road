// tests/_dom.mjs —— 所有需要 DOM 的测试共用的打桩
//
// 为什么要共用一套：run.mjs 会先把所有测试文件 import 一遍，再依次跑用例。
// 如果两个文件各自建一套打桩并覆盖 globalThis.document，后导入的那个会把 document 换掉，
// 而 app.js 里的 $() 是在调用时取全局 document 的——先导入的文件里渲染好的内容就“消失”了。
// 所以这里只装一次，所有测试文件共用同一个 registry。

export function makeEl(tag) {
  return {
    // 真实 DOM 里 tagName 是大写，打桩也统一成大写，避免测试辅助函数被大小写坑到
    tagName: String(tag).toUpperCase(), children: [], _html: '', textContent: '', className: '',
    hidden: false, disabled: false, value: '', title: '', style: {},
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener() {},
    setAttribute(k, v) { this[k] = v; },
    set onclick(fn) { this._onclick = fn; },
    get onclick() { return this._onclick; },
  };
}

const registry = new Map();
const memStore = new Map();

const documentStub = {
  createElement: (tag) => makeEl(tag),
  getElementById: (id) => { if (!registry.has(id)) registry.set(id, makeEl('div')); return registry.get(id); },
  addEventListener: () => {},
};

const localStorageStub = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
};

let installed = false;

/** 装好全局打桩（只装一次），返回共用的 registry 与 localStorage。 */
export function installDom() {
  if (!installed) {
    globalThis.document = documentStub;
    globalThis.localStorage = localStorageStub;
    globalThis.prompt = () => null;
    // 让界面以为用户开了“减少动态效果”：屏幕切换会走同步分支，
    // 于是 go('desk') 之后立刻就能断言当前屏幕，也不用等擦除动画那 400ms。
    globalThis.window = {
      innerWidth: 1280,
      innerHeight: 900,
      scrollTo() {},
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    };
    installed = true;
  }
  return { registry, document: documentStub, localStorage: localStorageStub, memStore };
}

/** 清空存档。注意：**不清空 registry** ——
    界面的事件绑定是 app.js 在导入时挂到元素上的，把元素换掉会让按钮全部失灵。 */
export function clearStorage() {
  memStore.clear();
}

/** 把一棵打桩元素树里的文字全拼起来（含 innerHTML 里写进去的那部分）。 */
export function flatten(el, depth = 0) {
  if (!el || depth > 8) return '';
  let s = (el.textContent || '') + (el._html || '');
  for (const c of el.children || []) s += flatten(c, depth + 1);
  return s;
}

/** 深度优先遍历打桩元素树。 */
export function walk(el, fn, depth = 0) {
  if (!el || depth > 8) return;
  fn(el, depth);
  for (const c of el.children || []) walk(c, fn, depth + 1);
}

/** 收集整棵树里的按钮。 */
export function buttons(root) {
  const out = [];
  walk(root, (el) => { if (el.tagName === 'BUTTON') out.push(el); });
  return out;
}

/** 元素的“可读文字”。真实 DOM 里 textContent 会把子元素的文字也算进来，
    打桩元素却各存一份，所以这里统一用 flatten 取整棵子树的文字，两边行为才一致。 */
export function labelOf(el) { return flatten(el); }

/** 按文字找按钮（用 labelOf 匹配，能命中文字写在子 span 里的按钮）。 */
export function buttonByText(root, re) {
  return buttons(root).find((b) => re.test(labelOf(b))) || null;
}

/** 点一下文字匹配的按钮；返回是否点到了。 */
export function clickButton(root, re) {
  const b = buttonByText(root, re);
  if (!b || typeof b.onclick !== 'function') return false;
  b.onclick();
  return true;
}
