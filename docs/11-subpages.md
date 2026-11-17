# 11 — 子页与多主页路由

Nex 摒弃 1.x 的默认 `index.html` 主页，改用 `page/` 统一目录 + 显式主页声明（NavExt-sub 能力）。

## 子页发现

`src/subpage.js` 的 `SubpageRegistry.discover()` 扫描 `page/` 下的每个**含 `index.html` 的子目录**作为一个子页：

```
page/<id>/
├── index.html    # 必需，子页入口
├── index.js
├── index.css
├── conf.js       # { title, description, home? }
└── sub.js        # { paths: [...], home? }
```

子页条目：

| 字段 | 来源 |
| --- | --- |
| `id` | 目录名 |
| `title` / `description` | `conf.js` |
| `paths` | `sub.js` 的 `paths`，默认 `[ "/<id>/*" ]` |
| `url` | `/page/<id>/index.html` |
| `home` | `sub.js` 或 `conf.js` 的 `home === true` |

`GET /api/pages` 返回清单。Exserver 扩展还可通过 `mod.subpages = [{ id, title, paths, url }]` 贡献子页。

## 全局子页配置 `page/sub.js`

```js
export default {
  home: 'page/a1/index.html',   // 主页文件
  pages: ['a1', 'a2'],          // 排序
};
```

## 多主页路由

`src/home.js` 的 `resolveHome(req, config, subpages)` 决定 `/` 命中哪个主页，优先级：

1. `home.routes` 中按 `path` 匹配（支持 `*` 通配）
2. 按 `host` 匹配
3. 按 `env`（环境变量存在即命中）
4. `home.file`
5. 标记为 `home: true` 的子页
6. 兜底 `page/index.html`

`nav-ext.config.js` 示例：

```js
home: {
  enabled: true,
  file: 'page/a1/index.html',
  routes: [
    { path: '/preview/*', file: 'page/a2/index.html' },
    { env: 'NEX_HOME_A2', file: 'page/a2/index.html' },
  ],
},
```

因此：

- 访问 `/` → a1（默认主页）
- 访问 `/preview/*` → a2（path 路由）
- `NEX_HOME_A2=1 npm start` → `/` 命中 a2（env 路由）

命中 home 路由的 URL 也直接作为主页入口（由 `isHomeRoute` 判断）。`GET /api/home` 返回当前解析到的主页。

## 客户端路由器 `Nex.router`

`NavExt-sub/router.js` 提供客户端路由，经 `Nex.router` 暴露：

```js
Nex.router.list();            // 子页清单
Nex.router.current();         // 当前子页
Nex.router.on((page) => {});  // 订阅变化
Nex.router.go('a1');          // 导航
```

`go(id)` 的流程（**服务端权威解析**）：

```
客户端 → 总线 subpage:open {id}
       → 服务端 src/index.js 用 subpages.get(id) 解析出 url
       → 回 subpage:open:ok { id, url }
       → 客户端据此导航
```

- 服务端可改写 url / 做鉴权后再返回，客户端不自作主张。
- 1s 内没收到 `subpage:open:ok`，客户端用 `/page/<id>/index.html` 本地兜底。
- 子页清单由 example-ext 在 `onReady` 时经 `subpage:list` 广播给客户端缓存。

## 页面 URL 说明

- 子页资源用**绝对路径**（`/page/a1/index.js`），因为主页可能被多个 URL（`/`、`/preview/*`）命中，相对路径会解析到错误位置。
- `/page/<id>/` 目录形式会自动补 `index.html`（标准静态服务语义）。
- prod 下页面来自 `dist/page/`，dev 下来自源 `page/`。
