import { ROOT } from '../config.js';

// Phase 4：Vite 热更新接入（仅 dev 生效）
// 启动一个独立 Vite 开发服务器（默认 3001），直接消费 .ts/.tsx 源码并提供 HMR；
// 把 Nex 专属端点（/api、/@NavExt-ws、/_navext、/dist）代理回主服务（默认 3000）。
// 浏览器开发地址：http://localhost:3001
export async function startVite(config, mainPort) {
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

  const vite = await createServer({
    root: ROOT,
    configFile: false,
    plugins: [...reactPlugin, injectNex, rewriteHome],
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
      },
    },
    optimizeDeps: { entries: ['Exjs/**/*.{ts,tsx}'] },
    logLevel: 'warn',
  });

  await vite.listen();
  const url = vite.resolvedUrls?.local?.[0] || `http://localhost:${config.vite?.port || 3001}/`;
  console.log(`[Nex] Vite dev server: ${url} (HMR for Exjs & page)`);
  return vite;
}
