// NavExt-esbuild —— 生产打包管线
// 将每个 Exjs 的 TS/TSX 源打包为浏览器 ESM，输出到 dist/exjs/<name>.js
// TS 与 Exjs 统一走打包器（决议 Q3）：开发态由 Vite 提供 HMR，生产态由 esbuild 打包。
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..'); // Nex/
const EXJS = path.join(ROOT, 'Exjs');
const OUT = path.join(ROOT, 'dist', 'exjs');

fs.mkdirSync(OUT, { recursive: true });

const entries = fs
  .readdirSync(EXJS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const CANDIDATES = ['index.ts', 'index.tsx', 'client.tsx', 'index.js'];

for (const name of entries) {
  const entry = CANDIDATES.map((f) => path.join(EXJS, name, f)).find(fs.existsSync);
  if (!entry) {
    console.log(`[build] skip ${name} (no entry)`);
    continue;
  }
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: path.join(OUT, name + '.js'),
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
    jsx: 'automatic',
    logLevel: 'info',
  });
  console.log(`[build] ${name} -> dist/exjs/${name}.js`);
}
console.log('[build] done');
