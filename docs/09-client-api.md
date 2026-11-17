# 09 — 客户端 API `window.Nex`

Nex 把客户端能力收敛为**单一全局 `window.Nex`**（分层命名空间），彻底取代 1.x 散落的 `window.NavExt` 私有方法。源码见 `src/client/api.js`，由 `/_navext/navext.js` 提供给浏览器。

## 总览

| 成员 | 说明 |
| --- | --- |
| `Nex.version` | `'2.0'` |
| `Nex.bus` | 底层总线句柄 `NexBus`（getter） |
| `Nex.ready(cb)` | 总线就绪后执行 `cb(NexBus)` |
| `Nex.params(obj)` | 返回 `URLSearchParams` |
| `Nex.form(obj)` | 返回 `FormData` |
| `Nex.stream` | 流收发：`send` / `read` |
| `Nex.dom` | DOM 辅助：`el` / `mount` |
| `Nex.router` | 子页路由器（getter，来自 `NavExt-sub`） |
| `Nex.log(...)` | 写日志（本地 + 总线上报） |
| `Nex.log.on(cb)` / `Nex.logOn(cb)` | 订阅统一日志流 |

## `Nex.bus` 与 `Nex.ready`

```js
Nex.ready((bus) => {
  bus.send('client-ping', { n: 1 });
  const off = bus.on('server-pong', (payload, env) => {
    console.log(payload, env.scope);
    off();
  });
});
```

`Nex.ready` 内部轮询等待 `NexBus.ready`，因此无需手动判断时序。底层 `bus` 方法与 [总线文档](08-bus.md#客户端-api浏览器侧) 一致。

## 标准 Web 格式辅助

```js
const p = Nex.params({ a: 1, b: 2 });   // URLSearchParams
const f = Nex.form({ user: 'nex' });     // FormData（已是 FormData 则原样返回）
```

配合总线：

```js
Nex.bus.sendParams('kv', { a: 1 });      // payload = {format:'urlsearchparams', body:'a=1'}
Nex.bus.sendForm('upload', Nex.form({ name: 'x' }));
```

服务端 `unpackParams` 可还原这两类载荷。详见 [标准 Web 格式](12-web-formats.md)。

## 流收发 `Nex.stream`

```js
// 发送：source 可为 ReadableStream / 数组 / AsyncIterable
Nex.stream.send('log-lines', ['line1', 'line2'], { scope: 'global' });

// 订阅某流名
const off = Nex.stream.read('log-lines', (chunk, meta) => {
  console.log(meta.seq, chunk, meta.done);
});
```

- `send` 逐片发送 `stream:data`（含 `name`/`seq`/`chunk`/`done`），由总线内置中继扇出。
- 二进制分片（`Uint8Array`/`ArrayBuffer`）编码为逗号分隔的字节串。
- 兼容同步与异步迭代器。

## DOM 辅助 `Nex.dom`

```js
const btn = Nex.dom.el('button', {
  class: 'primary',
  text: '点我',
  onclick: () => console.log('clicked'),
});
Nex.dom.mount('#exjs-panel', btn);
```

- `el(tag, props)`：`class`→className、`text`→textContent、`on*`→addEventListener、其余→setAttribute。
- `mount(selectorOrNode, node)`：挂载并返回 host。

## 子页路由 `Nex.router`

由 `/_navext/sub.js` 提供，挂载到 `global.__NexRouter`，经 `Nex.router` 暴露：

| 方法 | 说明 |
| --- | --- |
| `router.list()` | 子页清单 |
| `router.current()` | 当前子页 |
| `router.on(fn)` | 订阅路由变化 |
| `router.go(id)` | 导航到子页：经总线发 `subpage:open`，服务端权威解析回 `subpage:open:ok` 后跳转；1s 无响应本地兜底 |

详见 [子页与多主页路由](11-subpages.md)。

## 日志 `Nex.log`

```js
Nex.log('info', 'hello', { x: 1 });   // 本地 console + 总线 client-log 上报
Nex.log.on((entry) => {               // 订阅统一日志流（server + client）
  console.log(entry.source, entry.level, entry.msg);
});
```

- `Nex.log(level, ...args)`：`level` 支持 `log`/`info`/`warn`/`error` 等。
- `Nex.log.on(cb)`（等价 `Nex.logOn(cb)`）订阅 `log:event`，回调参数是日志条目本身。
- 日志条目形如 `{ id, source, level, time, msg, args }`。

## 废弃提示

1.x 的 `window.NavExt.*` 已**全部移除**，不再兼容。任何旧代码需迁移到 `window.Nex`（见 [迁移](17-migration.md)）。
