import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../config.js';

// 默认最小授权（决议 Q4）：写文件默认关，由 Exserver/security-policy 显式开启
const DEFAULT_POLICY = {
  fsWrite: false,
  cors: [],
  csp: "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:",
};

// 安全策略可经 Exserver 拓展/定义；核心不内置硬编码规则
export async function loadSecurityPolicy() {
  const file = path.join(ROOT, 'Exserver', 'security-policy', 'index.js');
  if (!fs.existsSync(file)) return DEFAULT_POLICY;
  const m = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
  const defined = m.default ?? m;
  return { ...DEFAULT_POLICY, ...defined };
}
