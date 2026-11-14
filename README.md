# Nex

NavExt 2.0 实现（Phase 0 骨架）。架构见同级 `NavExt-2.0-arch.md`。

## 运行

```bash
cd Nex
node src/index.js
# 打开 http://localhost:3000
```

验证自动发现（无需 .js.list.json）：

```bash
curl http://localhost:3000/api/extensions
# 返回全部已发现扩展（含被禁用者）
```

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/` | 引擎（config / discover / registry / server / security / bus 桩） |
| `Exserver/` | 服务端扩展 + `security-policy/`（安全策略外置） |
| `Exjs/` | 客户端扩展（TS/React，接打包器） |
| `page/` | 统一页面目录（含 `sub.js`，摒弃默认 index.html） |
| `ui/` | 普通示例文件夹（作者随手取名，`ui1/` 为其中一个示例，**非内置/特殊概念**） |
| `NavExt-*` | TS / React / esbuild / vite / sub 能力目录（扁平顶层） |
| `nav-ext.config.js` | 全局统一配置（`.js`，含 `mode: 'dev'`） |

## 进度

- ✅ Phase 0：引擎骨架 + 自动发现 + 内存注册表 + 最小 `/api/extensions`
- ✅ Phase 1：`@NavExt-ws` 全双工总线（零依赖手写 WS）+ 标准 Web 格式信封 + **日志汇聚**（`src/log.js` 把 server/client 日志汇入统一环形缓冲并广播 `log:event`；`GET /api/logs`、`POST /api/logs/clear`；`Nex.log.on` 订阅统一流）
- ✅ Phase 2：Exserver / Exjs 运行时 + `.js` 配置加载（ctx.bus/fetch/timer/interval/hook，requires 拓扑排序）
- ✅ Phase 3：NavExt-TS / React SDK + 打包管线（esbuild → `dist/exjs/*.js`）
- ✅ Phase 4：NavExt-vite 热更（`mode:dev` 启动独立 Vite dev server 于 3001，HMR + 代理回主服务）
- ✅ Phase 5：安全策略外置（`Exserver/security-policy`）+ 安全 API + FS 写门禁 + 路径拦截；`page/` 子页自动发现 + `/api/pages`；**多主页路由**（`src/home.js` 按 path/host/env 选主页）+ NavExt-sub 客户端路由器 `Nex.router`（`go(id)` 经总线 `subpage:open` 由服务端权威解析回 `subpage:open:ok`，1s 离线兜底）+ `GET /api/home`
- ✅ Phase 6：规范化客户端 API `window.Nex`（bus/params/form/stream/dom/router/log）+ 标准 Web 格式端点（`/api/form` FormData、`/api/stream` ReadableStream、总线 `stream:data` 中继）+ 1.x 废弃清理（旧 `window.NavExt` → `window.Nex`）

## 命令

```bash
cd Nex
npm install        # 安装 esbuild / react（构建期依赖）
npm run build      # NavExt-esbuild：打包 Exjs → dist/exjs/*.js
node src/index.js  # 启动（开发态可直接跑，未构建则回退源）
```

## 快速验证

```bash
cd Nex
node src/index.js
# 生产态（nav-ext.config.js mode:'prod'）：http://localhost:3000
# 开发态（mode:'dev'）：https:// 打开 http://localhost:3001 （Vite HMR，代理回 3000）

curl http://localhost:3000/api/extensions
curl http://localhost:3000/api/exjs        # dev 返回 /Exjs 源；prod 返回 dist 产物
curl http://localhost:3000/api/pages       # Phase 5 子页清单
curl http://localhost:3000/api/security    # 当前安全策略
curl -X POST --data "ext=x" http://localhost:3000/api/fs/write   # 403（默认最小授权）
curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin # 403（blockedPaths）
# Phase 6：标准 Web 格式端点
curl -F name=nex -F mode=dev http://localhost:3000/api/form   # FormData 解析 → {"ok":true,"fields":[...]}
curl "http://localhost:3000/api/stream?n=3&delay=50"          # Standard Web Streams 分片出站
# 多主页路由：NEX_HOME_A2=1 node src/index.js → 访问 / 命中 a2；/preview/ 也命中 a2
# 浏览器打开开发地址 http://localhost:3001 → 控制台可见 server-ready / pong，页面出现 React 面板
#   规范化客户端 API：window.Nex（bus/params/form/stream/dom/router/log）
#   修改 Exjs/example-ext/*.ts(x) 即触发热更新
# WS 经 Vite 代理：连 ws://localhost:3001/@NavExt-ws 发 {type:"client-ping"} 收 server-pong
#   总线流：发 {type:"stream:data",payload:{name,seq,chunk,done}} 经内置中继扇出，Exserver 回显 server-stream:echo
```
