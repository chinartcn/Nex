// NavExt-TS —— Exjs 的 TypeScript SDK
// 提供类型化的 NexBus 客户端与扩展定义辅助；运行时 NexBus 由服务端 /_navext/bus.js 注入。

export interface Envelope {
  type: string;
  scope: string;
  payload: any;
}

export interface NexBusClient {
  readonly ready: boolean;
  on(type: string, fn: (payload: any, env: Envelope) => void): () => void;
  send(type: string, payload: any, scope?: string): void;
  // 原生标准 Web 格式：键值数据走 URLSearchParams
  sendParams(type: string, obj: Record<string, string>, scope?: string): void;
}

export function nexBus(): NexBusClient {
  // 优先取规范化 API 暴露的 Nex.bus，回退到原生 NexBus 全局
  return ((window as any).Nex?.bus || (window as any).NexBus) as NexBusClient;
}

// 总线就绪后执行（兼容连接建立时机）
export function onBusReady(cb: (bus: NexBusClient) => void): void {
  const iv = setInterval(() => {
    const b = (window as any).NexBus;
    if (b && b.ready) {
      clearInterval(iv);
      cb(b as NexBusClient);
    }
  }, 20);
}

// 定义一个 Exjs 扩展：在总线就绪后自动启动
export function defineExjs(setup: (bus: NexBusClient) => void): void {
  onBusReady(setup);
}
