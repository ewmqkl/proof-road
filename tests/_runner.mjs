// tests/_runner.mjs —— 零依赖测试运行器（沙箱内 node --test 无法 spawn 子进程）
// 用法：node tests/_runner.mjs
import assert from 'node:assert/strict';

const suites = [];
export function test(name, fn) { suites.push({ name, fn }); }
export function suite(name, fn) { fn(); }

export async function runAll(label) {
  let pass = 0, fail = 0;
  console.log('=== ' + label + ' ===');
  for (const s of suites) {
    try {
      await s.fn();
      pass++;
      console.log('  ✓ ' + s.name);
    } catch (e) {
      fail++;
      console.log('  ✗ ' + s.name);
      console.log('      ' + String(e && e.message ? e.message : e).split('\n').slice(0, 4).join('\n      '));
    }
  }
  console.log('--- ' + label + ': ' + pass + ' 通过, ' + fail + ' 失败 ---');
  return { pass, fail };
}
