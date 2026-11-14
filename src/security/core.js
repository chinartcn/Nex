import path from 'node:path';

// 基础兜底安全：路径穿越防护（不可关闭，核心始终生效）
export function isPathSafe(target, root) {
  const resolved = path.resolve(root, '.' + path.sep + target);
  return resolved.startsWith(path.resolve(root));
}
