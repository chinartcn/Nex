// 子页前端逻辑（示例）：演示 Nex.router 与 Nex.log
// Nex.router 由 bootstrap 动态加载 sub.js 后挂载，需等待就绪（与 module script 并行）
(function init() {
  if (window.Nex && window.Nex.router) {
    window.Nex.router.list().then((pages) => {
      window.Nex.log('log', '[a2] known pages', pages.map((p) => p.id));
    });
    return;
  }
  var iv = setInterval(function () {
    if (window.Nex && window.Nex.router) {
      clearInterval(iv);
      window.Nex.router.list().then((pages) => {
        window.Nex.log('log', '[a2] known pages', pages.map((p) => p.id));
      });
    }
  }, 30);
})();
