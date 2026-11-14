// NavExt-vite —— 基于 Vite 的开发态热更新（Phase 4）
// 集成方式见 src/dev/vite.js：在 mode:dev 时由主程序以 createServer({ root: Nex/ })
// 启动一个独立 dev server（默认 3001），直接消费 .ts/.tsx 源码并提供 HMR，
// 再把 Nex 专属端点代理回主服务（3000）。
//
// 本文件可用于独立启动（npx vite）：`npx vite --config NavExt-vite/vite.config.ts`
// 注意：独立使用时需先启动主服务（node src/index.js）于 3000，否则代理目标不可达。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

export default defineConfig({
  root: ROOT,
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://localhost:3000',
      '/@NavExt-ws': { target: 'ws://localhost:3000', ws: true },
      '/_navext': 'http://localhost:3000',
      '/dist': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist/exjs',
    lib: { entry: 'Exjs/example-ext/index.ts', formats: ['es'], fileName: 'example-ext' },
  },
});
