# 16 — 测试

Nex 提供一套**零依赖、可重复运行**的全量测试套件，位于 `test/`。它自己启动/关闭服务，覆盖 prod 与 dev 双模式。

## 运行

```bash
npm test              # 先构建，再跑 prod + dev 双模式（推荐）
npm run test:prod     # 仅 prod
npm run test:dev      # 仅 dev
node test/run.mjs     # 直接运行（需已有 dist）
```

- `pretest` 会自动执行一次 `npm run build`，保证 prod 产物就绪。
- 结果同时输出到控制台与 `/workspace/test-report.json`。
- 全部通过时进程退出码 0，有失败则非 0。

当前基线：**133 项测试全通过**（24 个套件，prod + dev 双模式；报告见 `/workspace/test-report.json`）。

## 文件

| 文件 | 职责 |
| --- | --- |
| `test/harness.mjs` | 测试框架：断言/报告器、HTTP 客户端、手写 WS(RFC6455) 客户端、CDP 浏览器采集、进程管理 |
| `test/run.mjs` | 24 个测试套件的定义与编排 |

## 测试套件

| 套件 | 覆盖 |
| --- | --- |
| 构建产物与依赖分析（离线） | 产物齐全、manifest 与白名单一致、`--selftest` 分组算法 |
| HTTP 端点 / 静态 / 主页路由 | 主页、子页、目录形式、资源、bundle、Markdown、多主页路由、favicon |
| API 端点 | extensions / exjs / manifest / pages / logs / home / security / toggle |
| 标准 Web 格式 | JSON / URLSearchParams / multipart FormData / 415 / Streams 分片 |
| 安全策略 | CSP/CORS/no-store 头、OPTIONS、路径拦截、FS 门禁、策略不可写、路径穿越 |
| `@NavExt-ws` 全双工总线 | 握手、ping→pong、stream 中继回声、subpage 权威解析、非法消息容错 |
| 可观测性 API | health 状态/uptime、stats 请求计数、routes 自描述、bus/clients 连接快照 |
| HTTP 触发总线广播 | 默认 403 门控、env/策略开启、坏 JSON/缺 type/保留事件校验、WS 客户端实际收到 |
| 扩展管理 API | 单扩展详情（能力标志/不泄漏 mod/ctx）、配置读取、不存在 404、默认门控、toggle 幂等置位 |
| 配置自省 API | GET 结构与脱敏、PATCH 默认 403、`redact()` 敏感键/函数过滤单测 |
| 配置管理写路径 | 独立实例开启 `apiWritable`：扩展配置写回文件+读回一致、site/home 运行时生效、非法字段整批拒绝、空/数组 body 400 |
| 浏览器运行时 | 各页面 0 console error、Markdown 标题色 DOM 验证 |
| Vite 开发服务器（dev） | 3001 关键页面、代理 `viaVite` 标记与白名单下发 |

## 设计要点（避免误报）

- **server-ready 是启动期广播**：握手用例只验证连接即时收发；广播能力由 ping/stream/subpage 用例覆盖。
- **dev 直连 3000 的 `viaVite=false` 是正确设计**：经 3001 代理的 `viaVite=true` 单独验证。
- **浏览器采集每页独立进程**：同一 chromium 多 tab 快速切换时，被关闭 tab 的脚本（WS/fetch）中断会串扰到下一 tab，造成 `Failed to fetch` 误报；改为每个 URL 启动独立浏览器进程后根除（单页独立复测均 0 error）。

## 浏览器检查依赖

CDP 浏览器检查需要系统安装 `chromium`（测试环境为 `/usr/bin/chromium`）。若缺少浏览器，可在 `test/run.mjs` 中临时注释浏览器套件，其余 HTTP/WS/安全测试不依赖浏览器。

## 报告格式

`/workspace/test-report.json` 结构：

```json
{
  "generatedAt": "...",
  "passed": 83, "failed": 0, "total": 83,
  "suites": [
    { "suite": "...", "total": 10, "passed": 10, "failed": 0,
      "cases": [ { "title": "...", "ok": true, "checks": [...] } ] }
  ]
}
```
