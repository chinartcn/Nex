# 07 — Exjs 客户端扩展

Exjs 是浏览器端扩展，用 TypeScript 编写，UI 部分可用 React。目录位于 `Exjs/<name>/`，自动发现，经打包器处理。

## 目录结构

```
Exjs/example-ext/
├── conf.js       # { enabled: true }；enabled:false 禁用
├── index.ts      # 客户端逻辑入口（也支持 index.tsx / index.js / client.js）
├── panel.tsx     # React 组件（可选）
└── styles.css    # 样式（可选）
```

入口文件按优先级识别：`index.ts` → `index.tsx` → `index.js` → `client.js`（见 `NavExt-esbuild/deps.mjs` 的 `ENTRY_FILES`）。

## 编写扩展

一个典型 Exjs 通过全局 `NexBus` 与服务端通信，并把 UI 挂到页面的 `#exjs-panel` 挂载点：

```ts
// Exjs/example-ext/index.ts
NexBus.on('server-pong', (payload) => {
  console.log('pong', payload);
});
NexBus.send('client-ping', { hello: 'exjs' }, 'global');

// 挂载 React 面板（见 NavExt-React）
mountPanel(document.querySelector('#exjs-panel'));
```

> Exjs **不直接访问服务端 `/api/*`**；一切通信走总线（见 [总线](08-bus.md)）。

## 白名单：声明式加载

页面通过 `page/<id>/conf.js` 的 `exjs` 数组声明本页要加载哪些 Exjs：

```js
export default {
  title: 'A1',
  exjs: ['example-ext'],   // 目录名或 'exjs:example-ext'
};
```

- 这是**白名单**：只加载声明的扩展；不声明 = 不加载任何 Exjs。
- 与 1.x 的 `jsx.json` 黑名单机制相反（见 [迁移](17-migration.md)）。
- 白名单同时被 dev 引导（动态 import 裁剪）与 prod 构建（依赖图）消费。

## 加载时机

### 开发模式（:3001）

- 启动脚本 `/_navext/bootstrap.js` 在总线就绪后运行。
- 请求 `/api/exjs` 拿到 dev 源码清单与各页白名单（经 Vite 代理时 `viaVite=true`）。
- 按当前页白名单**只 import 声明的扩展**源码（由 Vite 处理 `.ts/.tsx`）。
- 按需注入 React Refresh preamble。

> 直连 :3000 时 `/api/exjs` 返回空清单（`viaVite=false`），避免加载未经转译的 `.ts` 报错——开发请用 :3001。

### 生产模式（:3000）

- 构建期按白名单分析依赖、分组 bundle，并重写各页 `index.html`，注入 `<script type="module" src="/Exjs/<bundle>.js">`。
- bootstrap 检测到 bundle script 后**不再动态 import**，设置 `window.__NEX_BOOT_MODE__ = 'bundled'`（或白名单为空时 `'none'`）。
- 详见 [构建与依赖分析](13-build.md)。

## 挂载点

Exjs 的 UI 需要页面提供挂载点：`#exjs-panel` 或 `[data-nex-exjs]`。bootstrap 找不到挂载点会直接跳过（纯内容页如 SSR Markdown 不受影响）。

页面 `page/a1/index.html` 含：

```html
<div id="exjs-panel"></div>
```

## 与 TS / React SDK 的关系

- `NavExt-TS/`：TS 插件 SDK（`NexBus` 类型声明、`defineExjs` 等约定）。
- `NavExt-React/`：`mountPanel` 等 React 面板挂载辅助。
- 二者都是**约定/示例目录**，实际类型与工具以打包器解析结果为准。

## 热更新

dev 下修改 `Exjs/**/*.ts(x)` 会触发 Vite HMR；页面资源/后端配置变更经 `__nex:reload` 广播自动刷新。详见 [开发热更新](14-dev-hmr.md)。
