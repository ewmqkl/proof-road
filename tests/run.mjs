// tests/run.mjs —— 一次性跑完全部测试
import { runAll } from './_runner.mjs';
import './kernel.test.mjs';
import './printer.test.mjs';
import './rules.test.mjs';
import './levels.test.mjs';
import './ui.test.mjs';
import './ui-play.test.mjs';
import './solver.test.mjs';

const r = await runAll('logic-proof-game 测试');
process.exit(r.fail ? 1 : 0);
