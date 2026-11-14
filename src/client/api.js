import { ROUTER_SOURCE } from '../../NavExt-sub/router.js';

// 规范化客户端 API（Phase 6）：window.Nex
// 取代旧版散落的 window.NavExt 私有方法，统一为分层命名空间：
//   Nex.bus      —— 总线（含 on/send/sendParams/sendForm/sendStream/onStream）
//   Nex.params   —— URLSearchParams 构造（标准 Web 格式）
//   Nex.form     —— FormData 构造（标准 Web 格式）
//   Nex.stream   —— ReadableStream 收发（Standard Web Streams）
//   Nex.dom      —— DOM 辅助
//   Nex.router   —— 子页路由（NavExt-sub）
//   Nex.log      —— 日志（为 Phase 1 总线日志汇聚预留：同时落本地并上报总线）
//   Nex.ready    —— 总线就绪后执行
// 注意：本对象不使用任何旧版 window.NavExt 命名。

export const CLIENT_API_SOURCE = `
(function (global) {
  function bus() { return global.NexBus; }

  // 写日志：本地 console + 经总线 client-log 上报（服务端 LogHub 摄取）
  var logFn = function (level) {
    var args = Array.prototype.slice.call(arguments, 1);
    try { console[level === 'log' ? 'log' : level].apply(console, args); } catch (e) { console.log.apply(console, args); }
    if (bus()) bus().send('client-log', { level: level, args: args, t: Date.now() });
  };
  // 订阅统一日志流（server + client 汇聚事件）
  var logOn = function (cb) {
    if (!bus()) return function () {};
    return bus().on('log:event', function (env) { cb(env.payload); });
  };

  var Nex = {
    version: '2.0',

    get bus() { return global.NexBus; },

    // 子页路由（NavExt-sub）：由 /_navext/sub.js 加载后挂载到 global.__NexRouter
    get router() { return global.__NexRouter; },

    ready: function (cb) {
      if (global.NexBus && global.NexBus.ready) return cb(global.NexBus);
      var i = setInterval(function () {
        if (global.NexBus && global.NexBus.ready) { clearInterval(i); cb(global.NexBus); }
      }, 20);
    },

    // 标准 Web 格式：键值数据 → URLSearchParams
    params: function (obj) { return new URLSearchParams(obj); },

    // 标准 Web 格式：含文件/多部分 → FormData
    form: function (obj) {
      var f = new FormData();
      if (obj instanceof FormData) return obj;
      Object.keys(obj || {}).forEach(function (k) { f.append(k, obj[k]); });
      return f;
    },

    // DOM 辅助
    dom: {
      el: function (tag, props) {
        var e = document.createElement(tag);
        props = props || {};
        Object.keys(props).forEach(function (k) {
          if (k === 'class') e.className = props[k];
          else if (k === 'text') e.textContent = props[k];
          else if (k.startsWith('on') && typeof props[k] === 'function') e.addEventListener(k.slice(2), props[k]);
          else e.setAttribute(k, props[k]);
        });
        return e;
      },
      mount: function (selector, node) {
        var host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (host) host.appendChild(node);
        return host;
      },
    },

    // 日志：本地 + 总线（Phase 1 汇聚时只需在总线侧收集 client-log）
    log: logFn,
    // 订阅统一日志流（server + client 经总线汇聚为 log:event）
    logOn: logOn,

    // Standard Web Streams 收发
    stream: {
      // 将 ReadableStream / 数组 / AsyncIterable 分片经总线发出
      send: function (name, source, opts) {
        opts = opts || {}; var scope = opts.scope || 'global';
        var seq = 0;
        function push(chunk, done) {
          if (!bus()) return;
          var body;
          if (chunk instanceof Uint8Array || chunk instanceof ArrayBuffer) body = Array.from(new Uint8Array(chunk)).join(',');
          else body = String(chunk);
          bus().send('stream:data', { format: 'stream', name: name, seq: seq++, chunk: body, done: !!done }, scope);
        }
        var it;
        if (source instanceof ReadableStream) it = source.getReader();
        else if (typeof source[Symbol.asyncIterator] === 'function') it = source;
        else if (Array.isArray(source)) it = source.values();

        if (source instanceof ReadableStream) {
          (function loop() {
            it.read().then(function (r) {
              if (r.done) { push('', true); return; }
              push(r.value, false); loop();
            });
          })();
        } else if (it && typeof it.next === 'function') {
          (function loop() {
            it.next().then(function (r) {
              if (r.done) { push('', true); return; }
              push(r.value, false); loop();
            });
          })();
        } else { push('', true); }
      },
      // 订阅某个流名的数据分片
      read: function (name, cb) {
        if (!bus()) return function () {};
        return bus().on('stream:data', function (payload) {
          if (payload && payload.name === name) cb(payload.chunk, { seq: payload.seq, done: payload.done });
        });
      },
    },
  };

  global.Nex = Nex;
})(window);
`;

// 组合：router 源码（NavExt-sub）作为独立片段，由 server 注入
export { ROUTER_SOURCE };
