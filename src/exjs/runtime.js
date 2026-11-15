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
              // 必须带上扩展目录名：Vite 的模块图按 /Exjs/<name>/index.ts 解析，
              // 少了它 bootstrap 会去 import('/Exjs/index.ts') 直接 404。
              base: '/Exjs/' + e.name,
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
    // Exjs 是 UI 扩展，需要页面预留挂载点。纯内容页（如服务端渲染的 .md）
    // 没有挂载点，加载扩展毫无意义且会产生动态 import 报错，直接跳过。
    var host = document.querySelector('#exjs-panel') || document.querySelector('[data-nex-exjs]');
    if (!host) return;
    var res = await fetch('/api/exjs');
    var data = await res.json();
    if (!data.extensions || !data.extensions.length) return;
    // @vitejs/plugin-react 要求在运行被其转换的模块前安装 React Refresh preamble。
    // Nex 的 Exjs 是运行时「动态 import」的，页面又是自定义 HTML（不经 Vite
    // 默认入口转换），插件无法自动注入 preamble，否则报
    // "@vitejs/plugin-react can't detect preamble"。这里按需从 Vite 安装：
    // /@react-refresh 是 Vite(3001) 的同源虚拟模块；3000 直连无此模块时静默跳过。
    // 仅开发态需要：/api/exjs 会带回 devMode；prod 走 dist 产物，无需也没
    // 有 /@react-refresh（3000 无 Vite），跳过可避免无谓的 404 控制台报错。
    if (data.devMode && !window.__vite_plugin_react_preamble_installed__) {
      try {
        var rr = await import('/@react-refresh');
        var R = rr.default || rr;
        if (R && typeof R.injectIntoGlobalHook === 'function') R.injectIntoGlobalHook(window);
        window.$RefreshReg$ = function () {};
        window.$RefreshSig$ = function () { return function (t) { return t; }; };
        window.__vite_plugin_react_preamble_installed__ = true;
      } catch (e) { /* 非 Vite 环境：无 /@react-refresh，忽略 */ }
    }
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
