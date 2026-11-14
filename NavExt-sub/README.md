# NavExt-sub

子页（sub-page）能力模块。

## 概念

统一页面目录 `page/`，摒弃旧版默认 `index.html` 主页。每个 `page/<id>/` 即一个子页，自动发现，**无需清单**。

```
page/
├── sub.js          # 可选：全局子页配置（home + pages 排序）
└── a1/             # 子页 a1
    ├── index.html  # 子页入口（显式，无隐式默认主页）
    ├── index.js
    ├── index.css
    ├── conf.js     # 元数据：{ title, description }
    └── sub.js      # 作用域：{ paths: ['/a1/*'] }
```

## 运行时

- `src/subpage.js`：`SubpageRegistry` 启动时扫描 `page/` 下所有含 `index.html` 的目录作为子页。
- `GET /api/pages`：返回已发现子页清单（id / title / paths / url）。
- Exserver 扩展可经 `mod.subpages = [{ id, title, paths, url }]` 贡献额外子页路由（由 `index.js` 合并进注册表）。

## 主页

主页由 `nav-ext.config.js` 的 `home.file` 或 `page/sub.js` 的 `home` **显式指定**；不再隐式使用 `index.html`。
