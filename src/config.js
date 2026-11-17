import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// 项目根目录：锚定到 Nex/（与运行 cwd 无关）
export const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

// 加载全局 .js 配置；改动后带时间戳热重载
// 运行模式由「启动命令」决定，优先级：CLI flag > 环境变量 > 配置文件 > prod 兜底。
//   npm run dev  -> node src/index.js --dev  (Vite HMR，消费 Exjs 的 TS/TSX 源码)
//   npm start    -> node src/index.js        (生产静态服务，消费 dist/ 构建产物)
// 这样配置文件里的 mode 只是默认值，不会再出现 start/dev 行为完全一样的情况。
export async function loadConfig() {
  const file = path.join(ROOT, 'nav-ext.config.js');
  let config = { mode: 'prod', server: { port: 3000 }, security: { fsWrite: false } };
  if (fs.existsSync(file)) {
    const mod = await import(pathToFileURLSafe(file) + `?t=${Date.now()}`);
    config = mod.default ?? mod;
  }

  const argvMode = process.argv.includes('--dev')
    ? 'dev'
    : process.argv.includes('--prod')
      ? 'prod'
      : null;
  const envMode = process.env.NEX_MODE === 'dev' || process.env.NEX_MODE === 'prod'
    ? process.env.NEX_MODE
    : null;
  const mode = argvMode || envMode || config.mode || 'prod';

  // 安全开关的环境变量覆盖：便于容器化部署与测试进程临时开启，
  // 不改动持久化的 nav-ext.config.js。仅 '1'/'true' 视为开启。
  const security = { ...(config.security || {}) };
  if (process.env.NEX_API_WRITABLE === '1' || process.env.NEX_API_WRITABLE === 'true')
    security.apiWritable = true;
  if (process.env.NEX_API_BROADCAST === '1' || process.env.NEX_API_BROADCAST === 'true')
    security.apiBroadcast = true;

  // 端口覆盖：便于并行启动多个实例（测试用）
  const server = { ...(config.server || {}) };
  if (process.env.NEX_PORT) server.port = Number(process.env.NEX_PORT);

  return { ...config, security, server, mode };
}

function pathToFileURLSafe(p) {
  return 'file://' + p;
}
