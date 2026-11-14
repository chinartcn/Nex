// 子页前端逻辑（示例）：演示 Nex.router 与 Nex.log
if (window.Nex) {
  Nex.router.list().then((pages) => {
    Nex.log('log', '[a2] known pages', pages.map((p) => p.id));
  });
}
