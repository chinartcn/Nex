# Nex

> **NavExt 2.0** —— 现代化、零运行时依赖的导航 / 扩展平台。基本方针：**更现代、去除繁琐**。
>
> 这是 NavExt 1.x 的**彻底重写**，不是增量升级。完整文档见 [docs/](docs/README.md)。

## 特性

- **零运行时依赖**：Node.js 内置 HTTP + 手写 RFC6455 WebSocket。
- **两套扩展体系**：`Exserver`（服务端）/ `Exjs`（客户端，TS + 可选 React），目录自动发现，无需清单。
- **统一全双工总线**：`@NavExt-ws` 取代私有 RPC，前后端解耦，服务端可主动广播。
- **标准 Web 格式**：`URLSearchParams` / `FormData` / `ReadableStream`，不引入私有协议。
- **安全默认最小授权**：FS 写默认关；CSP/CORS 由外置策略定义；路径穿越兜底不可关闭。
- **双模式**：`npm start` 跑 `dist/` 生产静态服务；`npm run dev` 跑 Vite HMR。
- **配置即代码**：`.js` 配置 + 热更新；彻底摒弃 1.x 的 `.json` 清单、`html.json`、`window.NavExt` 等旧机制。
- **分组构建**：依赖分析 → 白名单 → 共享 bundle，减少浏览器请求数。
- **可观测性 API**：`/api/health` `/api/stats` `/api/routes` `/api/bus/clients`，运行指标与路由自描述开箱即用。
- **HTTP 触发总线**：`POST /api/bus/broadcast` 让外部系统经 HTTP 向前端广播（受 `apiBroadcast` 门控，默认关闭）。
- **全量测试**：零依赖测试套件，prod/dev 双模式全通过。

## 快速开始

```bash
cd Nex
npm install

npm start      # 生产：自动构建 + 静态服务 http://localhost:3000
# 或
npm run dev    # 开发：主服务 :3000 + Vite HMR :3001（开发请打开 :3001）
```

验证：

```bash
curl http://localhost:3000/api/extensions   # 自动发现的扩展清单
curl http://localhost:3000/api/pages        # 子页清单
curl http://localhost:3000/api/security     # 当前安全策略
```

浏览器打开：

- 生产：<http://localhost:3000>
- 开发：<http://localhost:3001>（带 HMR）

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | `prestart` 自动构建 + 生产静态服务（:3000） |
| `npm run dev` | 主服务 + Vite HMR（:3000 + :3001） |
| `npm run build` | 依赖分析 + 分组 bundle + 重写 HTML |
| `npm run analyze` | 只输出依赖分析报告，不构建 |
| `npm test` | 构建 + prod/dev 双模式全量测试 |
| `npm run test:prod` / `test:dev` | 单模式测试 |

> 运行模式由**启动命令**决定（`--dev` flag / `NEX_MODE` / 配置 `mode` / prod 兜底），不是靠改配置文件切换。

## 文档

完整文档已拆分到 [`docs/`](docs/README.md)，按主题检索：

### 入门
- [概览与设计原则](docs/01-overview.md)
- [快速开始](docs/02-quickstart.md)
- [配置体系](docs/03-configuration.md)
- [目录结构](docs/04-directory-layout.md)

### 核心机制
- [架构与运行机制](docs/05-architecture.md)
- [Exserver 服务端扩展](docs/06-exserver.md)
- [Exjs 客户端扩展](docs/07-exjs.md)
- [`@NavExt-ws` 全双工总线](docs/08-bus.md)
- [客户端 API `window.Nex`](docs/09-client-api.md)
- [安全策略](docs/10-security.md)
- [子页与多主页路由](docs/11-subpages.md)
- [标准 Web 格式](docs/12-web-formats.md)

### 工程
- [构建与依赖分析](docs/13-build.md)
- [开发热更新](docs/14-dev-hmr.md)
- [HTTP API 参考](docs/15-http-api.md)
- [测试](docs/16-testing.md)
- [1.x → 2.0 迁移与废弃清单](docs/17-migration.md)
- [常见问题](docs/18-faq.md)

## 目录一览

| 路径 | 作用 |
| --- | --- |
| `src/` | 引擎核心（config / discover / registry / server / bus / exserver / exjs / security / dev） |
| `Exserver/` | 服务端扩展 + `security-policy/`（安全策略外置） |
| `Exjs/` | 客户端扩展（TS/React，经打包器） |
| `page/` | 统一页面目录（子页 + 内容页，无默认 index.html 主页） |
| `NavExt-esbuild/` | 生产打包：依赖分析 + 分组 bundle |
| `NavExt-vite/` · `NavExt-TS/` · `NavExt-React/` · `NavExt-sub/` | 能力目录（**目录名**，示例性命名，可任意改名） |
| `ui/` | 普通示例文件夹（`ui1/` 是其中一个示例，**非内置/特殊概念**） |
| `test/` | 全量测试套件 |
| `docs/` | 本文档中心 |
| `nav-ext.config.js` | 全局统一配置（`.js`） |
| `dist/` | 构建产物（gitignore；prod 消费，含 `Exjs/` 大写目录） |

## 状态

Phase 0–6 全部完成：

- ✅ Phase 0：引擎骨架 + 自动发现 + 内存注册表
- ✅ Phase 1：`@NavExt-ws` 全双工总线 + 日志汇聚
- ✅ Phase 2：Exserver / Exjs 运行时 + `.js` 配置加载
- ✅ Phase 3：TS / React SDK + esbuild 打包管线
- ✅ Phase 4：Vite 热更（:3001）
- ✅ Phase 5：安全策略外置 + 子页/多主页路由 + 客户端路由器
- ✅ Phase 6：规范化 `window.Nex` + 标准 Web 格式 + 1.x 废弃清理
- ✅ 构建两阶段：依赖分析 + 分组 bundle + 白名单收敛加载
- ✅ API 升级：可观测性（health/stats/routes/clients）+ HTTP 触发总线广播（门控）
- ✅ 全量测试：prod/dev 双模式 105 项全通过

## 仓库

<https://github.com/chinartcn/Nex>
