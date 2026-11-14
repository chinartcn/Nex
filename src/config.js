import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// 项目根目录：锚定到 Nex/（与运行 cwd 无关）
export const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

// 加载全局 .js 配置；改动后带时间戳热重载
export async function loadConfig() {
  const file = path.join(ROOT, 'nav-ext.config.js');
  if (!fs.existsSync(file)) {
    return { mode: 'prod', server: { port: 3000 }, security: { fsWrite: false } };
  }
  const mod = await import(pathToFileURLSafe(file) + `?t=${Date.now()}`);
  return mod.default ?? mod;
}

function pathToFileURLSafe(p) {
  return 'file://' + p;
}
