import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

// Exjs 运行时：收集客户端扩展，提供清单、文件解析、浏览器引导脚本
// Phase 3：优先使用 esbuild 构建产物（dist/exjs/<name>.js），未构建时回退到 .js 源。
export function createExjsRuntime(registry, root = ROOT) {
  const exts = registry.list().filter((e) => e.kind === 'exjs');

  function pickSourceEntry(dir) {
    for (const f of ['index.ts', 'index.tsx', 'index.js', 'client.js']) {
      if (fs.existsSync(path.join(dir, f))) return f;
    }
    return null;
  }

  function manifest(dev = false) {
    return exts
      .map((e) => {
        // dev：直接消费 Exjs 源码，由 Vite(3001) 转译并 HMR
        if (dev) {
          const tsEntry = path.join(root, 'Exjs', e.name, 'index.ts');
          if (fs.existsSync(tsEntry)) {
            return {
              id: e.id,
              name: e.name,
              enabled: e.enabled,
              entry: 'index.ts',
              base: '/Exjs',
              built: false,
              dev: true,
            };
          }
        }
        const built = path.join(root, 'dist', 'exjs', e.name + '.js');
        if (fs.existsSync(built)) {
          return {
            id: e.id,
            name: e.name,
            enabled: e.enabled,
            entry: `${e.name}.js`,
            base: '/dist/exjs',
            built: true,
          };
        }
        const src = pickSourceEntry(path.join(root, e.path));
        if (!src) return null;
        return {
          id: e.id,
          name: e.name,
          enabled: e.enabled,
          entry: src,
          base: `/_navext/exjs/${e.name}`,
          built: false,
        };
      })
      .filter(Boolean);
  }

  function resolveFile(name, file) {
    const dir = path.join(root, 'Exjs', name);
    const fp = path.resolve(dir, file);
    if (!fp.startsWith(path.resolve(dir))) return null;
    if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return null;
    return fp;
  }

  return { manifest, resolveFile, exts };
}

// 浏览器引导：等待 NexBus 就绪 → 拉取清单 → 逐个 import 已启用的扩展入口
export const BOOTSTRAP_SOURCE = `
(async function () {
  function waitBus() {
    return new Promise(function (r) {
      if (window.NexBus) return r();
      var i = setInterval(function () { if (window.NexBus) { clearInterval(i); r(); } }, 20);
    });
  }
  await waitBus();
  try {
    // 加载 NavExt-sub 路由库（暴露 global.__NexRouter → Nex.router）
    try { await import('/_navext/sub.js'); } catch (e) { console.warn('[Nex] sub.js load failed', e); }
    var res = await fetch('/api/exjs');
    var data = await res.json();
    for (var ext of data.extensions) {
      if (!ext.enabled || !ext.entry) continue;
      try {
        await import(ext.base + '/' + ext.entry);
        console.log('[Nex] exjs loaded', ext.id, ext.built ? '(built)' : '(source)');
      } catch (e) {
        console.error('[Nex] exjs load failed', ext.id, e);
      }
    }
  } catch (e) {
    console.error('[Nex] bootstrap error', e);
  }
})();
`;
