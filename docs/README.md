# Nex 文档中心

> Nex = NavExt 2.0，一次完整架构重写。基本方针：**更现代、去除繁琐**。

这里按主题拆分的完整文档。若你是第一次接触，建议按下面「阅读路径」顺序看。

## 阅读路径

| 你是…… | 建议顺序 |
| --- | --- |
| 想先跑起来看看 | [快速开始](02-quickstart.md) → [概览](01-overview.md) |
| 要写扩展（Exserver / Exjs） | [概览](01-overview.md) → [Exserver](06-exserver.md) / [Exjs](07-exjs.md) → [总线](08-bus.md) → [客户端 API](09-client-api.md) |
| 要改引擎 / 做二次开发 | [架构与运行机制](05-architecture.md) → [目录结构](04-directory-layout.md) → [配置体系](03-configuration.md) |
| 关心安全 / 部署 | [安全策略](10-security.md) → [构建](13-build.md) → [HTTP API](15-http-api.md) |
| 从 1.x 迁移过来 | [迁移与废弃清单](17-migration.md) → [FAQ](18-faq.md) |

## 文档清单

### 入门
- [01 — 概览与设计原则](01-overview.md)：Nex 是什么、解决什么问题、七条设计原则、与 1.x 的根本区别。
- [02 — 快速开始](02-quickstart.md)：安装、启动、prod/dev 双模式、第一个可用请求。
- [03 — 配置体系](03-configuration.md)：`nav-ext.config.js` 及各类 `.js` 配置。
- [04 — 目录结构](04-directory-layout.md)：每个目录/文件的职责。

### 核心机制
- [05 — 架构与运行机制](05-architecture.md)：启动流程、扩展发现、生命周期、请求管线。
- [06 — Exserver 服务端扩展](06-exserver.md)：`onReady` / `onMessage` / `onRequest`、`ctx`、热更新。
- [07 — Exjs 客户端扩展](07-exjs.md)：TS/React 编写、白名单声明、开发/生产加载。
- [08 — `@NavExt-ws` 全双工总线](08-bus.md)：信封协议、内置事件、广播、流式中继。
- [09 — 客户端 API `window.Nex`](09-client-api.md)：`bus/params/form/stream/dom/router/log` 全部方法。
- [10 — 安全策略](10-security.md)：默认最小授权、CSP/CORS、FS 门禁、路径拦截、安全 API。
- [11 — 子页与多主页路由](11-subpages.md)：`page/` 子页发现、`resolveHome`、客户端路由器。
- [12 — 标准 Web 格式](12-web-formats.md)：`URLSearchParams`/`FormData`/`ReadableStream` 的使用。

### 工程
- [13 — 构建与依赖分析](13-build.md)：白名单 → 依赖图 → 分组 bundle → HTML 重写。
- [14 — 开发热更新](14-dev-hmr.md)：Vite :3001、代理、HMR 与自动刷新。
- [15 — HTTP API 参考](15-http-api.md)：所有端点的请求/响应速查。
- [16 — 测试](16-testing.md)：全量测试套件的组成与运行方式。
- [17 — 1.x → 2.0 迁移与废弃清单](17-migration.md)：废弃项与替代方案。
- [18 — 常见问题](18-faq.md)：排查与陷阱。

## 约定

- 文中**加粗**表示关键概念或重要限制；`行内代码` 表示路径、命令、标识符。
- 代码块默认可直接复制执行，工作目录为项目根 `Nex/`。
- 运行模式由**启动命令**决定（`npm start` / `npm run dev`），不靠改配置文件切换——详见 [配置体系](03-configuration.md)。
