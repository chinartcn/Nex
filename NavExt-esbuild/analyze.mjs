// 第一阶段：Exjs 依赖图分析 + 报告（只读，不产出构建产物、不改运行时）
//   node NavExt-esbuild/analyze.mjs          生成 dist/build-report.json + 控制台报告
//   node NavExt-esbuild/analyze.mjs --selftest  额外用虚拟数据自检分组算法
// 报告内容：页面→白名单、扩展清单、校验问题、频繁/极大项集、bundle 计划。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, maximalItemsets, planBundles } from './deps.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const REPORT = path.join(ROOT, 'dist', 'build-report.json');
const selftest = process.argv.includes('--selftest');

function pad(s, n) { return String(s).padEnd(n); }
function line(ch = '-', n = 64) { return ch.repeat(n); }

function printReport(r) {
  console.log(line('='));
  console.log(' Exjs 依赖图报告（第一阶段：只分析，不构建）');
  console.log(line('='));
  console.log(`页面 ${r.pages.length} 个 / 扩展 ${r.exts.length} 个 / 最小支持度 ${r.minSupport}`);
  if (r.skipped.length) console.log(`注意：${r.skipped.length} 个页面扩展数 >16，已跳过其子集枚举`);

  console.log('\n[1] 页面 → exjs 白名单');
  for (const p of r.pages) {
    console.log(`  ${pad(p.id, 10)} ${pad(p.html, 26)} ${p.exjs.length ? p.exjs.join(', ') : '(无)'}`);
  }

  console.log('\n[2] 可用扩展');
  for (const e of r.exts) {
    const flags = [e.enabled ? 'enabled' : 'DISABLED', e.entry || 'no-entry', e.built ? 'built' : 'source'];
    console.log(`  ${pad(e.id, 16)} ${flags.join(' / ')}`);
  }

  console.log('\n[3] 校验问题');
  if (!r.issues.length) console.log('  (无)');
  for (const i of r.issues) console.log(`  [${i.level}] ${i.page}: ${i.id} — ${i.msg}`);

  console.log('\n[4] 频繁项集 → 极大项集（支持度 = 依赖它的页面数）');
  if (!r.frequent.length) console.log('  (无：当前没有扩展被 2 个以上页面共同依赖)');
  for (const f of r.frequent) {
    const mark = r.maximal.includes(f) ? ' <= 极大' : '';
    console.log(`  {${f.items.join(', ')}}  支持度=${f.support}${mark}`);
  }

  console.log('\n[5] Bundle 计划');
  if (!r.plan.length) console.log('  (无页面)');
  for (const row of r.plan) {
    console.log(`  ${pad(row.page, 10)} -> ${row.bundles.length ? row.bundles.map((b) => b + '.js').join(' + ') : '(无 Exjs)'}`);
  }
  console.log('\n  共享 bundle：');
  if (!r.groups.length) console.log('    (无)');
  for (const g of r.groups) {
    console.log(`    ${g.name}.js  覆盖 ${g.support} 页: ${g.pages.join(', ')}  [${g.exjs.join(' + ')}]`);
  }

  const rawReqs = r.plan.reduce((n, row) => n + row.exjs.length, 0);
  const builtReqs = r.plan.reduce((n, row) => n + row.bundles.length, 0);
  console.log(`\n  请求数：逐扩展 ${rawReqs} -> 分组后 ${builtReqs}${rawReqs ? `（省 ${rawReqs - builtReqs}）` : ''}`);
}

// 虚拟数据自检：验证「a1,b1 / a2,b1+b2 / a3,b1+b2+b3」能正确合成 group-b1-b2 + b3
function selfTest() {
  console.log('\n' + line('='));
  console.log(' 算法自检（虚拟数据：3 页 / 3 扩展）');
  console.log(line('='));
  const pages = [
    { id: 'a1', exjs: ['b1'] },
    { id: 'a2', exjs: ['b1', 'b2'] },
    { id: 'a3', exjs: ['b1', 'b2', 'b3'] },
  ];
  const { maximal } = maximalItemsets(pages.map((p) => p.exjs), 2);
  const { rows, groups } = planBundles(pages, maximal);
  console.log('  极大项集:', maximal.map((f) => `{${f.items.join(',')}}@${f.support}`).join('  '));
  for (const row of rows) console.log(`  ${row.page} -> ${row.bundles.join(' + ') || '(无)'}`);
  for (const g of groups) console.log(`  ${g.name} 覆盖: ${g.pages.join(', ')}`);
  const ok =
    maximal.length === 1 && maximal[0].items.join() === 'b1,b2' &&
    rows.find((r) => r.page === 'a1').bundles.join() === 'b1' &&
    rows.find((r) => r.page === 'a2').bundles.join() === 'group-b1-b2' &&
    rows.find((r) => r.page === 'a3').bundles.join() === 'group-b1-b2,b3';
  console.log(ok ? '\n  PASS: 分组与预期一致' : '\n  FAIL: 分组与预期不符');
  return ok;
}

const r = await analyze({ minSupport: 2 });
printReport(r);

fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), ...r }, null, 2));
console.log(`\n报告已写入 ${path.relative(ROOT, REPORT)}`);

if (selftest && !selfTest()) process.exitCode = 1;
