import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { ROOT } from './config.js';
import { isPathSafe } from './security/core.js';
import { BUS_CLIENT_SOURCE } from './bus/client.js';
import { BOOTSTRAP_SOURCE } from './exjs/runtime.js';
import { CLIENT_API_SOURCE, ROUTER_SOURCE } from './client/api.js';
import { resolveHome, isHomeRoute } from './home.js';
import {
  contentType,
  readRaw,
  parseUrlEncoded,
  parseJson,
  parseMultipart,
  multipartBoundary,
} from './web/body.js';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ts': 'text/javascript',
  '.tsx': 'text/javascript',
};

// dev 端口(3000)回退只服务「浏览器可直接解析」的文件；.ts/.tsx 等需经 Vite(3001) 转译
const DEV_EXT = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.svg', '.map', '.ico', '.png',
]);

export function createServer(registry, config, deps) {
  const { bus, exjs, security, subpages, log, requestHooks = [] } = deps;
  const devMode = config.mode === 'dev';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const p = url.pathname;

    security.applyHeaders(res); // CSP / CORS 统一注入

    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 路径拦截（安全策略）
    if (security.isBlocked(p)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'blocked by security policy' }));
      return;
    }

    // ---- Exserver 请求拦截钩子（onRequest）----
    // 在核心 API / 静态处理之前执行；钩子返回 {status,type,body} 即短路响应，
    // 返回 undefined / null 则放行交由后续管线（如 Markdown 渲染器拦截 *.md）
    // 核心 /api 与 /_navext 内部路由不受钩子影响，保证控制面安全
    if (requestHooks.length && !p.startsWith('/api/') && !p.startsWith('/_navext/')) {
      for (const h of requestHooks) {
        try {
          const r = await h.fn(req, url, h.ctx);
          if (r && typeof r === 'object' && 'status' in r) {
            const type = r.type || 'text/plain; charset=utf-8';
            const raw = typeof r.body === 'string' ? Buffer.from(r.body, 'utf8') : r.body;
            // 服务端渲染的 HTML（如 Markdown 钩子产物）也注入总线客户端，
            // 使其能收到后端变更的 __nex:reload 广播自动刷新（3000/3001 通吃）。
            const out = /^text\/html/i.test(type) && raw
              ? Buffer.from(injectNexScripts(raw.toString('utf8')), 'utf8')
              : raw;
            res.writeHead(r.status, { 'content-type': type });
            res.end(out);
            return;
          }
        } catch (err) {
          if (log) log.server('error', `[request-hook:${h.id}]`, err);
          else console.error(`[request-hook:${h.id}]`, err);
        }
      }
    }

    // ---- API ----
    if (req.method === 'GET' && p === '/api/extensions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ extensions: registry.list() }));
      return;
    }
    if (req.method === 'POST' && p === '/api/extensions/toggle') {
      const body = await readBody(req);
      const params = new URLSearchParams(body); // 标准 Web 格式
      const ext = registry.toggle(params.get('id'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: !!ext, extension: ext }));
      return;
    }
    if (req.method === 'GET' && p === '/api/exjs') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ extensions: exjs.manifest(devMode) }));
      return;
    }

    // ---- 子页清单（Phase 5：NavExt-sub）----
    if (req.method === 'GET' && p === '/api/pages') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ pages: subpages ? subpages.list() : [] }));
      return;
    }

    // ---- Phase 1：日志汇聚（server.log / client.log 经总线统一）----
    if (req.method === 'GET' && p === '/api/logs') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ logs: log ? log.list() : [] }));
      return;
    }
    if (req.method === 'POST' && p === '/api/logs/clear') {
      if (log) log.clear();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ---- 当前解析到的主页（Phase 5 多主页路由可见性）----
    if (req.method === 'GET' && p === '/api/home') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ home: resolveHome(req, config, subpages) }));
      return;
    }

    // ---- 安全策略 API ----
    if (req.method === 'GET' && p === '/api/security') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(security.toJSON()));
      return;
    }
    if (req.method === 'POST' && p === '/api/security/policy') {
      const params = new URLSearchParams(await readBody(req));
      const patch = Object.fromEntries(params.entries());
      if ('fsWrite' in patch) patch.fsWrite = patch.fsWrite === 'true';
      if ('allowFsWrite' in patch)
        patch.allowFsWrite = patch.allowFsWrite.split(',').filter(Boolean);
      const result = security.patch(patch, {
        writable: config.security?.apiWritable === true,
      });
      if (!result.ok) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // 演示 FS 写门禁（受安全策略控制）
    if (req.method === 'POST' && p === '/api/fs/write') {
      const params = new URLSearchParams(await readBody(req));
      const ext = params.get('ext');
      if (!security.canWriteFs(ext)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'fs write denied by policy' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ext }));
      return;
    }

    // ---- Phase 6：标准 Web 格式端点 ----
    // FormData（multipart/x-www-form-urlencoded/json）解析回显
    if (req.method === 'POST' && p === '/api/form') {
      const ct = contentType(req);
      const raw = await readRaw(req);
      let fields = [];
      if (ct === 'application/json') {
        const obj = parseJson(raw);
        fields = Object.entries(obj).map(([k, v]) => ({ name: k, value: String(v) }));
      } else if (ct === 'application/x-www-form-urlencoded') {
        fields = parseUrlEncoded(raw).map(([k, v]) => ({ name: k, value: v }));
      } else if (ct === 'multipart/form-data') {
        const b = multipartBoundary(req.headers['content-type']);
        fields = parseMultipart(raw, b).map((part) => ({
          name: part.name,
          filename: part.filename,
          contentType: part.contentType,
          value: part.filename ? `<file ${part.data.length}B>` : part.data.toString('utf8'),
        }));
      } else {
        res.writeHead(415, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'unsupported content-type: ' + ct }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, contentType: ct, fields }));
      return;
    }

    // Standard Web Streams 出站（分片流式响应，演示 ReadableStream）
    if (req.method === 'GET' && p === '/api/stream') {
      const n = Math.max(1, Math.min(20, Number(url.searchParams.get('n')) || 5));
      const delay = Math.max(0, Number(url.searchParams.get('delay')) || 100);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'x-accel-buffering': 'no',
        'cache-control': 'no-cache',
      });
      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 1; i <= n; i++) {
            controller.enqueue(Buffer.from(`chunk ${i}/${n}\n`));
            await new Promise((r) => setTimeout(r, delay));
          }
          controller.close();
        },
      });
      Readable.fromWeb(stream).pipe(res);
      return;
    }

    // ---- 总线客户端库 ----
    if (p === '/_navext/bus.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(BUS_CLIENT_SOURCE);
      return;
    }
    // ---- 规范化客户端 API（window.Nex）----
    if (p === '/_navext/navext.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(CLIENT_API_SOURCE);
      return;
    }
    // ---- NavExt-sub 路由库（独立可加载）----
    if (p === '/_navext/sub.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(ROUTER_SOURCE);
      return;
    }
    // ---- 引导脚本 ----
    if (p === '/_navext/bootstrap.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(BOOTSTRAP_SOURCE);
      return;
    }
    // ---- Exjs 源文件 ----
    if (p.startsWith('/_navext/exjs/')) {
      const rest = p.slice('/_navext/exjs/'.length);
      const [name, ...parts] = rest.split('/');
      const fp = exjs.resolveFile(name, parts.join('/'));
      if (!fp) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      return sendFile(res, fp, false);
    }
    // ---- Exserver 静态资源（如 Markdown 渲染器的 styles.css）----
    if (p.startsWith('/_navext/exserver/')) {
      const rest = p.slice('/_navext/exserver/'.length);
      const [name, ...parts] = rest.split('/');
      const dir = path.join(ROOT, 'Exserver', name);
      const fp = path.resolve(dir, parts.join('/'));
      if (
        !fp.startsWith(path.resolve(dir)) ||
        !fs.existsSync(fp) ||
        !fs.statSync(fp).isFile()
      ) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      return sendFile(res, fp, false);
    }
    // ---- 构建产物 dist/ ----
    if (p.startsWith('/dist/')) {
      const fp = resolveStatic(path.join(ROOT, p.slice(1)), path.join(ROOT, 'dist'));
      if (!fp) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      return sendFile(res, fp, false);
    }

    // ---- 静态 page/（HTML 自动注入总线 + 规范化 API + 引导）----
    let rel;
    // 主页与命中的 home 路由 path 都走 resolveHome（多主页路由，Phase 5）
    if (p === '/' || isHomeRoute(p, config)) rel = resolveHome(req, config, subpages);
    else if (p.startsWith('/page/')) rel = p.slice(1);
    else if (p === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    } else {
      // dev 回退：直接提供源码（.ts/.tsx 等）与 page/ 资源，便于 3000 端口也能看
      if (devMode) {
        const devFp = tryDevStatic(p);
        if (devFp) return sendFile(res, devFp, path.extname(devFp) === '.html');
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    const fp = path.join(ROOT, rel);
    if (!isPathSafe(rel, ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    return sendFile(res, fp, path.extname(fp) === '.html');
  });

  return server;
}

function resolveStatic(target, root) {
  const fp = path.resolve(root, '.' + path.sep + path.relative(root, path.resolve(root, target)));
  if (!fp.startsWith(path.resolve(root))) return null;
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return null;
  return fp;
}

// dev 回退：把 /Exjs、/page 等源码作为静态文件直接返回（不含需转译的 .ts）
function tryDevStatic(rel) {
  if (!rel.startsWith('/')) return null;
  const fp = path.resolve(ROOT, '.' + rel);
  if (!isPathSafe(rel, ROOT)) return null;
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return null;
  if (!DEV_EXT.has(path.extname(fp))) return null;
  return fp;
}

const NEX_SCRIPTS =
  '\n<script src="/_navext/bus.js"></script>\n' +
  '<script src="/_navext/navext.js"></script>\n' +
  '<script src="/_navext/bootstrap.js"></script>\n';

// 给 HTML 注入总线客户端 + 规范化 API + 引导脚本（静态页与 SSR 钩子产物共用）
function injectNexScripts(str) {
  return str.includes('</body>')
    ? str.replace('</body>', NEX_SCRIPTS + '</body>')
    : str + NEX_SCRIPTS;
}

function sendFile(res, fp, inject) {
  const ext = path.extname(fp);
  const ct = MIME[ext] || 'application/octet-stream';
  let data = fs.readFileSync(fp);
  if (inject) {
    data = Buffer.from(injectNexScripts(data.toString('utf8')), 'utf8');
  }
  res.writeHead(200, { 'content-type': ct + (ct.startsWith('text') ? '; charset=utf-8' : '') });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}
