// NavExt-esbuild —— 生产打包管线（第二阶段：分组 bundle + 重写 HTML + 复制资源）
// 依赖 deps.mjs 的分组计划，把「多页共用的扩展集合」合并成一个 group-*.js，
// 单页独有多个扩展也合并成一个 bundle，减少请求数。
// 产物：
//   dist/Exjs/<bundle>.js       分组后的浏览器 ESM
//   dist/page/<id>/index.html   重写：注入该页 bundle 的 <script type="module">
//   dist/page/<id>/<自有资源>   index.css / index.js 等
//   dist/manifest.json          page -> bundles / bundle -> exjs 映射
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, buildManifest } from './deps.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DIST = path.join(ROOT, 'dist');
const DIST_EXJS = path.join(DIST, 'Exjs');
const DIST_PAGE = path.join(DIST, 'page');
const PAGE_SRC = path.join(ROOT, 'page');
const PAGE_ASSET_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.ico', '.webp']);
// 页面目录里的服务端配置文件不进产物（白名单已在构建期消费，配置无需下发浏览器）
const PAGE_CONFIG_FILES = new Set(['conf.js', 'sub.js', 'server.conf.js']);

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// HTML 注入 bundle 引用。插到 </body> 前；没有 </body> 就追加。
// 用绝对路径 /Exjs/<bundle>.js（服务端加 /Exjs 静态路由）。
function injectBundles(html, bundles) {
  const tags = bundles
    .map((b) => `<script type="module" src="/Exjs/${b}.js"></script>`)
    .join('\n');
  if (!tags) return html;
  return html.includes('</body>')
    ? html.replace('</body>', `  ${tags}\n</body>`)
    : html + '\n' + tags;
}

export async function buildAll({ log = console.log } = {}) {
  const analysis = await analyze({ minSupport: 2 });
  const { pages, exts, issues, plan } = analysis;
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) {
    throw new Error('白名单引用了不存在的扩展：' + errors.map((i) => `${i.page}→${i.id}`).join(', '));
  }
  const manifest = buildManifest(analysis);

  // 1. 清空旧产物（含旧的逐扩展 dist/exjs/，避免与新分组产物混淆）
  rmrf(path.join(DIST, 'exjs'));
  rmrf(DIST_EXJS);
  rmrf(DIST_PAGE);
  fs.mkdirSync(DIST_EXJS, { recursive: true });
  fs.mkdirSync(DIST_PAGE, { recursive: true });

  const extMap = new Map(exts.map((e) => [e.id, e]));

  // 2. 打包每个 bundle：用 stdin 汇总入口 import 组内所有扩展入口，
  //    再让 esbuild bundle 成一个自包含 ESM（组内的公共依赖只打一份）。
  //    组与组之间各自独立（请求数优先，接受组间少量重复）。
  const bundleNames = Object.keys(manifest.bundles);
  for (const name of bundleNames) {
    const b = manifest.bundles[name];
    const entries = b.exjs
      .map((id) => {
        const e = extMap.get(id);
        return e && e.entry ? path.join(ROOT, 'Exjs', id, e.entry) : null;
      })
      .filter(Boolean);
    if (!entries.length) {
      log(`[build] skip bundle ${name} (no entries)`);
      continue;
    }
    const out = path.join(DIST_EXJS, name + '.js');
    const imports = entries
      .map((f) => `import ${JSON.stringify('./' + path.relative(ROOT, f).replace(/\\/g, '/'))};`)
      .join('\n');
    await esbuild.build({
      stdin: { contents: imports, resolveDir: ROOT, sourcefile: `bundle-${name}.js`, loader: 'js' },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      outfile: out,
      loader: { '.ts': 'ts', '.tsx': 'tsx' },
      jsx: 'automatic',
      logLevel: 'silent',
    });
    const size = fs.statSync(out).size;
    log(`[build] bundle ${name}.js  [${b.exjs.join(' + ')}]  ${(size / 1024).toFixed(1)}kb`);
  }

  // 3. 逐页：复制自有资源 + 重写 HTML（注入 bundle 引用）
  const pageIds = Object.keys(manifest.pages);
  for (const id of pageIds) {
    const meta = manifest.pages[id];
    const srcDir = path.join(PAGE_SRC, id);
    const dstDir = path.join(DIST_PAGE, id);
    if (!fs.existsSync(srcDir)) {
      log(`[build] warn: page source missing: page/${id}`);
      continue;
    }
    fs.mkdirSync(dstDir, { recursive: true });
    for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!ent.isFile() || !PAGE_ASSET_EXT.has(path.extname(ent.name))) continue;
      if (PAGE_CONFIG_FILES.has(ent.name)) continue;
      const src = path.join(srcDir, ent.name);
      const dst = path.join(dstDir, ent.name);
      let data = fs.readFileSync(src, 'utf8');
      if (ent.name === 'index.html') data = injectBundles(data, meta.bundles);
      fs.writeFileSync(dst, data);
    }
    log(`[build] page ${id}  -> bundles: ${meta.bundles.join(', ') || '(none)'}`);
  }

  // 4. 写 manifest 与分析报告（保持两者一致：改白名单后只跑 build 也会刷新报告）
  const stamp = new Date().toISOString();
  fs.writeFileSync(
    path.join(DIST, 'manifest.json'),
    JSON.stringify({ generatedAt: stamp, ...manifest }, null, 2)
  );
  fs.writeFileSync(
    path.join(DIST, 'build-report.json'),
    JSON.stringify({ generatedAt: stamp, ...analysis }, null, 2)
  );

  const totalBundles = bundleNames.length;
  const rawReqs = plan.reduce((n, r) => n + r.exjs.length, 0);
  const builtReqs = plan.reduce((n, r) => n + r.bundles.length, 0);
  log(`[build] done: ${totalBundles} bundles, ${pageIds.length} pages; requests ${rawReqs} -> ${builtReqs}`);
  return { manifest, analysis };
}

// CLI 直接运行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAll().catch((e) => {
    console.error('[build] failed:', e.message);
    process.exit(1);
  });
}
