// 服务端扩展（Exserver）钩子
// onReady(ctx)：加载完成时广播；onMessage(env, ctx)：收到总线消息时处理
export default {
  onReady(ctx) {
    ctx.log('info', 'example-ext ready'); // Phase 1：经总线汇聚的扩展日志
    // 经 @NavExt-ws 向所有客户端广播
    ctx.bus.broadcast({
      type: 'server-ready',
      scope: 'global',
      payload: { id: 'exserver:example-ext', hook: ctx.hook },
    });
    // 推送子页清单，供 Nex.router 缓存
    if (ctx.subpages) {
      ctx.bus.broadcast({
        type: 'subpage:list',
        scope: 'global',
        payload: { pages: ctx.subpages.list() },
      });
    }
  },
  onMessage(env, ctx) {
    // 全双工保活：client-ping → server-pong
    if (env.type === 'client-ping') {
      ctx.bus.broadcast({
        type: 'server-pong',
        scope: 'global',
        payload: { echo: env.payload, from: ctx.hook },
      });
    }
    // Standard Web Streams 回显：stream:data（由总线内置中继扇出）在总线侧再回声一次
    if (env.type === 'stream:data' && env.payload && !env.payload._echo) {
      ctx.bus.broadcast({
        type: 'server-stream:echo',
        scope: 'global',
        payload: { name: env.payload.name, seq: env.payload.seq, chunk: env.payload.chunk, done: env.payload.done },
      });
    }
    // 注意：subpage:open 的权威解析已移至 index.js（服务端统一），此处不再重复回复
  },
};
