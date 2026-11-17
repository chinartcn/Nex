# 15 — HTTP API 参考

所有响应都会带 `Cache-Control: no-store`、CSP、CORS 头（见 [安全](10-security.md)）。主服务默认在 :3000。

## 静态与页面

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/` | GET | 主页（由 `resolveHome` 解析） |
| `/preview/*` | GET | 命中 home 路由的主页（默认 a2） |
| `/page/<id>/` | GET | 子页（自动补 index.html） |
| `/page/<id>/index.html` | GET | 子页 HTML（注入 Nex 脚本） |
| `/page/<id>/index.js` / `.css` | GET | 子页资源 |
| `/Exjs/<bundle>.js` | GET | 生产 bundle（来自 `dist/Exjs`） |
| `/dist/*` | GET | 构建产物静态文件 |
| `/README.md`、`*.md` | GET | Markdown 渲染（Exserver 钩子） |
| `/favicon.ico` | GET | 204 |
| `/_navext/exserver/<name>/*` | GET | Exserver 静态资源（如 styles.css） |

## 可观测性

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/health` | GET | 健康检查：`{status,uptimeMs,mode,version,time}` |
| `/api/stats` | GET | 运行指标：请求数/状态分布/日志量/总线连接数/扩展与页面数/最近请求 |
| `/api/routes` | GET | 路由自描述清单（API 自我发现，含 `gated` 标记） |
| `/api/bus/clients` | GET | 当前 WebSocket 总线连接快照（id/地址/连接时长） |

**`/api/health` 示例**：

```json
{ "status": "ok", "uptimeMs": 12345, "mode": "prod", "version": "2.0", "time": 1700000000000 }
```

**`/api/stats` 示例**（节选）：

```json
{
  "uptimeMs": 12345, "requests": 320, "apiRequests": 180,
  "byStatus": { "200": 310, "404": 10 }, "notFound": 10,
  "busClients": 2, "logs": 14, "extensions": 3, "pages": 2,
  "recent": [ { "t": 1700000000000, "method": "GET", "path": "/api/stats", "status": 200, "ms": 1 } ]
}
```

> 指标为**进程内存态**，重启清零；`recent` 只保留最近 20 条，用于排障。

## 总线广播（HTTP 触发）

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/bus/broadcast` | POST | 经 HTTP 向所有总线客户端广播事件；**受 `security.apiBroadcast` 门控，默认关闭** |

请求体（JSON）：

```json
{ "type": "my-event", "scope": "team", "payload": { "msg": "hello" } }
```

- `type`（必填，字符串）：事件类型。保留的内部事件（如 `__nex:reload`、`log:event` 等）会被拒绝（403），防止伪造刷新/日志信号。
- `scope`（可选，默认 `global`）：作用域，透传给客户端。
- `payload`（可选）：任意 JSON，透传。

成功响应：`{ "ok": true, "delivered": <客户端数>, "envelope": {...} }`。客户端收到的信封额外带 `_from: "http"` 标记。

错误：400（坏 JSON / 缺 type）、403（未开启门控 / 保留事件）。

启用方式（三选一）：
- `nav-ext.config.js` 设 `security.apiBroadcast: true`；
- 环境变量 `NEX_API_BROADCAST=1`；
- 运行时经 `POST /api/security/policy`（需 `apiWritable: true`）发送 `apiBroadcast=true`。

详见 [总线广播与安全](10-security.md)。

## 扩展与页面

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/extensions` | GET | 全部已发现扩展（含禁用者） |
| `/api/extensions/toggle` | POST | 启停：`id=<ext-id>`（urlencoded），仅内存态 |
| `/api/exjs` | GET | Exjs 清单；dev 经 Vite 代理时含源码清单与 `pageExjs`；prod 含 `bundles`/`pages` |
| `/api/manifest` | GET | 构建 manifest（prod）；未构建返回 404 |
| `/api/pages` | GET | 子页清单 |
| `/api/home` | GET | 当前解析到的主页路径字符串 |

## 日志

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/logs` | GET | 日志条目数组（环形缓冲） |
| `/api/logs/clear` | POST | 清空并广播 `log:cleared` |

## 安全

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/security` | GET | 当前安全策略 |
| `/api/security/policy` | POST | 策略补丁（urlencoded）；默认 403（`apiWritable=false`） |
| `/api/fs/write` | POST | FS 写门禁演示（`ext=...`）；默认 403 |

## 标准 Web 格式

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/form` | POST | 解析 JSON / urlencoded / multipart，返回 `{ok,contentType,fields}`；不支持类型 415 |
| `/api/stream` | GET | 分片流：`?n=1..20&delay=ms`，返回 `chunk i/n` |

## 客户端库

| 路径 | 说明 |
| --- | --- |
| `/_navext/bus.js` | `NexBus` 总线客户端 |
| `/_navext/navext.js` | `window.Nex` 规范化 API |
| `/_navext/sub.js` | NavExt-sub 客户端路由器 |
| `/_navext/bootstrap.js` | 引导脚本（按模式加载 Exjs） |
| `/_navext/exjs/<name>/*` | Exjs 源文件（dev） |

## 通用行为

- `OPTIONS` 任意路径 → 204（CORS 预检）。
- 命中 `blockedPaths`（如 `/admin`）→ 403。
- Exserver 的 `onRequest` 钩子在核心 API 之前对非 `/api`、`/_navext` 请求运行，可短路响应（如 Markdown 渲染）。

## 速查示例

```bash
curl http://localhost:3000/api/extensions
curl http://localhost:3000/api/pages
curl http://localhost:3000/api/exjs
curl http://localhost:3000/api/manifest
curl http://localhost:3000/api/security
curl -X POST -d 'ext=x' http://localhost:3000/api/fs/write      # 403
curl -o /dev/null -w '%{http_code}' http://localhost:3000/admin  # 403
curl -F name=nex http://localhost:3000/api/form
curl 'http://localhost:3000/api/stream?n=3&delay=50'
```
