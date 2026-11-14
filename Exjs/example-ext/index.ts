// Exjs 示例：使用 NavExt-TS SDK + NavExt-React 挂载面板
// 并演示 Phase 6 规范化客户端 API（window.Nex）：router / stream / log
import { defineExjs } from '../../NavExt-TS/index';
import { mountPanel } from '../../NavExt-React/index';
import { createElement } from 'react';
import { Panel } from './panel';

defineExjs((bus) => {
  bus.on('server-ready', (p) => console.log('[exjs:example-ext] server ready', p));
  bus.on('server-pong', (p) => console.log('[exjs:example-ext] pong', p));

  // 连接建立即发 ping，验证全双工
  bus.send('client-ping', { t: Date.now() });

  // 挂载 React 面板到页面预留节点
  mountPanel('#exjs-panel', createElement(Panel, { title: 'Example Exjs (React)' }));

  // —— Phase 6：规范化客户端 API（window.Nex 取代旧 window.NavExt）——
  const Nex: any = (window as any).Nex;
  if (Nex) {
    // 标准 Web 格式 + 日志（同时落本地并上报总线，为 Phase 1 汇聚预留）
    Nex.log('log', '[exjs] params =', Nex.params({ a: '1', b: '2' }).toString());

    // 子页路由：缓存清单并打印
    Nex.router.list().then((pages: any[]) =>
      Nex.log('log', '[exjs] pages =', pages.map((p) => p.id).join(','))
    );

    // Standard Web Streams：把数组作为流经总线分片发出（内置中继扇出）
    Nex.stream.send('demo-stream', ['chunk-a', 'chunk-b', 'chunk-c'], { scope: 'global' });
    Nex.stream.read('demo-stream', (chunk: string, meta: any) => {
      Nex.log('log', `[exjs] stream<${meta.seq}>`, chunk);
    });
  }
});
