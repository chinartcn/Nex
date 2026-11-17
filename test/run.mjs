// NavExt 2.0 全量测试运行器（零依赖）
//   node test/run.mjs            -> 依次跑 prod 与 dev 双模式
//   node test/run.mjs --mode=prod
//   node test/run.mjs --mode=dev
// 结果输出：控制台 + /workspace/test-report.json

import path from 'node:path';
import fs from 'node:fs';
import {
  Suite, printSummary, http, wsConnect, browserCheck, dumpDom, startServer,
} from './harness.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPORT = '/workspace/test-report.json';

const modeArg = (process.argv.find((a) => a.startsWith('--mode=')) || '').split('=')[1];
const MODES = modeArg ? [modeArg] : ['prod', 'dev'];

/* ─────────────── 构建产物组（不依赖服务）────────────── */
async function buildSuite() {
  const s = new Suite('构建产物与依赖分析（离线）');
  await s.test('构建产物齐全', async (t) => {
    const need = [
      'dist/manifest.json', 'dist/build-report.json',
      'dist/Exjs/example-ext.js',
      'dist/page/a1/index.html', 'dist/page/a1/index.js', 'dist/page/a1/index.css',
      'dist/page/a2/index.html',
    ];
    for (const f of need) t.check(fs.existsSync(path.join(ROOT, f)), `${f} 存在`);
  });
  await s.test('manifest 内容与白名单一致', async (t) => {
    const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/manifest.json'), 'utf8'));
    t.equal(mf.pages.a1.exjs[0], 'example-ext', 'a1 白名单含 example-ext');
    t.equal(mf.pages.a2.exjs.length, 0, 'a2 白名单为空');
    t.equal(mf.bundles['example-ext'].built !== false, true, 'bundle built 非 false');
    t.equal(mf.bundles['example-ext'].file, 'Exjs/example-ext.js', 'bundle 文件路径为大写 Exjs');
  });
  await s.test('依赖分析自检 --selftest', async (t) => {
    const { execFileSync } = await import('node:child_process');
    let out = '';
    try { out = execFileSync('node', ['NavExt-esbuild/analyze.mjs', '--selftest'], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    t.include(out, 'PASS', '自检输出含 PASS');
    t.check(!/FAIL/.test(out), '自检无 FAIL');
  });
  return s;
}

/* ─────────────── HTTP + 静态 + 主页路由 ─────────────── */
async function httpSuite(base) {
  const s = new Suite(`HTTP 端点 / 静态资源 / 主页路由 [${base}]`);
  const get = (p) => http(base + p);

  await s.test('主页 / 返回 200 且注入 Nex 引导脚本', async (t) => {
    const r = await get('/');
    t.equal(r.status, 200, 'GET / = 200');
    t.include(r.text, '/_navext/bus.js', '注入总线客户端');
    t.include(r.text, '/_navext/bootstrap.js', '注入 bootstrap');
  });
  await s.test('子页 index.html 与目录形式均 200', async (t) => {
    for (const p of ['/page/a1/index.html', '/page/a2/index.html', '/page/a1/', '/page/a2/']) {
      const r = await get(p);
      t.equal(r.status, 200, `GET ${p} = 200`);
    }
  });
  await s.test('子页 JS/CSS 资源 200', async (t) => {
    for (const p of ['/page/a1/index.js', '/page/a1/index.css', '/page/a2/index.js']) {
      const r = await get(p);
      t.equal(r.status, 200, `GET ${p} = 200`);
    }
  });
  await s.test('bundle /Exjs/example-ext.js 200 且为 JS', async (t) => {
    const r = await get('/Exjs/example-ext.js');
    t.equal(r.status, 200, 'GET bundle = 200');
    t.check(/javascript/.test(r.headers['content-type'] || ''), 'Content-Type 为 javascript');
    t.check(r.text.length > 10000, `bundle 有实际内容 (${r.text.length}B)`);
  });
  await s.test('客户端库端点 200', async (t) => {
    for (const p of ['/_navext/bus.js', '/_navext/navext.js', '/_navext/sub.js', '/_navext/bootstrap.js']) {
      const r = await get(p);
      t.equal(r.status, 200, `GET ${p} = 200`);
    }
  });
  await s.test('Markdown 渲染：README.md 200 + 标题色注入', async (t) => {
    const r = await get('/README.md');
    t.equal(r.status, 200, 'GET README.md = 200');
    t.check(/text\/html/.test(r.headers['content-type'] || ''), '返回 text/html');
    t.include(r.text, 'color:#4f6ef7', '标题内联色注入');
    t.include(r.text, '--accent-heading', 'CSS 变量兜底注入');
  });
  await s.test('Markdown 渲染：page/docs/hello.md', async (t) => {
    const r = await get('/page/docs/hello.md');
    t.equal(r.status, 200, 'GET hello.md = 200');
    t.include(r.text, '<h1', '渲染出 h1');
  });
  await s.test('主页多路由 /preview/* 命中 a2', async (t) => {
    const r = await get('/preview/a1');
    t.equal(r.status, 200, 'GET /preview/a1 = 200');
    t.include(r.text, 'A2', '命中 a2 主页内容');
  });
  await s.test('/favicon.ico 返回 204', async (t) => {
    const r = await get('/favicon.ico');
    t.equal(r.status, 204, 'GET favicon = 204');
  });
  await s.test('Exserver 静态资源 styles.css 200', async (t) => {
    const r = await get('/_navext/exserver/markdown-render/styles.css');
    t.equal(r.status, 200, 'GET styles.css = 200');
  });
  return s;
}

/* ─────────────── API 端点 ─────────────── */
async function apiSuite(base) {
  const s = new Suite(`API 端点 [${base}]`);
  const get = (p) => http(base + p);
  const post = (p, body, headers = {}) => http(base + p, { method: 'POST', body, headers });

  await s.test('/api/extensions 返回扩展清单', async (t) => {
    const r = await get('/api/extensions');
    t.equal(r.status, 200, 'status 200');
    const j = r.json();
    t.check(Array.isArray(j.extensions) && j.extensions.length >= 1, 'extensions 非空数组');
  });
  await s.test('/api/exjs 清单 + built 标志正确', async (t) => {
    const r = await get('/api/exjs');
    const j = r.json();
    t.check(Array.isArray(j.extensions), 'extensions 为数组');
    const ext = j.extensions.find((e) => e.name === 'example-ext');
    if (ext) {
      t.equal(ext.built, !j.devMode, `built 与模式一致 (devMode=${j.devMode})`);
      t.include(ext.base, '/Exjs', 'base 指向大写 Exjs');
    }
    if (j.devMode) {
      // 直连 3000 时 viaVite=false 且清单为空（避免直连加载 .ts 源码 404）——这是正确设计；
      // 经 Vite(3001) 代理的 viaVite=true + 白名单在下面的 Vite 用例中单独验证。
      t.equal(j.viaVite, false, 'dev 直连 3000 时 viaVite=false（设计如此）');
      t.equal(j.extensions.length, 0, 'dev 直连 3000 时不下发源码清单');
      t.check(j.pageExjs && j.pageExjs.a1 && j.pageExjs.a1[0] === 'example-ext', 'dev 下发 a1 白名单');
    } else {
      t.check(j.bundles && j.bundles['example-ext'], 'prod 下发 bundle 计划');
      t.check(j.pages && j.pages.a1, 'prod 下发页面映射');
    }
  });
  await s.test('/api/manifest 返回构建 manifest', async (t) => {
    const r = await get('/api/manifest');
    t.equal(r.status, 200, 'status 200');
    t.check(!!r.json().pages, '含 pages');
  });
  await s.test('/api/pages 返回子页清单', async (t) => {
    const r = await get('/api/pages');
    const j = r.json();
    t.check(Array.isArray(j.pages), 'pages 为数组');
    t.check(j.pages.length >= 2, `子页数 >= 2 (${j.pages.length})`);
  });
  await s.test('/api/logs 返回日志数组', async (t) => {
    const r = await get('/api/logs');
    t.check(Array.isArray(r.json().logs), 'logs 为数组');
  });
  await s.test('/api/home 返回主页解析', async (t) => {
    const r = await get('/api/home');
    t.check(typeof r.json().home === 'string', 'home 为字符串');
  });
  await s.test('/api/security 返回安全策略', async (t) => {
    const r = await get('/api/security');
    const j = r.json();
    t.equal(j.fsWrite, false, '默认 fsWrite=false');
    t.check(Array.isArray(j.allowFsWrite), 'allowFsWrite 为数组');
  });
  await s.test('/api/extensions/toggle (URLSearchParams)', async (t) => {
    const before = (await get('/api/extensions')).json();
    const target = before.extensions.find((e) => e.kind === 'exjs') || before.extensions[0];
    const r = await post('/api/extensions/toggle', `id=${encodeURIComponent(target.id)}`, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    t.equal(r.status, 200, 'status 200');
    t.check(typeof r.json().ok === 'boolean', '返回 ok 布尔');
    // 立刻切回，避免影响后续测试
    await post('/api/extensions/toggle', `id=${encodeURIComponent(target.id)}`, {
      'content-type': 'application/x-www-form-urlencoded',
    });
  });
  return s;
}

/* ─────────────── 标准 Web 格式 ─────────────── */
async function webFormatSuite(base) {
  const s = new Suite(`标准 Web 格式（FormData / JSON / Streams）[${base}]`);
  const post = (p, body, headers = {}) => http(base + p, { method: 'POST', body, headers });

  await s.test('/api/form — JSON', async (t) => {
    const r = await post('/api/form', JSON.stringify({ a: 1, b: 'x' }), { 'content-type': 'application/json' });
    const j = r.json();
    t.equal(r.status, 200, 'status 200');
    t.equal(j.contentType, 'application/json', 'contentType 回显');
    t.check(j.fields.some((f) => f.name === 'a' && f.value === '1'), '字段 a=1');
  });
  await s.test('/api/form — URLSearchParams', async (t) => {
    const r = await post('/api/form', 'x=10&y=hello', { 'content-type': 'application/x-www-form-urlencoded' });
    const j = r.json();
    t.equal(j.contentType, 'application/x-www-form-urlencoded', 'contentType 回显');
    t.check(j.fields.some((f) => f.name === 'x' && f.value === '10'), '字段 x=10');
  });
  await s.test('/api/form — multipart/FormData', async (t) => {
    const fd = new FormData();
    fd.append('user', 'nex');
    fd.append('file', new Blob(['abc'], { type: 'text/plain' }), 'a.txt');
    const r = await post('/api/form', fd);
    const j = r.json();
    t.equal(j.contentType, 'multipart/form-data', 'contentType 回显');
    t.check(j.fields.some((f) => f.name === 'user' && f.value === 'nex'), '普通字段 user');
    t.check(j.fields.some((f) => f.filename === 'a.txt' && /3B/.test(f.value)), '文件字段带文件名与大小');
  });
  await s.test('/api/form — 不支持类型返回 415', async (t) => {
    const r = await post('/api/form', 'raw', { 'content-type': 'text/plain' });
    t.equal(r.status, 415, 'status 415');
  });
  await s.test('/api/stream — 分片流式响应', async (t) => {
    const r = await http(base + '/api/stream?n=4&delay=10');
    t.equal(r.status, 200, 'status 200');
    t.check(/chunk 1\/4/.test(r.text), '含首片');
    t.check(/chunk 4\/4/.test(r.text), '含末片');
  });
  return s;
}

/* ─────────────── 安全策略 ─────────────── */
async function securitySuite(base) {
  const s = new Suite(`安全策略（CSP / CORS / 门禁）[${base}]`);

  await s.test('响应头注入 CSP / CORS / no-store', async (t) => {
    const r = await http(base + '/');
    const h = r.headers;
    t.include(h['content-security-policy'] || '', "default-src 'self'", 'CSP default-src self');
    t.include(h['content-security-policy'] || '', 'unsafe-inline', 'CSP 放开内联样式');
    t.equal(h['cache-control'], 'no-store', '禁用缓存');
    t.equal(h['access-control-allow-origin'], '*', 'CORS allow-origin');
    t.include(h['access-control-allow-methods'] || '', 'POST', 'CORS methods 含 POST');
  });
  await s.test('CORS 预检 OPTIONS 返回 204', async (t) => {
    const r = await http(base + '/api/extensions', { method: 'OPTIONS' });
    t.equal(r.status, 204, 'OPTIONS = 204');
  });
  await s.test('blockedPaths：/admin 被拦截', async (t) => {
    const r = await http(base + '/admin');
    t.equal(r.status, 403, 'GET /admin = 403');
  });
  await s.test('FS 写门禁：默认拒绝', async (t) => {
    const r = await http(base + '/api/fs/write', {
      method: 'POST', body: 'ext=exserver:example-ext',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    t.equal(r.status, 403, '默认 fsWrite=false 应拒绝 403');
  });
  await s.test('安全策略 API：默认不可写', async (t) => {
    const r = await http(base + '/api/security/policy', {
      method: 'POST', body: 'fsWrite=true',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    t.equal(r.status, 403, 'apiWritable=false 应拒绝 403');
  });
  await s.test('路径穿越被拒绝', async (t) => {
    const r = await http(base + '/page/../../../etc/passwd');
    t.check(r.status === 404 || r.status === 403, `穿越路径被拒 (${r.status})`);
  });
  return s;
}

/* ─────────────── WebSocket 总线 ─────────────── */
async function wsSuite(base) {
  const s = new Suite(`@NavExt-ws 全双工总线 [${base}]`);
  const wsUrl = base.replace(/^http/, 'ws') + '/@NavExt-ws';

  let ws;
  try {
    await s.test('WS 握手 101 并建立全双工连接', async (t) => {
      ws = await wsConnect(wsUrl);
      t.check(ws.open, 'WS 已连接（101 Switching Protocols）');
      // 注：server-ready / subpage:list 是服务启动期广播，此刻连接已错过；
      // 广播与双向通信能力由后续 client-ping / stream:data / subpage:open 用例验证。
      const pong = ws.waitFor((m) => m && m.type === 'server-pong', 3000);
      ws.send({ type: 'client-ping', scope: 'global', payload: { handshake: 1 } });
      t.check(!!(await pong), '握手后可立即收发消息');
    });
    await s.test('全双工 client-ping → server-pong', async (t) => {
      const pong = ws.waitFor((m) => m && m.type === 'server-pong', 4000);
      ws.send({ type: 'client-ping', scope: 'global', payload: { n: 42 } });
      const m = await pong;
      t.check(!!m, '收到 server-pong');
      if (m) t.equal(m.payload.echo.n, 42, '回显 payload 正确');
    });
    await s.test('stream:data 中继扇出 + 服务端回声', async (t) => {
      const relay = ws.waitFor((m) => m && m.type === 'stream:data', 4000);
      const echo = ws.waitFor((m) => m && m.type === 'server-stream:echo', 4000);
      ws.send({ type: 'stream:data', scope: 'global', payload: { name: 't1', seq: 1, chunk: 'hi', done: false } });
      const [r, e] = await Promise.all([relay, echo]);
      t.check(!!r, '收到 stream:data 回环');
      t.check(!!e, '收到 server-stream:echo');
      if (r) t.equal(r.payload.chunk, 'hi', '回环 chunk 正确');
    });
    await s.test('subpage:open → subpage:open:ok（服务端权威解析）', async (t) => {
      const ok = ws.waitFor((m) => m && m.type === 'subpage:open:ok', 4000);
      ws.send({ type: 'subpage:open', scope: 'global', payload: { id: 'a1' } });
      const m = await ok;
      t.check(!!m, '收到 subpage:open:ok');
      if (m) t.include(m.payload.url, 'a1', '解析出 a1 子页 URL');
    });
    await s.test('非法 JSON 消息不崩溃连接', async (t) => {
      ws.send('{not json');
      const pong = ws.waitFor((m) => m && m.type === 'server-pong', 4000);
      ws.send({ type: 'client-ping', scope: 'global', payload: { ok: 1 } });
      const m = await pong;
      t.check(!!m, '非法消息后连接仍可用');
    });
  } finally {
    if (ws) try { ws.close(); } catch {}
  }
  return s;
}

/* ─────────────── 浏览器运行时 ─────────────── */
async function browserSuite(base, mode) {
  const s = new Suite(`浏览器运行时（console 错误 / 渲染）[${base}]`);
  const pages = [
    base + '/',
    base + '/page/a1/',
    base + '/page/a2/',
    base + '/README.md',
  ];
  // 每个 URL 用独立 chromium 进程采集：同一进程内多 tab 快速切换时，
  // 被关闭 tab 的页面脚本（bus.js 的 WS / bootstrap 的 fetch）会被中断，
  // 其 console 错误会串扰到下一个 tab，造成 "Failed to fetch" 误报。
  let basePort = mode === 'dev' ? 9460 : 9450;
  for (const url of pages) {
    try {
      const results = await browserCheck([url], { port: basePort++ });
      const r = results[0];
      await s.test(`${r.url.replace(base, '') || '/'} — 0 console error`, async (t) => {
        t.equal(r.errors.length, 0, `console 错误数 = ${r.errors.length}`);
        for (const e of r.errors.slice(0, 3)) t.check(false, e.slice(0, 160));
      });
    } catch (e) {
      await s.test(`${url.replace(base, '') || '/'} — 浏览器采集可用`, (t) => t.check(false, 'browserCheck 抛错: ' + e.message));
    }
  }
  // Markdown 颜色注入（DOM 层）
  await s.test('README.md 渲染后标题色为 #4f6ef7', async (t) => {
    const dom = await dumpDom(base + '/README.md');
    t.check(/color:\s*#4f6ef7/i.test(dom) || /color:#4f6ef7/i.test(dom), 'DOM 含 #4f6ef7');
    t.check(/<h1[^>]*>/.test(dom), 'DOM 含 h1 标题');
  });
  return s;
}

/* ─────────────── 主流程 ─────────────── */
async function runMode(mode) {
  console.log(`\n\n##########  模式: ${mode.toUpperCase()}  ##########`);
  const base = 'http://localhost:3000';
  const suites = [];

  if (mode === 'prod') suites.push(await buildSuite());

  const srv = startServer({ mode, cwd: ROOT });
  let started = false;
  try {
    await srv.waitReady(base + '/api/extensions');
    started = true;
    // dev 模式额外等 Vite 3001
    if (mode === 'dev') {
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        try { const r = await fetch('http://localhost:3001/'); if (r.ok || r.status === 404) break; } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    suites.push(await httpSuite(base));
    suites.push(await apiSuite(base));
    suites.push(await webFormatSuite(base));
    suites.push(await securitySuite(base));
    suites.push(await wsSuite(base));
    suites.push(await browserSuite(base, mode));

    if (mode === 'dev') {
      const vite = new Suite(`Vite 开发服务器 [http://localhost:3001]`);
      await vite.test('3001 关键页面 200（主页/子页/README/TS 源码）', async (t) => {
        for (const p of ['/', '/page/a1/', '/page/a2/', '/README.md', '/Exjs/example-ext/index.ts']) {
          const r = await http('http://localhost:3001' + p);
          t.equal(r.status, 200, `GET 3001${p} = 200`);
        }
      });
      await vite.test('3001 代理 /api/exjs 标记 viaVite 并下发白名单', async (t) => {
        const r = await http('http://localhost:3001/api/exjs');
        const j = r.json();
        t.equal(j.viaVite, true, '经 Vite 代理 viaVite=true');
        t.equal(j.devMode, true, 'devMode=true');
        t.check(j.extensions.some((e) => e.name === 'example-ext'), '下发 example-ext 源码清单');
        t.check(j.pageExjs && j.pageExjs.a1 && j.pageExjs.a1[0] === 'example-ext', '下发 a1 白名单');
      });
      suites.push(vite);
    }
  } catch (e) {
    const s = new Suite(`${mode} 启动/连通性`);
    await s.test('服务可启动并响应', (t) => t.check(false, e.message + '\n' + srv.log));
    suites.push(s);
  } finally {
    srv.stop();
  }
  return suites;
}

const allSuites = [];
for (const mode of MODES) {
  const suites = await runMode(mode);
  allSuites.push(...suites);
}

const ok = printSummary(allSuites, { jsonPath: REPORT });
console.log('报告已写入: ' + REPORT);
process.exit(ok ? 0 : 1);
