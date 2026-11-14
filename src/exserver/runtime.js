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
    ...ctxExtras,
    // 用 getter 实时读取，配合 server.conf.js 文件监听热更新（改动无需重启）
    get config() {
      return ext.config || {};
    },
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
    e.ctx = ctx; // 挂回 loaded 条目，供 index.js 构造请求钩子（onRequest）
    if (typeof e.mod.onReady === 'function') {
      try {
        e.mod.onReady(ctx);
      } catch (err) {
        console.error(`[exserver:${e.name}] onReady error`, err);
      }
    }
    // server.conf.js 热更新：改动配置无需重启，下次请求即生效
    // 注意：手机/编辑器多为「原子保存」(写临时文件再 rename 覆盖，或先删后写)，
    // 直接 watch 文件 + import(文件路径) 会在文件短暂消失的间隙报
    // "Cannot find module"，且一次保存触发多个 event 会连刷错误。故采用：
    //   监听目录(rename 不丢 watch) + 防抖合并 event + 读文本用 data URL 求值
    //   (绕开路径 module resolution 竞态) + ENOENT 静默重试 + 内容去重。
    const confPath = path.join(ROOT, e.path, 'server.conf.js');
    if (fs.existsSync(confPath)) {
      try {
        const confDir = path.dirname(confPath);
        let reloadTimer = null;
        let lastSrc = null;
        const attemptReload = async (tries = 8) => {
          for (let i = 0; i < tries; i++) {
            let src;
            try {
              src = fs.readFileSync(confPath, 'utf8');
            } catch (err) {
              if (err.code === 'ENOENT') {
                // 「先删后写」间隙：稍后重试，不报错刷屏
                await new Promise((r) => setTimeout(r, 120));
                continue;
              }
              console.error(`[exserver:${e.name}] 热更新读取失败：${err.message}`);
              return;
            }
            if (src === lastSrc) return; // 内容未变，跳过
            try {
              // data URL 求值：server.conf.js 为纯配置(无相对 import)，
              // 只要此刻读到完整字节即可加载，不受 rename 间隙影响。
              const href = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
              const c = await import(href);
              e.config = c.default ?? c;
              lastSrc = src;
              console.log(`[exserver:${e.name}] server.conf.js 已热更新`);
              return;
            } catch (err) {
              // 语法错误等真实失败：打印一次即可，不重试
              console.error(`[exserver:${e.name}] 热更新失败：${err.message}`);
              return;
            }
          }
          // 多次重试仍读不到文件（可能被删除/移动）：静默放弃，退化为重启生效
        };
        fs.watch(confDir, (_event, filename) => {
          if (filename && path.basename(filename) !== 'server.conf.js') return;
          if (reloadTimer) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => {
            reloadTimer = null;
            attemptReload();
          }, 150); // 防抖：把一次保存产生的多个 event 合并成一次加载
        });
      } catch {
        /* 部分平台 fs.watch 不可用，忽略即退化为重启生效 */
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
