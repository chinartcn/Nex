// 安全策略：由 Exserver 定义/扩展（核心仅保留不可关闭的兜底）
// 默认最小授权：fsWrite=false；具体放行由本策略显式声明。
export default {
  // 脚本仍锁 'self'（挡 XSS）；放开内联样式——Nex 的 Exjs UI 多基于 React，
  // 其 style={{}} 编译后即内联 style 属性，收紧会导致所有 UI 样式失效
  // （含 Markdown 渲染的标题着色）。data: 图片/字体为常见 UI 需求。
  csp: "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:",
  cors: { origins: ['*'], methods: ['GET', 'POST', 'OPTIONS'] },
  fsWrite: false,
  allowFsWrite: [], // 例如放开某扩展：['exserver:example-ext']
  blockedPaths: ['/admin'], // 演示路径拦截
};
