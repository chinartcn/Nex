# 02 — 快速开始

## 环境要求

- Node.js ≥ 18（推荐 20+；本项目在 Node 22 上验证）。
- npm（随 Node 一起安装）。
- 无其他运行时依赖。Chromium 仅全量测试中的浏览器检查需要（见 [测试](16-testing.md)）。

## 安装

工作目录为项目根 `Nex/`：

```bash
cd Nex
npm install
```

安装的是**构建期/开发期依赖**：`esbuild`、`vite`、`react`、`react-dom`、`@vitejs/plugin-react`、`@types/*`。

## 生产模式（npm start）

```bash
npm start
```

`npm start` 会先触发 `prestart` 自动执行 `npm run build`，生成 `dist/`，然后启动静态服务：

- 主服务：`http://localhost:3000`
- 消费 `dist/` 下的 bundle 与页面产物
- 不启动 Vite

打开 <http://localhost:3000> 即见默认主页（`page/a1`）。

> 若直接用 `node src/index.js`（绕过 `prestart`）而没有 `dist/`，服务仍会启动，但会打印一条 `dist/Exjs 不存在` 的警告——此时先执行 `npm run build`。

## 开发模式（npm run dev）

```bash
npm run dev
```

同时启动：

- 主服务：`http://localhost:3000`（Exserver、API、总线、静态资源）
- Vite 开发服务器：`http://localhost:3001`（HMR、直接消费 `.ts/.tsx`）

**开发时请打开 :3001**（<http://localhost:3001>），它把 `/api`、`/@NavExt-ws`、`/_navext`、`/dist`、`/page`、`/preview` 代理回 :3000，同时提供 HMR。:3000 仍可直接访问，但不带 HMR。

## 第一个验证请求

```bash
# 扩展清单（自动发现，无需清单文件）
curl http://localhost:3000/api/extensions

# 子页清单
curl http://localhost:3000/api/pages

# 当前安全策略（默认最小授权）
curl http://localhost:3000/api/security

# 构建 manifest（prod）
curl http://localhost:3000/api/manifest
```

## 常用命令一览

| 命令 | 作用 |
| --- | --- |
| `npm start` | 构建 + 生产静态服务（:3000） |
| `npm run dev` | 主服务 + Vite HMR（:3000 + :3001） |
| `npm run build` | 依赖分析 + 分组 bundle + 重写 HTML |
| `npm run analyze` | 只输出依赖分析报告，不构建 |
| `npm test` | 构建 + prod/dev 双模式全量测试 |
| `npm run test:prod` / `test:dev` | 单模式测试 |

## 端口

| 端口 | 服务 | 模式 |
| --- | --- | --- |
| 3000 | Nex 主服务 | prod + dev |
| 3001 | Vite 开发服务器 | 仅 dev |

端口可在 `nav-ext.config.js` 的 `server.port` / `vite.port` 修改。

## 接下来

- 写服务端扩展：[Exserver](06-exserver.md)
- 写客户端扩展：[Exjs](07-exjs.md)
- 理解配置：[配置体系](03-configuration.md)
