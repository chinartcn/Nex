import { attachWebSocketServer } from './ws.js';

// 信封：{ type, scope, payload }
// payload 原生标准 Web 格式：urlsearchparams / formdata / json / text
export class Bus {
  constructor() {
    this.clients = new Set();
    this.handlers = new Map(); // type -> Set<fn>；'*' 为通配
  }

  // 挂到 http.Server（Phase 1 日志汇聚暂未接）
  attach(httpServer) {
    attachWebSocketServer(httpServer, (conn) => {
      this.clients.add(conn);
      conn.on('message', (data) => this._onMessage(conn, data));
      conn.on('close', () => this.clients.delete(conn));
    });
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }

  _onMessage(conn, data) {
    let env;
    try {
      env = JSON.parse(data);
    } catch {
      return;
    }
    if (!env || typeof env.type !== 'string') return;
    // 内置中继：stream:data 分片经总线扇出给所有客户端（含发送者回环）
    if (env.type === 'stream:data' && !env._relayed) {
      env._relayed = true;
      this.broadcast(env);
    }
    const set = this.handlers.get(env.type);
    if (set) for (const fn of set) fn(env, conn);
    const any = this.handlers.get('*');
    if (any) for (const fn of any) fn(env, conn);
  }

  broadcast(envelope) {
    const msg = JSON.stringify(envelope);
    for (const c of this.clients) c.sendText(msg);
  }

  send(conn, envelope) {
    conn.sendText(JSON.stringify(envelope));
  }
}

// 原生格式编解码辅助（标准 Web API 风格）
export function packParams(obj) {
  return { format: 'urlsearchparams', body: new URLSearchParams(obj).toString() };
}
export function unpackParams(payload) {
  if (payload && (payload.format === 'urlsearchparams' || payload.format === 'formdata')) {
    return Object.fromEntries(new URLSearchParams(payload.body).entries());
  }
  return payload && 'body' in payload ? payload.body : payload;
}
