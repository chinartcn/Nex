import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

// Exjs 运行时：收集客户端扩展，提供清单、文件解析、浏览器引导脚本
// Phase 3：优先使用 esbuild 构建产物（dist/Exjs/<name>.js），未构建时回退到 .js 源。
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
        const built = path.join(root, 'dist', 'Exjs', e.name + '.js');
        if (fs.existsSync(built)) {
          return {
            id: e.id,
            name: e.name,
            enabled: e.enabled,
            entry: `${e.name}.js`,
            base: '/dist/Exjs',
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

// 浏览器引导：等待 NexBus → 判定 dev/prod → 加载本页 Exjs。
//   prod：页面 HTML 已注入 <script type=module src=/Exjs/<bundle>.js>，bundle
//         自包含且 defineExjs 内部自等总线，bootstrap 不再动态 import（避免重复）。
//   dev ：页面是源码 HTML，按 conf.js 的 exjs 白名单裁剪清单，只 import 声明的扩展。
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
    // Exjs 是 UI 扩展，需要挂载点。纯内容页（SSR 的 .md）没有，直接跳过。
    var host = document.querySelector('#exjs-panel') || document.querySelector('[data-nex-exjs]');
    if (!host) return;

    var res = await fetch('/api/exjs');
    var data = await res.json();

    // prod 构建页：有 bundle script 则说明扩展已由构建产物加载，不重复 import；
    // 没有 bundle script 则说明该页白名单为空（构建期未生成 script），直接结束。
    // 关键：prod 绝不能走下面的动态 import 源码分支——dist/Exjs 已被分组构建移除，
    // 且 .ts 源码未经 Vite 转译会 SyntaxError。
    if (!data.devMode) {
      var hasBundles = !!document.querySelector('script[src^="/Exjs/"]');
      window.__NEX_BOOT_MODE__ = hasBundles ? 'bundled' : 'none';
      return;
    }

    // dev：按当前页 conf.js 的白名单裁剪，只加载声明的扩展。
    var allow = null;
    if (data.devMode && data.pageExjs) {
      var pageId = currentPageId();
      // 主页（/、/preview/* 等）路径里没有 page/<id>，问 /api/home 拿到主页文件再解析
      if (!pageId) {
        try {
          var h = await (await fetch('/api/home')).json();
          if (h && h.home) {
            var hm = String(h.home).match(/(?:^|\\/)page\\/([^\\/]+)\\//);
            if (hm) pageId = hm[1];
          }
        } catch (e) {}
      }
      if (pageId && Object.prototype.hasOwnProperty.call(data.pageExjs, pageId)) {
        allow = data.pageExjs[pageId] || [];
      }
    }

    var list = (data.extensions || []).filter(function (e) {
      if (!e.enabled || !e.entry) return false;
      if (!allow) return true;               // 未取到白名单时保持旧行为（加载全部）
      return allow.indexOf(e.name) !== -1 || allow.indexOf(e.id) !== -1;
    });
    if (!list.length) return;

    // React Refresh preamble 仅 dev + Vite 需要（prod 走 esbuild 产物）。
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
    window.__NEX_BOOT_MODE__ = 'source';
    for (var ext of list) {
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

  // 从 URL 推断当前子页 id：/page/<id>/... 直接取；主页则异步问 /api/home。
  // 这里用同步正则覆盖绝大多数场景；主页（/、/preview/*）回退为 null（加载全部，
  // 但主页通常显式声明白名单，见下方 home 兜底）。
  function currentPageId() {
    var m = location.pathname.match(/(?:^|\\/)page\\/([^\\/]+)\\//);
    return m ? m[1] : null;
  }
})();
`;
