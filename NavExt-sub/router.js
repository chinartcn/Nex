// NavExt-sub —— 子页路由客户端库（浏览器侧）
// 由 src/client/api.js 内联注入；也可独立以 /_navext/sub.js 提供。
// 设计：子页是独立 HTML 文档，路由本质是在页间跳转；
// 但所有「意图」经总线发出（subpage:open），后端可鉴权/记录后再放行。
// 这里 Nex.router 同时支持：本地直跳（离线可用）+ 总线事件（可观测）。

export const ROUTER_SOURCE = `
(function (global) {
  var cache = [];
  var listeners = new Set();

  function emit(info) {
    listeners.forEach(function (fn) { try { fn(info); } catch (e) {} });
  }

  function currentId() {
    var m = location.pathname.match(/\\/page\\/([^/]+)/);
    return m ? m[1] : null;
  }

  function refresh() {
    if (!global.NexBus) return;
    global.NexBus.send('subpage:list', {});
  }

  var Router = {
    // 拉取并缓存子页清单（也可后续由总线 subpage:list 推送更新）
    async list() {
      try {
        var res = await fetch('/api/pages');
        var data = await res.json();
        cache = data.pages || [];
        emit({ type: 'list', pages: cache });
      } catch (e) {}
      return cache;
    },
    get(id) { return cache.find(function (p) { return p.id === id; }); },
    current() { return currentId(); },
    // 跳转：经总线发 subpage:open 请求服务端权威解析（可改写 url / 鉴权），
    // 收到 subpage:open:ok 后导航；1s 内无响应则本地直跳（离线可用）。
    go(id) {
      var self = this;
      var pg = this.get(id) || null;
      var url = pg ? pg.url : ('/page/' + id + '/index.html');
      return new Promise(function (resolve) {
        if (!global.NexBus) { location.assign(url); return resolve({ id: id, url: url, via: 'local' }); }
        var done = false;
        var off = global.NexBus.on('subpage:open:ok', function (p) {
          if (p && p.id === id) {
            done = true; off();
            var to = (p.url || url);
            location.assign(to);
            resolve({ id: id, url: to, via: 'bus' });
          }
        });
        global.NexBus.send('subpage:open', { id: id, url: url });
        setTimeout(function () {
          if (!done) { off(); location.assign(url); resolve({ id: id, url: url, via: 'local-timeout' }); }
        }, 1000);
      });
    },
    // 监听路由变化（popstate + 总线 subpage 事件）
    on(fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    _setCache(pages) { cache = pages || []; emit({ type: 'list', pages: cache }); },
  };

  // 总线透传：服务端可推送最新清单
  if (global.NexBus) {
    global.NexBus.on('subpage:list', function (p) {
      if (p && Array.isArray(p.pages)) Router._setCache(p.pages);
    });
    global.NexBus.on('subpage:changed', function () { Router.list(); });
  }
  window.addEventListener('popstate', function () { emit({ type: 'pop', id: currentId() }); });

  global.__NexRouter = Router;
})(window);
`;
