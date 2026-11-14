// 服务端扩展配置（.js 即配置）
export default {
  enabled: true,
  options: {},
  // 渲染配置（onRequest 经 ctx.config 读取）
  accentHeading: '#4f6ef7', // 标题颜色
  maxBytes: 262144, // 超过该大小的 .md 不渲染，直接提示过大（防大文件卡住页面）
};
