# 10 — 安全策略

Nex 的安全模型：**核心只做不可关闭的兜底，具体策略外置到 Exserver，默认最小授权**。

## 分层

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 基础兜底 | `src/security/core.js` | 路径穿越防护等（不可关闭） |
| 策略运行时 | `src/security/runtime.js` | 合并策略、注入响应头、门禁判定 |
| 策略加载 | `src/security/policy-loader.js` | 从 Exserver 加载策略 |
| 策略定义 | `Exserver/security-policy/index.js` | 显式声明 CSP/CORS/FS/blockedPaths |

启动时 `SecurityPolicy.load()` 合并顺序：`DEFAULT` ← Exserver 策略 ← 全局配置 `security`。

## 默认策略

```js
csp: "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"
cors: { origins: ['*'], methods: ['GET', 'POST', 'OPTIONS'] }
fsWrite: false
allowFsWrite: []
blockedPaths: ['/admin']
```

要点：

- **脚本锁 `self`**（挡 XSS），但**放开内联样式**——React 的 `style={{}}` 与 Markdown 标题色都依赖内联样式。
- `img-src`/`font-src` 放开 `data:`，满足常见 UI 需求。
- **FS 写默认关**：任何扩展写文件默认被拒，需显式放行。

## 响应头

`applyHeaders(res)` 对所有响应注入：

| 头 | 值 |
| --- | --- |
| `Cache-Control` | `no-store` |
| `Content-Security-Policy` | 策略中的 csp |
| `Access-Control-Allow-Origin` | `*` 或首个 origin |
| `Access-Control-Allow-Methods` | GET, POST, OPTIONS |

> `no-store` 很关键：否则浏览器可能缓存旧 CSP/旧渲染响应，导致「改配置颜色不变」「内联样式被旧策略拦截变黑」等问题。

## 路径拦截

- 命中 `blockedPaths`（如 `/admin`）→ 403。
- 匹配规则：路径相等或以 `<p>/` 开头。
- 路径穿越尝试（如 `/page/../../../etc/passwd`）→ 404/403。

## FS 写门禁

```js
canWriteFs(extId) {
  if (policy.fsWrite) return true;              // 总开关
  return (policy.allowFsWrite || []).includes(extId); // 白名单
}
```

`POST /api/fs/write` 演示该门禁：默认返回 403（`fs write denied by policy`）。要放行某扩展，在策略里设 `fsWrite: true` 或把扩展 id 加入 `allowFsWrite`。

## 安全 API

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/security` | GET | 返回当前策略（`toJSON()`，含 `fsWriteDefault`） |
| `/api/security/policy` | POST | 运行时补丁；**受 `apiWritable` 门控**，默认 403 |
| `/api/fs/write` | POST | FS 写门禁演示 |

`POST /api/security/policy` 接受 `application/x-www-form-urlencoded`，例如 `fsWrite=true`、`allowFsWrite=exserver:example-ext,exserver:other`。仅当全局 `security.apiWritable === true` 时才允许，否则 403。成功后经总线广播 `security-policy-changed`。

## 扩展如何定义安全策略

编辑 `Exserver/security-policy/index.js`（默认导出策略对象），重启生效（策略本身不热更新，扩展的 `server.conf.js` 才热更新）。核心只保留不可关闭的兜底，其余由此文件决定。

## 开发者提醒

- 关闭 `no-store` 或收紧 `style-src` 都可能让 React UI / Markdown 颜色失效——这是历史踩过的坑。
- 安全策略 API 默认不可写是有意的；若要演示运行时改策略，需显式开启 `apiWritable`。
