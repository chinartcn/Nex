import http from 'node:http';
import path from 'node:path';
import { ROOT } from '../config.js';

// Phase 4：Vite 热更新接入（仅 dev 生效）
// 启动一个独立 Vite 开发服务器（默认 3001），直接消费 .ts/.tsx 源码并提供 HMR；
// 把 Nex 专属端点（/api、/@NavExt-ws、/_navext、/dist）代理回主服务（默认 3000）。
// 浏览器开发地址：http://localhost:3001
export async function startVite(config, mainPort, bus) {
  if (config.mode !== 'dev') return null;

  const { createServer } = await import('vite');

  let reactPlugin = [];
  try {
    const rp = await import('@vitejs/plugin-react');
    reactPlugin = [rp.default()];
  } catch (e) {
    console.warn('[Nex] @vitejs/plugin-react 未安装，TSX/React HMR 将不可用（仅 TS 可用）');
  }

  // 把总线客户端与引导脚本注入所有 HTML（经代理回主服务）
  const injectNex = {
    name: 'nex-inject',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          { tag: 'script', attrs: { src: '/_navext/bus.js', type: 'module' }, injectTo: 'body' },
          { tag: 'script', attrs: { src: '/_navext/navext.js', type: 'module' }, injectTo: 'body' },
          { tag: 'script', attrs: { src: '/_navext/bootstrap.js', type: 'module' }, injectTo: 'body' },
        ],
      };
    },
  };

  // 开发态：把 / 重写到显式主页（摒弃默认 index.html，主页在 nav-ext.config.js 指定）
  const home = (config.home && config.home.file) || 'page/index.html';
  const rewriteHome = {
    name: 'nex-rewrite-home',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
          req.url = '/' + home.replace(/^\/+/, '');
        }
        next();
      });
    },
  };

  // 开发态：把所有 .md 请求转发回主服务（默认 3000），由 Exserver 的 onRequest
  // 钩子渲染。否则 Vite 会把 .md 当静态文件原样返回（如根目录 README.md、
  // 以及任何不在 /page 下的 .md），与 prod(3000) 行为不一致。
  // 必须插在 Vite 自身静态中间件之前，否则会被先当成文件吐出。
  const nexMdProxy = {
    name: 'nex-md-proxy',
    configureServer(server) {
      const handler = (req, res, next) => {
        const url = req.url || '';
        const pathname = url.split('?')[0];
        if (!/\.md$/i.test(pathname)) return next();
        const opts = {
          host: '127.0.0.1',
          port: mainPort,
          method: req.method,
          path: url,
          headers: req.headers,
        };
        const proxyReq = http.request(opts, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', (err) => {
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
          res.end('markdown proxy error: ' + err.message);
        });
        req.pipe(proxyReq);
      };
      // 插到中间件栈最前，抢在 Vite 静态服务之前拦截 .md
      server.middlewares.stack.unshift({ route: '', handle: handler });
    },
  };

  const vite = await createServer({
    root: ROOT,
    configFile: false,
    plugins: [...reactPlugin, injectNex, rewriteHome, nexMdProxy],
    server: {
      port: config.vite?.port || 3001,
      strictPort: false,
      // HMR 用专属路径，避免抢占 /@NavExt-ws 的 upgrade（总线 WS 经代理回 3000）
      hmr: { path: '/__nex_hmr' },
      proxy: {
        '/api': { target: `http://localhost:${mainPort}`, changeOrigin: true },
        '/@NavExt-ws': { target: `ws://localhost:${mainPort}`, ws: true, changeOrigin: true },
        '/_navext': { target: `http://localhost:${mainPort}`, changeOrigin: true },
        '/dist': { target: `http://localhost:${mainPort}`, changeOrigin: true },
        // 内容路由（含 .md 渲染钩子）也代理回主服务，保证 dev 与 prod 渲染一致
        '/page': { target: `http://localhost:${mainPort}`, changeOrigin: true },
        '/preview': { target: `http://localhost:${mainPort}`, changeOrigin: true },
      },
    },
    optimizeDeps: { entries: ['Exjs/**/*.{ts,tsx}'] },
    logLevel: 'warn',
  });

  await vite.listen();

  // 「内容/后端变更 → 前端自动刷新」：复用 Vite 的 chokidar watcher 检测文件变化，
  // 再经两条互补通道通知浏览器：
  //   - Nex 总线 __nex:reload：覆盖 proxy 转发的 SSR 页(.md)、以及 3000 直连页
  //     （这些页注入了 bus.js 但没有 @vite/client，收不到 Vite 的 HMR）
  //   - Vite.ws full-reload：覆盖 Vite 直出、注入了 @vite/client 的前端模块页
  // 前端源码(.ts/.tsx)仍走 Vite 原生局部 HMR，不在此触发整页刷新。
  const FRONT_MODULE = /\.(ts|tsx|jsx|css)$/i;
  const SKIP_DIR = /^(Exjs|NavExt-TS|NavExt-React|NavExt-vite|NavExt-sub|NavExt-esbuild|node_modules|dist)\//;
  const CONTENT = /\.(md|html)$|^Exserver\/|^page\/|(^|\/)(nav-ext\.config|conf|sub|confi)\.js$/i;
  // server.conf.js 由 Exserver 运行时专门监听（负责更新内存 config 并自行广播），
  // 这里跳过，避免同一改动产生重复刷新信号。
  const EXSERVER_CONF = /(^|\/)server\.conf\.js$/i;
  let reloadTimer = null;
  vite.watcher.on('all', (_event, absFile) => {
    const rel = path.relative(ROOT, absFile).replace(/\\/g, '/');
    if (EXSERVER_CONF.test(rel)) return;
    if (!CONTENT.test(rel) || FRONT_MODULE.test(rel) || SKIP_DIR.test(rel)) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      // 通道1：Nex 总线（3000/3001 通吃，含 proxy 的 SSR 页）
      if (bus && typeof bus.broadcast === 'function') {
        bus.broadcast({
          type: '__nex:reload',
          scope: 'global',
          payload: { reason: 'content-change', file: rel },
        });
      }
      // 通道2：Vite 原生 full-reload（Vite 直出页）
      try { vite.ws.send({ type: 'full-reload', path: '*' }); } catch { /* ws 未就绪时忽略 */ }
    }, 180);
  });

  const url = vite.resolvedUrls?.local?.[0] || `http://localhost:${config.vite?.port || 3001}/`;
  console.log(`[Nex] Vite dev server: ${url} (HMR for Exjs & page)`);
  return vite;
}
