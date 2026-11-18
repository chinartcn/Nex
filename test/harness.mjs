// 零依赖测试框架：断言、HTTP 客户端、WS 客户端、浏览器 console 采集、进程管理。
// 仅用 Node 内置模块，不引入任何第三方依赖。

import httpMod from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import { spawn } from 'node:child_process';

/* ─────────────── 断言与报告 ─────────────── */
export class Suite {
  constructor(name) {
    this.name = name;
    this.cases = [];
  }
  // fn: async (t) => {}，t.check(条件, 描述) / t.equal / t.deep / t.ok
  async test(title, fn) {
    const t = {
      checks: [],
      check(cond, msg) { this.checks.push({ ok: !!cond, msg }); return !!cond; },
      equal(a, b, msg) { this.checks.push({ ok: a === b, msg: `${msg} (实际=${JSON.stringify(a)}, 期望=${JSON.stringify(b)})` }); },
      include(hay, needle, msg) {
        const ok = typeof hay === 'string' ? hay.includes(needle) : false;
        this.checks.push({ ok, msg: `${msg} (包含 "${needle}")`, actual: typeof hay === 'string' ? hay.slice(0, 300) : hay });
      },
    };
    let error = null;
    try { await fn(t); } catch (e) { error = e?.stack || String(e); }
    const ok = !error && t.checks.every((c) => c.ok);
    const c = { title, ok, checks: t.checks, error };
    this.cases.push(c);
    return c;
  }
  summary() {
    return {
      suite: this.name,
      total: this.cases.length,
      passed: this.cases.filter((c) => c.ok).length,
      failed: this.cases.filter((c) => !c.ok).length,
      cases: this.cases,
    };
  }
}

export function printSummary(suites, { jsonPath } = {}) {
  const all = suites.map((s) => s.summary());
  let tp = 0, tf = 0;
  console.log('\n' + '='.repeat(64));
  console.log(' 全量测试结果');
  console.log('='.repeat(64));
  for (const s of all) {
    tp += s.passed; tf += s.failed;
    const mark = s.failed === 0 ? '✅' : '❌';
    console.log(`\n${mark} ${s.suite}  (${s.passed}/${s.total} 通过)`);
    for (const c of s.cases) {
      const m = c.ok ? '  ✓' : '  ✗';
      console.log(`${m} ${c.title}`);
      if (!c.ok) {
        if (c.error) console.log('      ' + String(c.error).split('\n')[0]);
        for (const ch of c.checks.filter((x) => !x.ok)) {
          console.log('      · ' + ch.msg);
          if (ch.actual != null) console.log('        实际: ' + String(ch.actual).replace(/\n/g, ' ').slice(0, 240));
        }
      }
    }
  }
  console.log('\n' + '-'.repeat(64));
  console.log(` 合计: ${tp} 通过, ${tf} 失败, ${tp + tf} 总计`);
  console.log('='.repeat(64) + '\n');
  if (jsonPath) {
    fsSync.writeFileSync(jsonPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      passed: tp, failed: tf, total: tp + tf,
      suites: all,
    }, null, 2));
  }
  return tf === 0;
}

/* ─────────────── HTTP 客户端 ─────────────── */
export async function http(url, opts = {}) {
  const { method = 'GET', headers = {}, body, timeout = 8000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal, redirect: 'manual' });
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      headers: Object.fromEntries(res.headers.entries()),
      text,
      json() { return JSON.parse(text); },
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────── 极简 WS 客户端（RFC6455）────────────── */
export function wsConnect(url, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(Number(u.port) || 80, u.hostname);
    let buf = Buffer.alloc(0), handshaken = false;
    const listeners = new Set();
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('WS handshake timeout')); }, timeout);

    sock.on('connect', () => {
      sock.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.slice(0, i).toString();
        if (!/^HTTP\/1\.1 101/.test(head)) { clearTimeout(timer); sock.destroy(); reject(new Error('WS bad handshake: ' + head.split('\r\n')[0])); return; }
        buf = buf.slice(i + 4);
        handshaken = true;
        clearTimeout(timer);
        resolve(api);
      }
      while (buf.length >= 2) {
        const b0 = buf[0], b1 = buf[1];
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        let mask;
        if (masked) { if (buf.length < off + 4) break; mask = buf.slice(off, off + 4); off += 4; }
        if (buf.length < off + len) break;
        let payload = buf.slice(off, off + len);
        if (masked) { const d = Buffer.alloc(len); for (let k = 0; k < len; k++) d[k] = payload[k] ^ mask[k % 4]; payload = d; }
        buf = buf.slice(off + len);
        if (opcode === 0x8) { sock.end(); for (const l of listeners) l({ __close: true }); break; }
        if (opcode === 0x9) { sendFrame(sock, 0xA, payload); continue; } // ping->pong
        if (opcode === 0x1 || opcode === 0x2) {
          let msg;
          try { msg = JSON.parse(payload.toString('utf8')); } catch { msg = { __raw: payload.toString('utf8') }; }
          for (const l of listeners) l(msg);
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); try { reject(e); } catch {} });

    function sendFrame(socket, op, data) {
      const mask = crypto.randomBytes(4);
      const maskedBuf = Buffer.alloc(data.length);
      for (let k = 0; k < data.length; k++) maskedBuf[k] = data[k] ^ mask[k % 4];
      let header;
      if (data.length < 126) { header = Buffer.alloc(2); header[1] = 0x80 | data.length; }
      else if (data.length < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); }
      else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
      header[0] = 0x80 | op;
      socket.write(Buffer.concat([header, mask, maskedBuf]));
    }

    const api = {
      send(obj) { sendFrame(sock, 0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))); },
      onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      waitFor(predicate, ms = 4000) {
        return new Promise((resolve) => {
          const t = setTimeout(() => { off(); resolve(null); }, ms);
          const off = api.onMessage((m) => {
            if (predicate(m)) { clearTimeout(t); off(); resolve(m); }
          });
        });
      },
      close() { try { sendFrame(sock, 0x8, Buffer.alloc(0)); } catch {} sock.end(); },
      get open() { return handshaken; },
    };
  });
}

/* ─────────────── 浏览器 console 采集（CDP，零依赖）────────────── */
export async function browserCheck(urls, { port = 9455 } = {}) {
  const profile = '/tmp/nex-test-cdp-' + process.pid;
  const chrome = spawn('chromium', [
    '--headless', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: 'ignore' });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const httpJson = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = httpMod.request({ host: '127.0.0.1', port, path, method }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject); req.end();
  });

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      try { await httpJson('/json/version'); ready = true; break; } catch {}
    }
    if (!ready) throw new Error('Chromium CDP 未就绪');

    const results = [];
    for (const url of urls) {
      // 逐个新建 tab，避免多 tab 并发导致 fetch 竞态误报
      const tab = await httpJson('/json/new?' + encodeURIComponent(url), 'PUT');
      if (!tab || !tab.webSocketDebuggerUrl) { results.push({ url, errors: ['无法新建 tab'] }); continue; }
      const ws = await wsConnect(tab.webSocketDebuggerUrl);
      const errors = [];
      ws.onMessage((m) => {
        if (m.method === 'Runtime.exceptionThrown') {
          const d = m.params?.exceptionDetails || {};
          errors.push('EXCEPTION: ' + (d.text || '') + ' ' + (d.exception?.description || ''));
        }
        if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
          errors.push('console.error: ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
        }
      });
      ws.send({ id: 1, method: 'Runtime.enable' });
      ws.send({ id: 2, method: 'Page.enable' });
      ws.send({ id: 3, method: 'Page.reload', params: { ignoreCache: true } });
      await sleep(2200);
      results.push({ url, errors });
      ws.close();
      await httpJson('/json/close/' + tab.id).catch(() => {});
      // 等页面资源（含 1MB bundle 与 WS）彻底释放，避免多 tab 竞态误报 Failed to fetch
      await sleep(500);
    }
    return results;
  } finally {
    chrome.kill('SIGKILL');
    setTimeout(() => { try { fsSync.rmSync(profile, { recursive: true, force: true }); } catch {} }, 300);
  }
}

// DOM 抓取（验证颜色注入等静态渲染结果）
export function dumpDom(url) {
  return new Promise((resolve) => {
    const p = spawn('chromium', [
      '--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=2500', '--dump-dom', url,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.on('close', () => resolve(out));
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(out); }, 8000);
  });
}

/* ─────────────── 进程管理 ─────────────── */
export function startServer({ mode, cwd, env = {} }) {
  const args = mode === 'dev' ? ['src/index.js', '--dev'] : ['src/index.js'];
  const child = spawn('node', args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  child.stdout.on('data', (c) => (log += c));
  child.stderr.on('data', (c) => (log += c));
  return {
    child,
    get log() { return log; },
    async waitReady(url, timeout = 10000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        try { const r = await fetch(url); if (r.ok || r.status === 404) return true; } catch {}
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error('服务启动超时。日志:\n' + log);
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      let timer;
      const exited = new Promise((resolve) => {
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        timer = setTimeout(resolve, 1500); // 等待上限，避免进程忽略 SIGTERM 时卡死
      });
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
      await exited;
      // 兜底：进程组仍未退出则强杀，防止残留占端口污染后续套件
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
      }
    },
  };
}
