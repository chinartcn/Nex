# 18 — 常见问题

## 运行模式

**Q：`npm start` 和 `npm run dev` 到底有什么区别？**
A：`start` 只跑生产静态服务 :3000，消费 `dist/`，启动前自动构建；`dev` 跑主服务 :3000 + Vite :3001，直接消费 `.ts/.tsx` 源码并带 HMR。开发请打开 :3001。模式由启动命令决定，不靠改配置文件（见 [配置](03-configuration.md)）。

**Q：我改了 `nav-ext.config.js` 的 `mode` 为什么没切换模式？**
A：因为 CLI flag 优先于配置文件。`npm run dev` 带 `--dev`，`npm start` 走配置默认（prod）。要强制可用 `NEX_MODE=dev`。

## 颜色 / 缓存

**Q：改了标题颜色配置，页面颜色没变？**
A：多半是浏览器缓存了旧响应/旧 CSP。Nex 对所有响应加 `Cache-Control: no-store`，正常情况下改 `server.conf.js` 的 `accentHeading` 会热更新并广播 `__nex:reload` 自动刷新。若仍不变，硬刷新一次，并确认 CSP 的 `style-src` 含 `unsafe-inline`、颜色值合法（否则兜底为 `#4f6ef7`）。

**Q：为什么 Markdown 标题是黑色？**
A：历史原因是 CSP 拦截内联样式 + 旧响应缓存。现已用「内联 style + CSS 变量 `--accent-heading`」双保险，且策略放开内联样式、`no-store` 禁缓存。若复现，检查响应头与 `Exserver/markdown-render/server.conf.js`。

## 热更新

**Q：改了后端配置，前端提示要刷新，页面没自动动？**
A：dev 下 Vite watcher 与 Exserver 配置热更新都会广播 `__nex:reload`，浏览器收到后自动刷新。确认总线连接正常（控制台无 WS 报错）；`server.conf.js` 有 150ms 防抖，稍等即可。

**Q：为什么 3001 访问 `/README.md` 是原样文本？**
A：Vite 默认把 `.md` 当静态文件。`nex-md-proxy` 插件已把所有 `.md` 转发回主服务渲染。若失效，重启 dev 服务。

**Q：热更新报 `Cannot find module ... server.conf.js`？**
A：这是编辑器「原子保存」（先删后写）导致的路径解析竞态。已改为监听目录 + 防抖 + data URL 求值 + ENOENT 重试，正常不会复现。

## 请求 / 端点

**Q：为什么 `/page/a1/` 之前 404？**
A：目录形式未补 `index.html`。已在 `src/server.js` 修复，目录会自动补 `index.html`，与 `/page/a1/index.html` 一致。

**Q：`/api/exjs` 在 dev 直连 3000 返回空清单？**
A：正确设计。直连 3000 无 Vite 转译 `.ts`，返回空清单避免报错；经 3001 代理（带 `x-nex-via-vite`）才会下发 dev 源码清单与白名单。

**Q：启动时提示 `dist/Exjs 不存在`？**
A：说明没构建。执行 `npm run build`，或用 `npm start`（会自动构建）。产物目录是大写 `Exjs`。

## 测试

**Q：测试里偶发 `Failed to fetch`？**
A：多为测试环境同一浏览器多 tab 快速切换的竞态，非产品 bug。测试套件已改为每个 URL 独立浏览器进程规避；单独访问页面应 0 console error。

**Q：全量测试需要装什么？**
A：Node 内置能力即可跑 HTTP/WS/安全测试；浏览器 console 检查需要系统 `chromium`。详见 [测试](16-testing.md)。

## 概念澄清

**Q：`NavExt-*` 是文件吗？`ui/` 是内置吗？**
A：`NavExt-TS/React/esbuild/vite/sub` 都是**目录名**，只是示例性命名，可任意改名。`ui/` 只是作者随手写的普通示例文件夹，`ui1/` 是其中一个示例，无特殊含义。

**Q：产物目录为什么是大写 `Exjs`？**
A：对应源码目录 `Exjs/`。历史上曾用小写 `dist/exjs`，相关引用已全部统一；`build.mjs` 仍清理旧小写目录防混淆。

**Q：client 为什么不直接调 `/api/*`？**
A：2.0 架构要求前后端经 `@NavExt-ws` 总线解耦；`/api/*` 仅保留控制面（扩展清单、安全、日志、标准格式演示等）。见 [总线](08-bus.md) 与 [HTTP API](15-http-api.md)。
