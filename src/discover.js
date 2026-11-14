import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './config.js';

// 非扩展目录：由专门加载器处理，不计入扩展发现
const SKIP_DIRS = new Set(['security-policy']);

// 自动扫描：递归扫描 Exserver/ 与 Exjs/，按子目录识别扩展，无需 .js.list.json
export async function discoverExtensions(registry) {
  const kinds = [
    { dir: 'Exserver', kind: 'exserver' },
    { dir: 'Exjs', kind: 'exjs' },
  ];

  for (const { dir, kind } of kinds) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) continue;

    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (SKIP_DIRS.has(name)) continue; // security-policy 等单独加载
      const id = `${kind}:${name}`;

      // mod.js 提供元数据（可选）
      let meta = {};
      const modPath = path.join(base, name, 'mod.js');
      if (fs.existsSync(modPath)) {
        const m = await import(pathToFileURL(modPath).href + `?t=${Date.now()}`);
        meta = m.default ?? m;
      }

      registry.register({
        id,
        kind,
        name,
        path: path.join(dir, name),
        ...meta,
      });
    }
  }

  return registry;
}
