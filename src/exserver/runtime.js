import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../config.js';

// 为扩展构造 ctx：注入 bus / fetch(超时+abort) / timer / interval / hook + 运行时上下文
function makeCtx(ext, bus, ctxExtras = {}) {
  const timers = new Set();
  const track = (id) => {
    timers.add(id);
    return id;
  };
  return {
    ext,
    bus,
    config: ext.config || {},
    ...ctxExtras,
    fetch: async (url, opts = {}) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.timeout || 10000);
      timers.add(t);
      try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
      } finally {
        clearTimeout(t);
        timers.delete(t);
      }
    },
    timer: (fn, ms) => track(setTimeout(fn, ms)),
    interval: (fn, ms) => track(setInterval(fn, ms)),
    hook: ext.id,
    // Phase 1：扩展日志经总线汇聚（log(level, ...args)）
    log: ctxExtras.log
      ? (level, ...args) => ctxExtras.log.server(level, `[${ext.id}]`, ...args)
      : (level, ...args) => {
          const fn = console[level] || console.log;
          fn(`[${ext.id}]`, ...args);
        },
  };
}

// 按 requires 拓扑排序（依赖先加载）
function topo(exts) {
  const byName = new Map(exts.map((e) => [e.name, e]));
  const seen = new Set();
  const out = [];
  const visit = (e) => {
    if (seen.has(e.name)) return;
    seen.add(e.name);
    for (const dep of e.requires || []) {
      const d = byName.get(dep) || exts.find((x) => x.id === dep);
      if (d && !seen.has(d.name)) visit(d);
    }
    out.push(e);
  };
  exts.forEach(visit);
  return out;
}

// 加载 Exserver 扩展：index.js 钩子 + server.conf.js 配置，并注册总线处理
export async function loadExservers(registry, bus, ctxExtras = {}) {
  const found = registry.list().filter((e) => e.kind === 'exserver');
  const loaded = [];
  for (const e of found) {
    const dir = path.join(ROOT, e.path);
    let mod = {};
    const indexPath = path.join(dir, 'index.js');
    if (fs.existsSync(indexPath)) {
      const m = await import(pathToFileURL(indexPath).href + `?t=${Date.now()}`);
      mod = m.default ?? m;
    }
    let config = {};
    const confPath = path.join(dir, 'server.conf.js');
    if (fs.existsSync(confPath)) {
      const c = await import(pathToFileURL(confPath).href + `?t=${Date.now()}`);
      config = c.default ?? c;
    }
    loaded.push({ ...e, mod, config });
  }

  const ordered = topo(loaded);
  for (const e of ordered) {
    const ctx = makeCtx(e, bus, ctxExtras);
    if (typeof e.mod.onReady === 'function') {
      try {
        e.mod.onReady(ctx);
      } catch (err) {
        console.error(`[exserver:${e.name}] onReady error`, err);
      }
    }
    if (typeof e.mod.onMessage === 'function') {
      bus.on('*', (env, conn) => {
        try {
          e.mod.onMessage(env, { ...ctx, conn });
        } catch (err) {
          console.error(`[exserver:${e.name}] onMessage error`, err);
        }
      });
    }
  }
  return loaded;
}
