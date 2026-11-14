// 浏览器端 NexBus 客户端库（由服务端以 /_navext/bus.js 提供）
export const BUS_CLIENT_SOURCE = `
(function (global) {
  var WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/@NavExt-ws';
  var conn = new WebSocket(WS_URL);
  var handlers = new Map();

  function emit(type, env) {
    var set = handlers.get(type);
    if (set) set.forEach(function (fn) { fn(env.payload, env); });
  }
  var reloading = false;
  conn.onmessage = function (ev) {
    var env; try { env = JSON.parse(ev.data); } catch (e) { return; }
    // 框架内部信号：后端配置/内容变更后由总线推送，页面自动刷新（无需手动 F5）
    // 走总线而非 Vite HMR：proxy 转发的服务端渲染页(如 .md)没有 @vite/client，
    // 但注入了本脚本，故 3000 / 3001 都能收到。reloading 防抖避免一次改动重复刷新。
    if (env && env.type === '__nex:reload') {
      if (reloading) return;
      reloading = true;
      try { location.reload(); } catch (e) {}
      return;
    }
    if (env && typeof env.type === 'string') emit(env.type, env);
  };

  var NexBus = {
    ready: false,
    on: function (type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return function () { handlers.get(type).delete(fn); };
    },
    send: function (type, payload, scope) {
      conn.send(JSON.stringify({ type: type, scope: scope || 'global', payload: payload }));
    },
    // 原生标准 Web 格式：键值数据走 URLSearchParams
    sendParams: function (type, obj, scope) {
      NexBus.send(type, { format: 'urlsearchparams', body: new URLSearchParams(obj).toString() }, scope);
    },
    // 原生标准 Web 格式：FormData（非文件字段 → urlsearchparams 风格编码）
    sendForm: function (type, form, scope) {
      var entries = [];
      if (form && typeof form.forEach === 'function') form.forEach(function (v, k) { entries.push([k, String(v)]); });
      else if (form && typeof form.entries === 'function') entries = Array.from(form.entries()).map(function (e) { return [e[0], String(e[1])]; });
      NexBus.send(type, { format: 'formdata', body: entries }, scope);
    },
    // 接收端：按 name 订阅流分片（配合 Nex.stream.send）
    onStream: function (name, cb) {
      return NexBus.on('stream:data', function (payload) {
        if (payload && payload.name === name) cb(payload.chunk, { seq: payload.seq, done: payload.done });
      });
    },
  };

  conn.onopen = function () {
    NexBus.ready = true;
    NexBus.send('client-ready', {});
  };
  global.NexBus = NexBus;
})(window);
`;
