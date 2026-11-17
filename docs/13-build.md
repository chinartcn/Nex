# 13 — 构建与依赖分析

生产构建由 `NavExt-esbuild/` 完成，核心是**两阶段**：先只读分析依赖并出报告，再按分组计划打包、重写 HTML、复制资源。目标是减少浏览器请求数。

## 命令

```bash
npm run analyze                              # 只分析，输出 dist/build-report.json（不构建）
npm run build                                # 完整构建
node NavExt-esbuild/analyze.mjs --selftest   # 验证分组算法（虚拟数据自检）
```

`npm start` 会通过 `prestart` 自动执行一次 `npm run build`。

## 阶段一：依赖分析（`deps.mjs`）

声明来源是页面 `conf.js` 的 `exjs` **白名单**：

```js
exjs: ['example-ext'];            // 目录名
exjs: ['exjs:example-ext'];       // 完整 id（兼容写法）
```

`deps.mjs` 的纯函数：

| 函数 | 作用 |
| --- | --- |
| `normalizeId(raw)` | 去掉 `exjs:` 前缀 |
| `collectPageDeclarations()` | 扫描所有子页白名单 |
| `collectAvailableExjs()` | 收集可用 Exjs 及入口、built 状态 |
| `validate(pages, exts)` | 校验白名单引用了不存在的扩展 |
| `maximalItemsets(sets, minSupport)` | 求极大项集（支持度 = 依赖它的页面数） |
| `planBundles(pages, maximal)` | 生成分组计划 |
| `buildManifest(...)` | 构造 manifest |
| `analyze({minSupport})` | 汇总以上 |

报告写到 `dist/build-report.json`，控制台打印页面→白名单、频繁/极大项集、bundle 计划与请求数对比。

## 阶段二：分组打包（`build.mjs`）

按分组计划用 esbuild 产出：

- `dist/Exjs/<bundle>.js` —— 分组后的浏览器 ESM（自包含，组内公共依赖只打一份）。
  - 单页独有多个扩展 → 合并为一个 bundle。
  - 多页共有的扩展集合 → `group-<ext1>-<ext2>.js` 共享 bundle。
- `dist/page/<id>/index.html` —— 重写：注入该页 bundle 的 `<script type="module" src="/Exjs/<bundle>.js">`。
- `dist/page/<id>/<自有资源>` —— 复制 index.css / index.js 等（页面目录里的 `conf.js`/`sub.js`/`server.conf.js` 不下发）。
- `dist/manifest.json` —— `page → bundles`、`bundle → exjs` 映射。
- `dist/build-report.json` —— 与分析报告一致的时间戳。

esbuild 用 `stdin` 汇总入口 import 组内所有扩展入口，bundle 成单文件；产物为 ESM，含 React。

## 产物目录注意

- 产物是 **`dist/Exjs/`（大写 E）**，对应源码 `Exjs/`。
- `/Exjs/<bundle>.js` 静态路由由 `src/server.js` 提供。
- 历史遗留的小写 `dist/exjs` 引用已全部修正；`build.mjs` 仍会清理旧的小写目录以防混淆。

## manifest 示例

```json
{
  "pages": {
    "a1": { "html": "page/a1/index.html", "exjs": ["example-ext"], "bundles": ["example-ext"] },
    "a2": { "html": "page/a2/index.html", "exjs": [], "bundles": [] }
  },
  "bundles": {
    "example-ext": {
      "name": "example-ext", "file": "Exjs/example-ext.js",
      "exjs": ["example-ext"], "shared": false, "pages": ["a1"]
    }
  }
}
```

## 减少请求数的原理

1. 每个页面的白名单决定它依赖哪些 Exjs。
2. 依赖集合在多个页面共现 → 提取极大项集 → 合成共享 bundle。
3. 单页内多个扩展合并成一个 bundle。
4. HTML 只引用本页需要的 bundle，浏览器请求数从「逐扩展 N 个」降到「分组后 M 个」。

`npm run analyze` 的输出末尾会打印 `请求数: 逐扩展 X -> 分组后 Y（省 Z）`。

## 生产运行时配合

- `GET /api/manifest` 下发构建 manifest。
- `GET /api/exjs` 的 `built` 标志与 `base` 指向 `dist/Exjs`（已修正大小写）。
- bootstrap 检测到 bundle script 后不重复动态 import（见 [Exjs](07-exjs.md)）。
