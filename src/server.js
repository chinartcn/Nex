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

// 路由自描述清单：/api/routes 与文档共用同一事实来源，避免漂移。
const API_ROUTES = [
  { method: 'GET', path: '/api/health', desc: '健康检查：状态/模式/运行时长/版本' },
  { method: 'GET', path: '/api/stats', desc: '运行指标：请求数/日志量/连接数/扩展数等' },
  { method: 'GET', path: '/api/routes', desc: '本路由清单（API 自描述）' },
  { method: 'GET', path: '/api/bus/clients', desc: '当前 WebSocket 总线连接快照' },
  { method: 'POST', path: '/api/bus/broadcast', desc: '经 HTTP 向总线广播事件（受 apiBroadcast 门控）', gated: true },
  { method: 'GET', path: '/api/config', desc: '脱敏后的当前生效配置（运维排障）' },
  { method: 'PATCH', path: '/api/config', desc: '运行时配置补丁（受 apiWritable 门控，白名单字段，重启失效）', gated: true },
  { method: 'GET', path: '/api/extensions', desc: '全部已发现扩展（含禁用者）' },
  { method: 'GET', path: '/api/extensions/:id', desc: '单扩展详情：元数据/能力/运行时配置' },
  { method: 'GET', path: '/api/extensions/:id/config', desc: '读取扩展配置文件内容' },
  { method: 'PATCH', path: '/api/extensions/:id/config', desc: '更新扩展配置并写回 .js 配置（受 apiWritable 门控）', gated: true },
  { method: 'POST', path: '/api/extensions/toggle', desc: '启停扩展（内存态，支持 enabled 显式指定）' },
  { method: 'GET', path: '/api/exjs', desc: '客户端扩展清单与构建 manifest' },
  { method: 'GET', path: '/api/manifest', desc: '生产构建 manifest' },
  { method: 'GET', path: '/api/pages', desc: '子页清单' },
  { method: 'GET', path: '/api/home', desc: '当前解析到的主页' },
  { method: 'GET', path: '/api/logs', desc: '统一日志缓冲' },
  { method: 'POST', path: '/api/logs/clear', desc: '清空日志缓冲' },
  { method: 'GET', path: '/api/security', desc: '当前安全策略' },
  { method: 'POST', path: '/api/security/policy', desc: '运行时策略补丁（受 apiWritable 门控）', gated: true },
  { method: 'POST', path: '/api/fs/write', desc: 'FS 写门禁演示（受 fsWrite 门控）', gated: true },
  { method: 'POST', path: '/api/form', desc: '标准 Web 格式解析回显' },
  { method: 'GET', path: '/api/stream', desc: 'Standard Web Streams 分片出站' },
];

export function createServer(registry, config, deps) {
  const {
    bus, exjs, security, subpages, log,
    requestHooks = [], pageExjs = new Map(), exservers = [],
  } = deps;
  // Exserver 加载后的运行时条目（含 config / mod / ctx），供扩展管理 API 合并；
  // registry 本身只保留可序列化的元数据，避免 mod/ctx（函数/socket）被 JSON 化。
  const extRuntime = new Map(exservers.map((e) => [e.id, e]));
  const apiWritable = () => config.security?.apiWritable === true;
  const devMode = config.mode === 'dev';
  // prod 下页面来自构建产物 dist/page/，dev 下来自源 page/
  const pageRoot = devMode ? path.join(ROOT, 'page') : path.join(ROOT, 'dist', 'page');

  // ── 可观测性指标（内存态，进程重启清零）──
  const startedAt = Date.now();
  const metrics = { requests: 0, byStatus: {}, apiRequests: 0, notFound: 0 };
  const RECENT_N = 20;
  const recent = []; // 最近请求环形缓冲（供排障）

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const p = url.pathname;

    // 请求计数 + 最近请求记录（在响应结束时结算状态码）
    metrics.requests++;
    const reqStart = Date.now();
    if (p.startsWith('/api/')) metrics.apiRequests++;
    res.on('finish', () => {
      const code = res.statusCode;
      metrics.byStatus[code] = (metrics.byStatus[code] || 0) + 1;
      if (code === 404) metrics.notFound++;
      recent.unshift({ t: reqStart, method: req.method, path: p, status: code, ms: Date.now() - reqStart });
      if (recent.length > RECENT_N) recent.pop();
    });

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

    // ---- 可观测性 API ----
    // 健康检查：进程存活 / 模式 / 运行时长
    if (req.method === 'GET' && p === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptimeMs: Date.now() - startedAt,
        mode: config.mode,
        version: '2.0',
        time: Date.now(),
      }));
      return;
    }
    // 运行指标：请求数 / 状态分布 / 日志量 / 连接数 / 扩展与页面数
    if (req.method === 'GET' && p === '/api/stats') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        uptimeMs: Date.now() - startedAt,
        requests: metrics.requests,
        apiRequests: metrics.apiRequests,
        byStatus: { ...metrics.byStatus },
        notFound: metrics.notFound,
        busClients: bus ? bus.clients.size : 0,
        logs: log ? log.list().length : 0,
        extensions: registry.list().length,
        pages: subpages ? subpages.list().length : 0,
        recent,
      }));
      return;
    }
    // 路由自描述：与 API_ROUTES 单一事实来源
    if (req.method === 'GET' && p === '/api/routes') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ routes: API_ROUTES }));
      return;
    }
    // 总线连接快照
    if (req.method === 'GET' && p === '/api/bus/clients') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        count: bus ? bus.clients.size : 0,
        clients: bus && typeof bus.clientInfo === 'function' ? bus.clientInfo() : [],
      }));
      return;
    }
    // HTTP 触发总线广播：受 security.apiBroadcast 门控（默认最小授权）
    if (req.method === 'POST' && p === '/api/bus/broadcast') {
      if (!security.canBroadcast()) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'bus broadcast denied by policy (enable security.apiBroadcast)' }));
        return;
      }
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'invalid JSON body' }));
        return;
      }
      const type = typeof body.type === 'string' ? body.type.trim() : '';
      if (!type) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'missing "type"' }));
        return;
      }
      // 禁止外部调用覆盖内部保留事件，防止伪造刷新/日志/路由信号
      const RESERVED = new Set([
        '__nex:reload', 'log:event', 'log:cleared', 'security-policy-changed',
        'subpage:open:ok', 'server-ready', 'server-pong', 'server-stream:echo',
        'config-changed', 'extension-toggled', 'extension-config-changed',
      ]);
      if (RESERVED.has(type)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'reserved event type: ' + type }));
        return;
      }
      const scope = typeof body.scope === 'string' && body.scope ? body.scope : 'global';
      const envelope = { type, scope, payload: body.payload ?? null, _from: 'http' };
      bus.broadcast(envelope);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, delivered: bus.clients.size, envelope }));
      return;
    }

    // ---- 配置自省（运维排障）----
    if (req.method === 'GET' && p === '/api/config') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        config: redact(config),
        runtime: {
          mode: config.mode,
          port: config.server?.port,
          apiWritable: apiWritable(),
          security: security ? security.toJSON() : redact(config.security || {}),
        },
        note: '运行时快照；PATCH 仅内存态生效，重启失效',
      }));
      return;
    }
    if (req.method === 'PATCH' && p === '/api/config') {
      if (!apiWritable()) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'config api not writable (enable security.apiWritable)' }));
        return;
      }
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'invalid JSON body' }));
        return;
      }
      // 只放行已知安全的展示类字段，避免运行时改写路由/安全等结构性配置。
      const ALLOWED = ['site.title', 'site.description', 'site.accent', 'home.file'];
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
      const bad = keys.filter((k) => !ALLOWED.includes(k));
      if (!keys.length || bad.length) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          reason: bad.length ? 'unsupported config fields: ' + bad.join(', ') : 'empty patch',
          allowed: ALLOWED,
        }));
        return;
      }
      const applied = [];
      for (const k of keys) {
        const [section, field] = k.split('.');
        if (!config[section] || typeof config[section] !== 'object') config[section] = {};
        config[section][field] = body[k];
        applied.push(k);
      }
      // resolveHome 每次请求实时读 config.home，故 home.file 改动下一次请求即生效
      if (bus) bus.broadcast({ type: 'config-changed', scope: 'global', payload: { applied } });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, applied, persistent: false, config: redact(config) }));
      return;
    }

    // ---- 扩展管理（详情 / 配置读写 / 启停增强）----
    let extm;
    if (req.method === 'GET' && (extm = p.match(/^\/api\/extensions\/([^/]+)\/config$/))) {
      const id = safeDecode(extm[1]);
      const e = registry.get(id);
      if (!e) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'extension not found: ' + id }));
        return;
      }
      const rt = extRuntime.get(id);
      const confFile = extConfFile(e);
      const cfg = rt ? (rt.config || {}) : readConfigFile(confFile);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id, kind: e.kind, file: relPath(confFile), config: cfg || {} }));
      return;
    }
    if (req.method === 'PATCH' && (extm = p.match(/^\/api\/extensions\/([^/]+)\/config$/))) {
      if (!apiWritable()) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'config api not writable (enable security.apiWritable)' }));
        return;
      }
      const id = safeDecode(extm[1]);
      const e = registry.get(id);
      if (!e) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'extension not found: ' + id }));
        return;
      }
      let patch;
      try { patch = JSON.parse(await readBody(req)); }
      catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'invalid JSON body' }));
        return;
      }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'config patch must be a JSON object' }));
        return;
      }
      const rt = extRuntime.get(id);
      const confFile = extConfFile(e);
      const current = rt ? (rt.config || {}) : (readConfigFile(confFile) || {});
      const merged = { ...current, ...patch };
      let src;
      try { src = serializeConfig(merged); }
      catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: err.message }));
        return;
      }
      try { fs.writeFileSync(confFile, src, 'utf8'); }
      catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'write failed: ' + err.message }));
        return;
      }
      // 同步内存态：Exserver 的 server.conf.js watcher 也会异步刷新，但这里先保证立即可读
      if (rt) rt.config = merged;
      e.config = merged;
      if (bus) {
        bus.broadcast({ type: 'extension-config-changed', scope: 'global', payload: { id, config: redact(merged) } });
        bus.broadcast({ type: '__nex:reload', scope: 'global', payload: { reason: 'extension-config', ext: id } });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, file: relPath(confFile), config: redact(merged) }));
      return;
    }
    if (req.method === 'GET' && (extm = p.match(/^\/api\/extensions\/([^/]+)$/))) {
      const id = safeDecode(extm[1]);
      const e = registry.get(id);
      if (!e) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'extension not found: ' + id }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(publicExtension(e, extRuntime.get(id))));
      return;
    }

    // ---- API ----
    if (req.method === 'GET' && p === '/api/extensions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ extensions: registry.list().map((e) => publicExtension(e, extRuntime.get(e.id))) }));
      return;
    }
    if (req.method === 'POST' && p === '/api/extensions/toggle') {
      const params = new URLSearchParams(await readBody(req)); // 标准 Web 格式
      const id = params.get('id');
      let ext;
      if (params.has('enabled')) {
        // 显式置位（幂等），便于运维脚本精确控制；缺省仍为切换，向后兼容
        const e = registry.get(id);
        if (e) { e.enabled = params.get('enabled') === 'true'; ext = e; }
      } else {
        ext = registry.toggle(id);
      }
      if (ext && bus) {
        bus.broadcast({ type: 'extension-toggled', scope: 'global', payload: { id: ext.id, enabled: ext.enabled } });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: !!ext,
        extension: ext ? publicExtension(ext, extRuntime.get(ext.id)) : null,
      }));
      return;
    }
    if (req.method === 'GET' && p === '/api/exjs') {
      // dev 模式下 Exjs 的 .ts/.tsx 源码只能由 Vite(3001) 转译，3000 直连
      // 无法加载（会 404）。故仅在经 Vite 代理（带 x-nex-via-vite 头）时
      // 下发 dev 源码清单；直连 3000 返回空清单，避免无意义的 404 与报错。
      const viaVite = req.headers['x-nex-via-vite'] === '1';
      const list = devMode && !viaVite ? [] : exjs.manifest(devMode);
      // prod：构建后每个页面的 bundle 已写进 HTML，清单仅作信息展示，下发给
      // 构建 manifest 的 bundle 计划；bootstrap 在 prod 不会据此动态 import。
      let bundles = null;
      let manifestPages = null;
      if (!devMode) {
        try {
          const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'manifest.json'), 'utf8'));
          bundles = mf.bundles || null;
          manifestPages = mf.pages || null;
        } catch { /* dist 未构建时忽略 */ }
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        extensions: list,
        viaVite,
        devMode,
        // 页面 → exjs 白名单（dev 下 bootstrap 据此裁剪，收敛到只加载声明的扩展）
        pageExjs: devMode ? Object.fromEntries(pageExjs) : undefined,
        bundles,
        pages: manifestPages,
      }));
      return;
    }
    // prod 构建 manifest（页面→bundle、bundle→扩展）
    if (req.method === 'GET' && p === '/api/manifest') {
      try {
        const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'manifest.json'), 'utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(mf));
      } catch {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'dist/manifest.json 不存在，请先 npm run build' }));
      }
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
      if ('apiBroadcast' in patch) patch.apiBroadcast = patch.apiBroadcast === 'true';
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
    // ---- 分组 bundle：/Exjs/<bundle>.js -> dist/Exjs/<bundle>.js ----
    if (p.startsWith('/Exjs/')) {
      const rest = p.slice('/Exjs/'.length);
      const root = path.join(ROOT, 'dist', 'Exjs');
      const fp = path.resolve(root, rest);
      if (!fp.startsWith(path.resolve(root)) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
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

    // rel 形如 page/<id>/index.html；prod 映射到 dist/page/<id>/index.html，
    // dev 映射到源 page/<id>/index.html。路径安全约束在 pageRoot 内。
    const relNorm = rel.replace(/^\/+/, '');
    const sub = relNorm.startsWith('page/') ? relNorm.slice('page/'.length) : relNorm;
    let fp = path.resolve(pageRoot, sub);
    // 目录形式（/page/a1/）补 index.html，与标准静态服务行为一致
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
      fp = path.join(fp, 'index.html');
    }
    if (!fp.startsWith(path.resolve(pageRoot) + path.sep) ||
        !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
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

/* ── 配置自省 / 扩展管理辅助 ── */

// 敏感键名脱敏：/api/config 只读，绝不暴露 token/secret 等凭据
const SENSITIVE_KEY = /(secret|token|password|passwd|credential|apikey|api_key|authorization|private|access_key)/i;
export function redact(value, key = '') {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null) return null;
  if (SENSITIVE_KEY.test(key)) return '***';
  if (Array.isArray(value)) return value.map((v) => redact(v, '')).filter((v) => v !== undefined);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const r = redact(v, k);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return value;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function relPath(fp) {
  return path.relative(ROOT, fp).split(path.sep).join('/');
}

// 只取目录名拼配置文件路径，杜绝 id 夹带路径穿越
function extConfFile(e) {
  const base = e.kind === 'exserver' ? 'Exserver' : 'Exjs';
  const file = e.kind === 'exserver' ? 'server.conf.js' : 'conf.js';
  return path.join(ROOT, base, path.basename(String(e.path || '')), file);
}

// 读取 .js 配置（纯 `export default {…}`，本地受信任文件）：去注释后求值对象字面量
function readConfigFile(fp) {
  try {
    let src = fs.readFileSync(fp, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const m = src.match(/export\s+default\s+([\s\S]*?);?\s*$/);
    if (!m) return {};
    return new Function('return (' + m[1].replace(/;\s*$/, '') + ')')();
  } catch { return {}; }
}

// 写回 .js 配置：拒绝函数/不可序列化值，避免静默丢失扩展配置里的回调
function serializeConfig(obj) {
  const json = JSON.stringify(obj, (_k, v) => {
    if (typeof v === 'function' || typeof v === 'symbol' || v === undefined)
      throw new Error('配置含函数或不可序列化值，不支持通过 API 写回');
    return v;
  }, 2);
  return '// 由配置管理 API 更新（PATCH /api/extensions/:id/config）\nexport default ' + json + ';\n';
}

// 扩展公开视图：过滤 mod/ctx（函数/socket），只暴露可序列化元数据与能力标志
function publicExtension(e, rt) {
  const out = {
    id: e.id,
    kind: e.kind,
    name: e.name,
    path: e.path,
    description: e.description,
    author: e.author,
    requires: Array.isArray(e.requires) ? e.requires : [],
    enabled: e.enabled !== false,
    loaded: !!rt,
  };
  if (rt) {
    out.hooks = {
      onRequest: typeof rt.mod?.onRequest === 'function',
      onReady: typeof rt.mod?.onReady === 'function',
      onMessage: typeof rt.mod?.onMessage === 'function',
    };
    out.config = rt.config || {};
  } else if (e.kind === 'exjs') {
    out.config = e.config || {};
  }
  return out;
}
