import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../config.js';

// 默认最小授权（决议 Q4）：写文件默认关，由 Exserver 安全策略显式开启
const DEFAULT = {
  // 默认最小授权：脚本仍锁 'self'（挡 XSS），但放开内联样式——
  // Nex 的 Exjs UI 多为 React，其 style={{}} 编译后即内联 style 属性，
  // 若收紧 style-src 会导致所有内置/扩展 UI 的样式失效（含 Markdown 标题色）。
  csp: "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:",
  cors: { origins: ['*'], methods: ['GET', 'POST', 'OPTIONS'] },
  fsWrite: false,
  allowFsWrite: [],
  blockedPaths: [],
};

function merge(base, ...objs) {
  const out = { ...base };
  for (const o of objs) {
    if (!o) continue;
    for (const k of Object.keys(o)) {
      const v = o[k];
      const bothObj =
        v && typeof v === 'object' && !Array.isArray(v) &&
        out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]);
      out[k] = bothObj ? { ...out[k], ...v } : v;
    }
  }
  return out;
}

// 安全策略运行时：核心只做兜底，策略可由 Exserver/security-policy 定义/扩展
export class SecurityPolicy {
  constructor(config) {
    this.config = config || {};
    this.policy = { ...DEFAULT };
    this.bus = null;
  }

  attachBus(bus) {
    this.bus = bus;
  }

  async load() {
    const fromEx = await this._loadExPolicy();
    const fromConfig = this.config.security || {};
    this.policy = merge(DEFAULT, fromEx, fromConfig);
    return this.policy;
  }

  // 安全策略外置点：Exserver 定义/扩展
  async _loadExPolicy() {
    const file = path.join(ROOT, 'Exserver', 'security-policy', 'index.js');
    if (!fs.existsSync(file)) return {};
    const m = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
    return m.default ?? m;
  }

  // 应用到所有响应的头（CSP / CORS）
  applyHeaders(res) {
    if (this.policy.csp) res.setHeader('Content-Security-Policy', this.policy.csp);
    const origins = this.policy.cors?.origins || [];
    res.setHeader(
      'Access-Control-Allow-Origin',
      origins.includes('*') ? '*' : origins[0] || ''
    );
    res.setHeader('Access-Control-Allow-Methods', (this.policy.cors?.methods || []).join(','));
  }

  // 路径拦截：命中 blockedPaths 返回 true（应拒绝）
  isBlocked(pathname) {
    return (this.policy.blockedPaths || []).some(
      (p) => pathname === p || pathname.startsWith(p + '/')
    );
  }

  // FS 写权限门禁（默认最小授权）
  canWriteFs(extId) {
    if (this.policy.fsWrite) return true;
    return (this.policy.allowFsWrite || []).includes(extId);
  }

  // 运行时补丁：受 config.security.apiWritable 控制（默认关）
  patch(patchObj, { writable } = {}) {
    if (!writable) return { ok: false, reason: 'security api not writable' };
    this.policy = merge(this.policy, patchObj);
    if (this.bus) {
      this.bus.broadcast({
        type: 'security-policy-changed',
        scope: 'global',
        payload: this.toJSON(),
      });
    }
    return { ok: true, policy: this.toJSON() };
  }

  toJSON() {
    return { ...this.policy, fsWriteDefault: DEFAULT.fsWrite };
  }
}
