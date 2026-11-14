// 子页前端逻辑（示例）：演示通过总线与 Exserver 通信
if (window.NexBus) {
  NexBus.on('server-ready', (p) => console.log('[a1] server ready', p));
  NexBus.on('server-pong', (p) => console.log('[a1] pong', p));
  const iv = setInterval(() => {
    if (NexBus.ready) {
      clearInterval(iv);
      NexBus.send('client-ping', { t: Date.now() });
    }
  }, 50);
}
