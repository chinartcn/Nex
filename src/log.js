// Phase 1：日志汇聚（server.log / client.log 经 @NavExt-ws 总线汇聚为统一事件流）
// - 服务端日志：console.* 原样输出，同时汇入环形缓冲并广播 log:event
// - 客户端日志：经总线 client-log 事件被摄取，同样汇入统一流
// - 进程级异常也归入汇聚
// 客户端可通过 Nex.log.on(cb) 订阅统一 log:event；服务端可通过 GET /api/logs 拉取。

function fmt(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function fmtArgs(args) {
  return (args || []).map(fmt).join(' ');
}

export class LogHub {
  constructor(bus, opts = {}) {
    this.bus = bus;
    this.max = opts.max || 1000;
    this.entries = [];
    this._seq = 0;
  }

  attach() {
    if (!this.bus) return;
    // 客户端日志经总线汇聚
    this.bus.on('client-log', (env) => this._client(env && env.payload));
    // 进程级异常也归入汇聚
    process.on('uncaughtException', (err) => this.server('error', '[uncaught]', err));
    process.on('unhandledRejection', (err) => this.server('error', '[unhandledRejection]', err));
  }

  _push(entry) {
    entry.id = ++this._seq;
    if (this.entries.length >= this.max) this.entries.shift();
    this.entries.push(entry);
    if (this.bus) {
      this.bus.broadcast({ type: 'log:event', scope: 'global', payload: entry });
    }
  }

  // 服务端日志
  server(level, ...args) {
    const fn = console[level] || console.log;
    fn.apply(console, args);
    this._push({
      source: 'server',
      level,
      time: Date.now(),
      msg: fmtArgs(args),
      args: args.map(fmt),
    });
  }

  // 摄取来自客户端的日志（bus client-log 事件）
  _client(payload) {
    if (!payload) return;
    this._push({
      source: 'client',
      level: payload.level || 'log',
      time: payload.t || Date.now(),
      msg: fmtArgs(payload.args),
      args: Array.isArray(payload.args) ? payload.args.map(fmt) : payload.args,
    });
  }

  list() {
    return this.entries;
  }

  clear() {
    this.entries = [];
    if (this.bus) {
      this.bus.broadcast({ type: 'log:cleared', scope: 'global', payload: {} });
    }
  }
}
