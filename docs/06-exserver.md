# 06 — Exserver 服务端扩展

Exserver 是运行在 Nex 引擎进程内的服务端扩展，取代 1.x 的服务端钩子。目录位于 `Exserver/<name>/`，自动发现，无需清单。

## 目录结构

```
Exserver/<name>/
├── mod.js            # 可选：元数据 { name, description, author, requires }
├── index.js          # 钩子对象：onReady / onMessage / onRequest / subpages
├── server.conf.js    # 可选：扩展配置（.js），改动热更新
└── sub.js            # 可选：扩展贡献的子页/路由声明
```

`Exserver/security-policy/` 是特殊的策略目录，不作为扩展发现（单独加载）。

## 钩子

### `onReady(ctx)`

加载完成时调用一次。用于初始化、广播事件、写日志。

```js
export default {
  onReady(ctx) {
    ctx.log('info', 'example-ext ready');
    ctx.bus.broadcast({
      type: 'server-ready', scope: 'global',
      payload: { id: 'exserver:example-ext' },
    });
  },
};
```

### `onMessage(env, ctx)`

总线收到消息时调用（通过 `bus.on('*')` 分发）。`env` 为 `{ type, scope, payload }`。

```js
onMessage(env, ctx) {
  if (env.type === 'client-ping') {
    ctx.bus.broadcast({
      type: 'server-pong', scope: 'global',
      payload: { echo: env.payload, from: ctx.hook },
    });
  }
}
```

### `onRequest(req, url, ctx)`

**显式请求拦截钩子**——在核心 API / 静态处理之前运行，你可自己读文件生成响应。

- 对 `/api/`、`/_navext/` 之外的请求执行。
- 返回 `{ status, type, body }` 即短路响应；返回 `undefined` / `null` 则放行给后续管线。
- `body` 为字符串或 Buffer；`type` 为 MIME。HTML 响应会自动注入 Nex 客户端脚本。
- 典型用途：Markdown 渲染器拦截 `*.md`（见 `Exserver/markdown-render/index.js`）。

```js
export function onRequest(req, url, ctx) {
  if (!/\.md$/i.test(url.pathname)) return undefined;
  // ... 读取、转义、渲染 ...
  return { status: 200, type: 'text/html; charset=utf-8', body: html };
}
```

注意：`onRequest` 需要从 `index.js` **具名导出**（服务端按 `mod.onRequest` 取用）。

### `subpages`（贡献子页）

可在默认导出对象上声明 `subpages: [{ id, title, paths, url }]`，合并进子页注册表。

## `ctx` 上下文

由 `src/exserver/runtime.js` 的 `makeCtx` 构造：

| 字段 | 说明 |
| --- | --- |
| `ctx.config` | getter，实时读取 `server.conf.js`（热更新后自动是最新值） |
| `ctx.bus` | 总线句柄：`broadcast(env)` / `on(type, fn)` / `send(conn, env)` |
| `ctx.fetch(url, opts)` | 带超时（默认 10s，`opts.timeout` 可改）与 AbortController 的 fetch |
| `ctx.timer(fn, ms)` / `ctx.interval(fn, ms)` | 受追踪的定时器 |
| `ctx.hook` | 扩展 id（字符串） |
| `ctx.log(level, ...args)` | 经 LogHub 汇聚的日志 |
| `ctx.subpages` / `ctx.security` / `ctx.registry` | 运行时上下文（由入口注入） |
| `ctx.conn` | 仅 `onMessage` 时附带，当前连接 |

## 依赖与加载顺序

`mod.js` 的 `requires: ['exserver:other-ext']` 声明依赖；服务端按拓扑排序加载，依赖先就绪。禁用或缺失的依赖会被跳过。

## 配置与热更新

`server.conf.js` 默认导出配置对象：

```js
export default {
  enabled: true,
  accentHeading: '#4f6ef7',
  maxBytes: 262144,
};
```

热更新机制（`src/exserver/runtime.js`）：

- 监听配置所在**目录**（避免原子保存时文件短暂消失丢 watch）。
- 150ms 防抖合并多次事件。
- 读到文本后用 **data URL** 求值（绕开路径解析竞态）。
- `ENOENT` 静默重试、内容去重。
- 成功后 `ctx.config` 立即生效，并广播 `__nex:reload` 让前端自动刷新。

> 配置应为纯配置对象（无相对 import），才能用 data URL 求值。复杂逻辑请放进 `index.js`。

### 通过 API 查看与管理扩展

扩展元数据、能力标志与运行时配置可通过 HTTP 只读查看：

```bash
curl http://localhost:3000/api/extensions                                   # 全部扩展
curl http://localhost:3000/api/extensions/exserver%3Amarkdown-render        # 单扩展详情
curl http://localhost:3000/api/extensions/exserver%3Amarkdown-render/config  # 配置文件内容
```

详情返回 `id / kind / name / enabled / loaded / hooks / config`，不含 `mod` / `ctx` 内部对象（函数、socket 不可序列化）。

运行时改写配置需先开启 `security.apiWritable`（默认关闭，见 [安全策略](10-security.md)）：

```bash
curl -X PATCH -H 'content-type: application/json' \
  -d '{"maxBytes": 524288}' \
  http://localhost:3000/api/extensions/exserver%3Amarkdown-render/config
```

- JSON 对象与现有配置**浅合并**后写回 `server.conf.js`，磁盘内容随即更新；未提交的字段保持不变。
- 含函数 / 不可序列化值会被拒绝（400）——写回采用 JSON 序列化，扩展回调请放在 `index.js`。
- 成功后同步内存态并广播 `extension-config-changed` 与 `__nex:reload`（前端自动刷新）。
- `POST /api/extensions/toggle` 支持 `id=<id>&enabled=true|false` 显式置位（幂等），不传 `enabled` 仍为切换；两者都只改内存态。

## 示例：Markdown 渲染器

`Exserver/markdown-render` 演示了：

- `onRequest` 拦截 `.md`，手写极简 Markdown → HTML。
- 安全：转义内容、限制体积（超 `maxBytes` 返回 413）、链接白名单（挡 `javascript:`）、路径穿越兜底。
- 颜色双保险：内联 `style` + CSS 变量 `--accent-heading`，即使 CSP 缓存旧策略或内联被拦，标题仍是品牌色。
- `server.conf.js` 控制 `accentHeading` 与 `maxBytes`，改色即时热更新。

访问 `http://localhost:3000/README.md` 或 `/page/docs/hello.md` 查看效果。
