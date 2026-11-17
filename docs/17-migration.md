# 17 — 1.x → 2.0 迁移与废弃清单

Nex 2.0 是**彻底重写**，大量 1.x 机制被直接废弃。本文列出废弃项与替代方案。

## 决议背景

六项核心决议（已定稿）：

| 决议 | 结论 |
| --- | --- |
| 布局 A/B | 采用扁平顶层 A（根目录 `Nex/`） |
| 总线协议 | 原生标准 Web 格式，弃用 JSON-RPC |
| Vite/esbuild 分工 | TS 与 Exjs 统一走打包器（dev Vite / prod esbuild） |
| 安全默认粒度 | 默认最小授权（FS 写默认关） |
| `ui/` 与 `ui1/` | 只是普通示例文件夹，非内置概念，名称任意 |
| 保留 `html.json`？ | 完全摒弃，大量 1.x 旧 API 一并废弃 |

## 废弃清单

| 1.x 废弃项 | Nex 2.0 替代 | 说明 |
| --- | --- | --- |
| `.js.list.json` 手工清单 | 自动扫描发现（[05](05-architecture.md)） | 扫描 `Exserver/`、`Exjs/` 目录 |
| `.json` 配置文件 | `.js` 配置（[03](03-configuration.md)） | 含热更新 |
| 默认 `index.html` 主页 | `page/sub.js` / `nav-ext.config.js` 显式指定（[11](11-subpages.md)） | 不再隐式 |
| `html.json` 文件元数据 | `conf.js` / `sub.js` | 完全摒弃 |
| `jsx.json` 黑名单 | `conf.js` 的 `exjs` **白名单**（[07](07-exjs.md)） | 语义反转 |
| 旧 `window.NavExt` 私有 API | `window.Nex`（[09](09-client-api.md)） | 统一分层命名空间，不再兼容旧名 |
| 旧 `/api/*` REST 形态 | 统一总线 `@NavExt-ws`（[08](08-bus.md)） | 客户端不直连服务端 |
| 私有 JSON-RPC | 信封 `{type,scope,payload}` + 标准 Web 格式 | 不引入私有协议 |
| mtime 轮询热重载 | Vite HMR + `__nex:reload`（[14](14-dev-hmr.md)） | 推模式替代拉模式 |
| 客户端直连服务端 | 总线中转 | 全双工、可广播 |
| 服务端钩子目录 `.js/` | `Exserver/` / `Exjs/` | 两类扩展分离 |

## 迁移要点

### 客户端代码

```js
// ❌ 1.x
window.NavExt.on(...); window.NavExt.send(...);

// ✅ 2.0
Nex.bus.on(...); Nex.bus.send(...);
Nex.ready((bus) => { /* ... */ });
```

- 所有 `window.NavExt.*` → `window.Nex.*` 对应方法。
- 直接调 `/api/*` 的逻辑改为发总线事件。
- 表单数据用 `Nex.params` / `Nex.form`；流用 `Nex.stream`。

### 扩展迁移

- 服务端钩子 → `Exserver/<name>/index.js`（`onReady`/`onMessage`/`onRequest`）。
- 客户端 `.js` → `Exjs/<name>/index.ts`（TS），UI 用 React `.tsx`。
- 配置从 `.json` → `.js`（默认导出对象）。
- 主页/文件元数据 → `conf.js` / `sub.js`。

### 运行方式

- 不再在配置文件里改 `mode` 切换开发/生产；用 `npm start`（prod）/ `npm run dev`（dev）。
- 开发打开 :3001（HMR），生产打开 :3000。

## 不再支持

- `window.NavExt`（任何旧方法）。
- `.js.list.json`、`jsx.json`、`html.json` 等所有 `.json` 配置。
- 旧 `/api/*` REST 交互形态（新的 `/api/*` 仅用于扩展清单、安全、日志、标准格式演示等控制面用途）。
- JSON-RPC 私有协议。

> 若发现旧文档仍提到上述机制，以本仓库 `docs/` 为准。
