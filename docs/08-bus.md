# 08 — `@NavExt-ws` 全双工总线

Nex 用一条全双工 WebSocket 总线替代 1.x 的前后端直接调用与私有 JSON-RPC。端点固定为 `ws(s)://<host>/@NavExt-ws`。

## 为什么用总线

- 前后端解耦：客户端扩展不直接调 `/api/*`。
- 全双工、事件驱动：服务端可主动广播（日志、刷新、pong）。
- 统一载荷格式：标准 Web 格式，不引入私有 RPC 协议（见 [标准 Web 格式](12-web-formats.md)）。

## 握手

服务端在 `http.Server` 的 `upgrade` 事件上处理，**仅接受**路径 `/@NavExt-ws` 且 `Upgrade: websocket` 的请求，返回 101。其它路径的 upgrade 直接断开。

浏览器端由 `/_navext/bus.js` 自动连接：

```js
var WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://')
  + location.host + '/@NavExt-ws';
```

## 信封协议（envelope）

所有消息是固定三段 JSON：

```json
{ "type": "client-ping", "scope": "global", "payload": { "n": 42 } }
```

| 字段 | 含义 |
| --- | --- |
| `type` | 事件类型（字符串），如 `client-ping`、`log:event`、`subpage:open` |
| `scope` | 作用域，默认 `global` |
| `payload` | 载荷；可以是标准 Web 格式封装（见 [12](12-web-formats.md)） |

服务端 `Bus._onMessage` 解析 JSON，分发给该 `type` 的处理器，再分发给 `'*'` 通配符处理器；非法 JSON 被静默忽略（不崩溃）。

## 服务端 API（Node 侧）

`Bus` 类（`src/bus/index.js`）：

| 方法 | 说明 |
| --- | --- |
| `attach(httpServer)` | 挂 WebSocket 服务，管理连接集合 |
| `on(type, fn)` | 注册处理器；`type='*'` 为通配 |
| `broadcast(envelope)` | 广播给所有连接（含发送者） |
| `send(conn, envelope)` | 发给单个连接 |

Exserver 通过 `ctx.bus` 使用同样的能力。

## 客户端 API（浏览器侧）

`NexBus`（`/ _navext/bus.js`）暴露：

| 方法 | 说明 |
| --- | --- |
| `NexBus.ready` | 是否已连接 |
| `NexBus.on(type, fn)` | 订阅；回调签名 `(payload, env)`；返回取消订阅函数 |
| `NexBus.send(type, payload, scope?)` | 发送信封 |
| `NexBus.sendParams(type, obj, scope?)` | 以 `URLSearchParams` 封装发送 |
| `NexBus.sendForm(type, form, scope?)` | 以 `FormData` 封装发送 |
| `NexBus.onStream(name, cb)` | 订阅某流名的分片 |

连接打开时自动发送 `client-ready`。也可通过 `Nex.bus` / `Nex.ready(cb)` 使用（见 [客户端 API](09-client-api.md)）。

## 内置事件类型

| 类型 | 方向 | 说明 |
| --- | --- | --- |
| `client-ready` | C→S | 连接建立 |
| `client-ping` / `server-pong` | C→S / S→C | 保活 / 回显（示例扩展实现） |
| `server-ready` | S→C | 服务启动期广播（example-ext 的 `onReady`） |
| `subpage:list` | S→C | 子页清单推送 |
| `subpage:open` / `subpage:open:ok` | C→S / S→C | 子页导航请求与服务端权威解析结果 |
| `client-log` / `log:event` / `log:cleared` | 双向 / S→C | 日志汇聚（见 [日志](05-architecture.md#日志汇聚)） |
| `stream:data` / `server-stream:echo` | 双向 / S→C | 流分片中继与回声 |
| `security-policy-changed` | S→C | 安全策略变更广播 |
| `__nex:reload` | S→C | 框架内部：后端/内容变更，前端自动刷新 |

## 关键行为

- **流式中继**：`stream:data` 首次到达时打 `_relayed` 标记并广播给所有连接（含发送者回环）；示例扩展再回一条 `server-stream:echo`。`Nex.stream.send/read` 基于此实现。
- **自动刷新**：浏览器收到 `__nex:reload` 后防抖执行 `location.reload()`。这让经 Vite 代理的 SSR Markdown 页也能自动刷新（它们没有 `@vite/client`）。
- **稳定性**：手写 WS 实现包含 ping/pong、半开连接关闭处理（`end` 事件），非法消息与连接异常不会导致进程崩溃。

## 示例：一次 ping-pong

```js
Nex.ready((bus) => {
  bus.on('server-pong', (payload) => console.log('pong', payload));
  bus.send('client-ping', { hello: 'world' });
});
```

## HTTP 触发广播（外部系统集成）

非浏览器系统（运维脚本、CI、其它后端）可经 `POST /api/bus/broadcast` 向所有前端广播事件，无需自己建立 WebSocket 连接：

```bash
curl -X POST http://localhost:3000/api/bus/broadcast \
  -H 'content-type: application/json' \
  -d '{"type":"deploy-notice","scope":"global","payload":{"msg":"v2.1 已发布"}}'
```

- **默认关闭**（最小授权）：需 `security.apiBroadcast: true` 或 `NEX_API_BROADCAST=1`，或用策略 API 开启（需 `apiWritable`）。
- 保留的内部事件禁止外部伪造，返回 403：`__nex:reload`、`log:event`、`log:cleared`、`security-policy-changed`、`config-changed`、`extension-toggled`、`extension-config-changed`、`subpage:open:ok`、`server-ready`、`server-pong`、`server-stream:echo`。
- 客户端收到的信封带 `_from: "http"` 标记，便于区分来源。
- 连接可见性：`GET /api/bus/clients` 查看当前连接数与元信息。

前端订阅这类事件与订阅普通事件一致：

```js
Nex.bus.on('deploy-notice', (payload, env) => console.log(payload.msg, env._from));
```

详见 [HTTP API 参考](15-http-api.md) 与 [安全策略](10-security.md)。

