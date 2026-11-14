// 安全策略：由 Exserver 定义/扩展（核心仅保留不可关闭的兜底）
// 默认最小授权：fsWrite=false；具体放行由本策略显式声明。
export default {
  csp: "default-src 'self'",
  cors: { origins: ['*'], methods: ['GET', 'POST', 'OPTIONS'] },
  fsWrite: false,
  allowFsWrite: [], // 例如放开某扩展：['exserver:example-ext']
  blockedPaths: ['/admin'], // 演示路径拦截
};
