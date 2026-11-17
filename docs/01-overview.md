# 01 — 概览与设计原则

## Nex 是什么

Nex（NavExt 2.0）是一个**零运行时依赖的导航 / 扩展平台**：一个用 Node.js 手写 HTTP + WebSocket 的小型引擎，加上两套扩展体系（服务端 Exserver、客户端 Exjs），一套全双工总线，以及现代化的标准 Web 数据格式。

它是 NavExt 1.x 的**彻底重写**，不是增量升级。大量 1.x 机制被直接废弃（见 [迁移与废弃清单](17-migration.md)）。

## 一句话架构

```
浏览器                          Nex 引擎                        扩展
───────                        ────────                       ──────
window.Nex  ──HTTP──▶  src/server.js（静态 + API + 钩子）
     │                          │
     └──WebSocket──▶  src/bus（@NavExt-ws）◀──▶ Exserver（服务端扩展）
                                 │
                          Exjs 客户端扩展（TS/React）
```

- **前后端解耦**：客户端扩展不直接调 `/api/*`，一律走总线。
- **扩展即目录**：扫描 `Exserver/`、`Exjs/` 自动发现，无需清单文件。
- **配置即代码**：`.js` 配置，热更新，摒弃 `.json` 配置。
- **安全默认最小授权**：写文件默认关，策略由 Exserver 定义。

## 解决 1.x 的哪些痛点

| 1.x 痛点 | Nex 2.0 做法 |
| --- | --- |
| 手写 `.js.list.json` 清单、多份配置散落 | 自动扫描发现 + 内存注册表（[05](05-architecture.md)） |
| 客户端私有 `window.NavExt` API 杂乱 | 统一分层命名空间 `window.Nex`（[09](09-client-api.md)） |
| 前后端直接耦合、私有 JSON-RPC | 全双工总线 `@NavExt-ws` + 标准 Web 格式（[08](08-bus.md) / [12](12-web-formats.md)） |
| 安全规则硬编码、默认全开 | 安全策略外置到 Exserver、默认最小授权（[10](10-security.md)） |
| mtime 轮询热重载、构建混乱 | Vite HMR（dev）+ esbuild（prod）统一管线（[14](14-dev-hmr.md) / [13](13-build.md)） |
| `html.json`、默认 `index.html` 主页 | `conf.js` / `sub.js` 显式声明（[11](11-subpages.md)） |

## 七条设计原则

| # | 原则 | 含义 |
| --- | --- | --- |
| P1 | 更现代、去除繁琐 | 废弃手写清单与散落配置 |
| P2 | 自动发现取代手工清单 | 扫描目录识别扩展 |
| P3 | 前后端解耦、统一总线 | 客户端经 `@NavExt-ws` 通信 |
| P4 | 安全外置、可扩展 | 安全是一种 Exserver 能力 |
| P5 | 标准 Web API / 规范化 | `URLSearchParams` / `FormData` / `ReadableStream` |
| P6 | 配置即代码（`.js`） | `.json` 配置全部废弃 |
| P7 | 完整重构、大胆废弃 | 1.x 旧 API 直接摒弃 |

## 技术栈

| 能力 | 选型 | 用途 |
| --- | --- | --- |
| HTTP / WebSocket 服务 | Node.js 内置模块（手写 RFC6455） | 运行时零依赖 |
| 客户端扩展 | TypeScript + 可选 React | `.ts` / `.tsx` |
| 开发热更新 | Vite（:3001） | 直接消费源码、HMR |
| 生产打包 | esbuild | 依赖分析 → 分组 bundle |
| 配置 | `.js`（ESM） | 全局、扩展、页面、安全配置 |

> 运行时只有 Node.js 内置模块；`esbuild` / `vite` / `react` 等是**构建期/开发期依赖**，不进入运行时。

## 两个运行模式

| 模式 | 命令 | 行为 |
| --- | --- | --- |
| `prod`（生产） | `npm start` | 静态服务 :3000，消费 `dist/` 构建产物，不启动 Vite |
| `dev`（开发） | `npm run dev` | 主服务 :3000 + Vite :3001，直接消费 `.ts/.tsx` 源码并 HMR |

启动命令优先于配置文件里的 `mode`——见 [配置体系](03-configuration.md)。

## 下一步

- 想跑起来：[快速开始](02-quickstart.md)
- 想理解内部机制：[架构与运行机制](05-architecture.md)
