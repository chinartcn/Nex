# NavExt-vite

开发态热更新目录（依赖 Vite）。

- 提供 HMR，直接消费 `.ts` / `.tsx` 源码，无需手动重启（取代 1.x mtime 轮询热重载）。
- 由 `nav-ext.config.js` 的 `mode: 'dev'` 触发（`src/dev/vite.js` 接入）。
