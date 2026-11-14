import path from 'node:path';

// 多主页路由：取代 1.x 的 home.routes。
// 主页由 nav-ext.config.js 显式指定，并支持按 path / host / env 选择不同主页。
// 优先级：routes(path) → routes(host) → routes(env) → home.file → 标记 home:true 的子页 → 兜底。

function matchPath(pattern, p) {
  // 支持 * 通配与精确匹配
  if (pattern === p) return true;
  if (!pattern.includes('*')) return false;
  const re = new RegExp(
    '^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'
  );
  return re.test(p);
}

function resolveFileFromRoute(r, subpages) {
  if (r.file) return r.file;
  if (r.id && subpages) {
    const pg = subpages.get ? subpages.get(r.id) : null;
    if (pg) return pg.url;
  }
  return null;
}

export function resolveHome(req, config, subpages) {
  const home = config.home || {};
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;
  const host = (req.headers.host || '').split(':')[0];
  const routes = Array.isArray(home.routes) ? home.routes : [];

  for (const r of routes) {
    if (r.path && matchPath(r.path, pathname)) {
      const f = resolveFileFromRoute(r, subpages);
      if (f) return f;
    }
    if (r.host && host && host.includes(r.host)) {
      const f = resolveFileFromRoute(r, subpages);
      if (f) return f;
    }
    if (r.env && process.env[r.env]) {
      const f = resolveFileFromRoute(r, subpages);
      if (f) return f;
    }
  }

  if (home.file) return home.file;

  // 兜底：标记为 home 的子页
  const hp = subpages && subpages.list ? subpages.list().find((p) => p.home) : null;
  if (hp) return hp.url;

  return 'page/index.html';
}

// 路径是否命中某条 home 路由（用于把路由 path 也当作主页入口）
export function isHomeRoute(pathname, config) {
  const routes = Array.isArray(config?.home?.routes) ? config.home.routes : [];
  return routes.some((r) => r.path && matchPath(r.path, pathname));
}

export { matchPath };
