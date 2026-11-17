# 05 — 架构与运行机制

## 启动流程

入口 `src/index.js` 的 `main()` 按顺序组装：

1. `loadConfig()` —— 决议运行模式（prod/dev）、读取全局配置。
2. `discoverExtensions(registry)` —— 扫描 `Exserver/`、`Exjs/`，登记到内存注册表。
3. `new SecurityPolicy(config).load()` —— 加载外置安全策略（Exserver 定义 + 全局配置合并）。
4. `new SubpageRegistry().discover()` —— 扫描 `page/<id>/` 子页。
5. 创建 `Bus` 与 `LogHub`（`hub.attach()` 汇聚日志）。
6. `createExjsRuntime(registry, ROOT)` —— Exjs 运行时；`security.attachBus(bus)`。
7. `loadExservers(...)` —— 按 `requires` 拓扑加载 Exserver，调用 `onReady`，注册 `onMessage` 与 `server.conf.js` 热更新；返回带 `ctx`/`mod` 的条目。
8. 收集 `onRequest` 请求钩子；收集页面 `exjs` 白名单传给 server。
9. `createServer(...)` —— 构造 HTTP 服务；`bus.attach(server)` 挂 WebSocket。
10. 注册 `subpage:open` 权威解析处理器。
11. `startVite(...)` —— 仅 dev 启动 Vite :3001。
12. `server.listen(port)` —— 主服务 :3000。

## 扩展发现与注册表

- `src/discover.js` 递归扫描 `Exserver/` 与 `Exjs/` 下的**直接子目录**作为一个扩展（跳过 `security-policy`）。
- 扩展 id 形如 `exserver:example-ext`、`exjs:example-ext`。
- 可选 `mod.js` 提供元数据（`name`/`description`/`author`/`requires`）。
- `src/registry.js` 内存注册表：
  - `register` 保留已存在的 `enabled` 状态（热重载不丢状态）。
  - `list()` 返回**全部**扩展（含禁用者）。
  - `toggle(id)` 启停，只写内存，不回写任何清单文件。
- 对应 API：`GET /api/extensions`、`POST /api/extensions/toggle`。

## 扩展生命周期

**Exserver**（`src/exserver/runtime.js`）：

- 加载 `index.js`（默认导出钩子对象）与 `server.conf.js`。
- 按 `requires` 拓扑排序，依赖先加载；缺依赖自动跳过。
- 为每个扩展构造 `ctx`，调用 `onReady(ctx)`。
- 注册 `bus.on('*')` 分发到各扩展的 `onMessage(env, ctx)`。
- 注入 `onRequest` 钩子到 HTTP 管线。
- 监听 `server.conf.js` 热更新。

**Exjs**（`src/exjs/runtime.js`）：以 bootstrap 脚本注入页面，dev 按白名单动态 import 源码，prod 由构建 bundle 直接加载（见 [Exjs](07-exjs.md)）。

## HTTP 请求管线

`src/server.js` 的 `http.createServer` 对每个请求依次：

1. **安全头注入**：`security.applyHeaders(res)` —— CSP/CORS/Cache-Control。
2. **CORS 预检**：`OPTIONS` → 204。
3. **路径拦截**：命中 `blockedPaths` → 403。
4. **Exserver 请求钩子**：对非 `/api/`、`/_navext/` 的请求，依次执行 `onRequest`；返回 `{status,type,body}` 即短路响应（HTML 产物会注入 Nex 脚本）。Markdown 渲染正是这样实现的。
5. **核心 API**：`/api/*` 各端点（见 [HTTP API](15-http-api.md)）。
6. **客户端库与引导**：`/_navext/bus.js`、`navext.js`、`sub.js`、`bootstrap.js`、`exjs/*`、`exserver/*`。
7. **静态产物**：`/dist/*`、`/Exjs/*`（bundle）、`/page/*`（页面）。
8. **页面与主页**：`/` 或命中 home 路由 → `resolveHome`；`/page/<id>` 目录自动补 `index.html`。
9. 兜底 404。

## 数据流：一次扩展通信

```
浏览器 Exjs (React)
   │  Nex.bus.send('client-ping', {...})
   ▼
Bus (@NavExt-ws, ws://host/@NavExt-ws)
   │  _onMessage → handlers / '*' 通配
   ▼
Exserver.onMessage(env, ctx)
   │  ctx.bus.broadcast({ type:'server-pong', ... })
   ▼
所有连接的客户端收到 server-pong
```

- 信封固定 `{ type, scope, payload }`（见 [总线](08-bus.md)）。
- 服务端权威解析示例：`Nex.router.go(id)` 发 `subpage:open`，服务端 `src/index.js` 解析后回 `subpage:open:ok`，客户端据此导航（见 [子页](11-subpages.md)）。

## 日志汇聚

`src/log.js` 的 `LogHub`（环形缓冲，默认 1000 条）：

- 服务端日志（`hub.server(...)`、`ctx.log(...)`）→ 原样 console + 入缓冲 + 广播 `log:event`。
- 客户端日志（`Nex.log(...)`）→ 总线 `client-log` → 入缓冲。
- 进程级 `uncaughtException` / `unhandledRejection` 也归入。
- 拉取：`GET /api/logs`；清空：`POST /api/logs/clear`（广播 `log:cleared`）。
- 订阅：`Nex.log.on(cb)` 收 `log:event`。

## 自动刷新机制

- `server.conf.js` 变更 → 广播 `__nex:reload`。
- dev 下 Vite watcher 变更 → 广播 `__nex:reload`。
- 浏览器 `NexBus` 收到后防抖 `location.reload()`，覆盖 3000 直连页、3001 Vite 页与 SSR Markdown 页。

## 进程与资源

- 运行时仅 Node 内置模块；手写 RFC6455 WebSocket（含 ping/pong、半开关闭处理）。
- `ctx.fetch` 带超时与 AbortController；`ctx.timer` / `ctx.interval` 被追踪管理。
- 生产静态目录：`dist/page`、`dist/Exjs`；`Cache-Control: no-store` 保证热更新/颜色不回退。
