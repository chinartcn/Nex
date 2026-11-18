# 03 — 配置体系

Nex 用 **`.js`（ESM）作为配置格式**，旧版所有 `.json` 配置均已废弃。配置支持热更新。

## 运行模式的决定方式（重要）

**模式由启动命令决定，不是靠改配置文件**：

```
CLI flag（--dev / --prod）  >  环境变量 NEX_MODE  >  配置文件 mode  >  prod 兜底
```

- `npm run dev` → `node src/index.js --dev` → dev
- `npm start` → `node src/index.js` → 配置文件 `mode`（默认 prod）
- 也可 `NEX_MODE=dev node src/index.js` 覆盖

实现见 `src/config.js` 的 `loadConfig()`。这保证 `start` 与 `dev` 行为不会因配置文件而混淆。

## 配置文件清单

| 文件 | 作用域 | 加载方 | 说明 |
| --- | --- | --- | --- |
| `nav-ext.config.js` | 全局 | `src/config.js` | 端口、站点信息、多主页路由、安全开关 |
| `Exserver/<ext>/server.conf.js` | 单服务端扩展 | `src/exserver/runtime.js` | 扩展配置；`ctx.config` 实时读取，改动热更新 |
| `Exjs/<ext>/conf.js` | 单客户端扩展 | esbuild / deps | `enabled` 等；打包期读取 |
| `page/<id>/conf.js` | 单页面 | `src/subpage.js` / `deps.mjs` | `title` / `description` / `exjs` 白名单 |
| `page/<id>/sub.js` | 单页面 | `src/subpage.js` | 作用域 `paths`、是否 `home` |
| `page/sub.js` | 全局子页 | `src/subpage.js` | 主页 `home`、页面排序 `pages` |
| `Exserver/security-policy/index.js` | 安全策略 | `src/security/runtime.js` | CSP/CORS/FS 门禁/blockedPaths |

## 全局配置 `nav-ext.config.js`

当前默认内容（逐项说明）：

```js
export default {
  mode: 'prod',                       // 默认模式；实际由启动命令覆盖
  server: { host: '0.0.0.0', port: 3000 },
  site: {
    title: 'Nex',
    description: 'NavExt 2.0',
    accent: '#4f6ef7',                // 站点主题色
  },
  home: {
    enabled: true,
    file: 'page/a1/index.html',       // 默认主页文件
    routes: [                         // 多主页路由（path / host / env）
      { path: '/preview/*', file: 'page/a2/index.html' },
      { env: 'NEX_HOME_A2', file: 'page/a2/index.html' },
    ],
  },
  security: { fsWrite: false, apiWritable: false }, // 默认最小授权
};
```

- `server`：主机与端口。
- `site`：站点元信息。
- `home`：主页路由，详见 [子页与多主页路由](11-subpages.md)。
- `security`：`fsWrite` 控制 FS 写门禁总开关，`apiWritable` 控制安全策略 API 是否可写（默认都关）。

## 页面配置 `page/<id>/conf.js`

```js
export default {
  title: 'A1',
  description: '子页示例',
  // exjs 白名单：本页要加载的客户端扩展（1.x 是黑名单，这里反过来）
  exjs: ['example-ext'],
};
```

- `exjs` 是**白名单**：只加载声明的扩展；不声明 = 不加载任何 Exjs。
- 支持目录名 `example-ext` 或完整 id `exjs:example-ext`。
- 该声明同时被 dev 引导裁剪与 prod 构建依赖分析使用（见 [Exjs](07-exjs.md)、[构建](13-build.md)）。

## 服务端扩展配置 `server.conf.js`

```js
export default {
  enabled: true,
  options: {},
  accentHeading: '#4f6ef7',   // 扩展自定义项
  maxBytes: 262144,
};
```

特点：
- 通过 `ctx.config` 读取，getter 实时反映最新值。
- 修改文件**无需重启**：监听目录 + 150ms 防抖 + data URL 求值 + 内容去重，成功后经总线广播 `__nex:reload` 让前端自动刷新（见 [Exserver](06-exserver.md)）。

## 运行时配置自省与变更

除改文件外，还可通过 HTTP API 查看与临时变更配置（详见 [HTTP API](15-http-api.md)）：

```bash
curl http://localhost:3000/api/config                       # 脱敏后的生效配置
curl -X PATCH -H 'content-type: application/json' \
  -d '{"site.accent":"#123456"}' http://localhost:3000/api/config   # 需 apiWritable=true
```

- **`GET /api/config` 只读开放**：返回 `config`（当前生效配置）、`runtime`（模式 / 端口 / 安全摘要）、`note`。敏感键（`token` / `secret` / `password` / `apiKey` 等）的**值**替换为 `***`，函数字段被过滤。
- **`PATCH /api/config` 受 `apiWritable` 门控**（默认 403）：只接受 `site.title`、`site.description`、`site.accent`、`home.file` 四个白名单字段；含其它字段则整批 400，不会部分生效。
- 变更**只改内存、不写文件**（响应带 `persistent: false`），重启失效；`home.file` 下一次 `/` 请求即生效（主页路由实时读取配置）。
- 成功后广播 `config-changed` 事件。

## 配置热更新与自动刷新

- 扩展配置改动 → `server.conf.js` 热更新 → 广播 `__nex:reload`。
- dev 下 Vite watcher 也会在 `.ts/.tsx`/页面资源变更时广播 `__nex:reload`。
- 浏览器端 `NexBus` 收到 `__nex:reload` 后防抖刷新页面——所以 3000/3001、SSR 的 Markdown 页都能自动刷新。

## 注意

- `NavExt-*` 都是**目录名**（不是文件），且只是示例性命名，可任意改名。
- `ui/` 只是作者随手写的普通示例文件夹，`ui1/` 是其中一个示例，无特殊含义。
