# 14 — 开发热更新

开发模式（dev）由 `src/dev/vite.js` 在 :3001 启动一个独立 Vite dev server，直接消费 `.ts/.tsx` 源码并提供 HMR。启动方式：`npm run dev`（`node src/index.js --dev`）。

## 端口与代理

| 端口 | 服务 | 说明 |
| --- | --- | --- |
| 3000 | Nex 主服务 | Exserver / API / 总线 / 静态资源 |
| 3001 | Vite dev server | 浏览器开发入口，带 HMR |

Vite 把这些路径**代理回 :3000**：

- `/api` —— 并带 `x-nex-via-vite: 1` 头，主服务据此在 `/api/exjs` 下发 dev 源码清单。
- `/@NavExt-ws` —— WebSocket 代理（`ws: true`），总线仍连主服务。
- `/_navext` —— 客户端库/引导脚本。
- `/dist`、`/page`、`/preview` —— 构建产物与页面。

HMR 使用**专属路径** `/__nex_hmr`，避免抢占 `/@NavExt-ws` 的 upgrade。

## 开发时请打开 :3001

<http://localhost:3001> 是推荐开发地址：

- 有 Vite HMR，改 `.ts/.tsx` 立即热更。
- 代理 `/api/exjs` 时 `viaVite=true`，bootstrap 才会按白名单动态 import 源码。

直连 :3000 也能访问，但：

- 无 HMR。
- `/api/exjs` 返回空清单（`viaVite=false`），bootstrap 不会加载 `.ts` 源码——这是为了直连时不报「未经转译的 TS」错误，属正确设计。

## Markdown 转发插件

Vite 默认会把 `/README.md` 这类请求原样当作静态文件返回，绕过主服务的 Markdown 渲染器。`src/dev/vite.js` 的 `nex-md-proxy` 插件把所有 `.md` 请求转发回主服务，使 3001 与 3000 行为一致（都渲染出颜色与总线脚本）。

## 自动刷新机制

两条通道都广播 `__nex:reload`，浏览器收到后防抖刷新：

1. **Exserver 配置变更**：`server.conf.js` 热更新成功后由 `src/exserver/runtime.js` 广播。
2. **Vite watcher**：dev 下源文件变更时由 Vite watcher 广播。

这覆盖：

- Vite 页（有 `@vite/client`）
- 3000 直连页
- 经代理的 SSR Markdown 页（**没有** `@vite/client`，但注入了 `NexBus`，所以靠总线通道）

## 其它细节

- `/favicon.ico` 返回 204，避免 dev 控制台 404。
- React Refresh preamble 按需注入：在 bootstrap 检测到 dev 且未安装时，尝试 import `/@react-refresh` 并注入全局钩子；非 Vite 环境静默忽略。
- 所有 HTML（含代理页）会注入总线/引导脚本（`/_navext/bus.js`、`navext.js`、`bootstrap.js`）。
- 其他静态回退见 `src/server.js` 的 dev 分支。

## 常见现象

- **改了后端配置，页面没变**：确认总线 `__nex:reload` 是否到达；配置热更新有 150ms 防抖，稍等即可。
- **3001 的 .md 原样返回**：确认 `nex-md-proxy` 插件生效，或重启 dev。
- **控制台 `Failed to fetch`**：多为测试环境多 tab 竞态；单独访问应正常（见 [测试](16-testing.md)）。
