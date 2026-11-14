// 全局统一配置（.js 即配置）。摒弃旧版 .json 配置。
export default {
  mode: 'dev',                 // 'dev' | 'prod'
  server: { host: '0.0.0.0', port: 3000 },
  site: {
    title: 'Nex',
    description: 'NavExt 2.0',
    accent: '#4f6ef7',
  },
  // 主页由 sub.js / 此处显式指定，摒弃默认 index.html
  // 多主页路由（取代 1.x home.routes）：按 path / host / env 选择不同主页
  home: {
    enabled: true,
    file: 'page/a1/index.html', // 默认主页
    routes: [
      { path: '/preview/*', file: 'page/a2/index.html' }, // path 匹配
      { env: 'NEX_HOME_A2', file: 'page/a2/index.html' },  // 环境变量切换
      // { host: 'm.example.com', file: 'page/a2/index.html' }, // host 匹配
    ],
  },
  // 安全默认最小授权：写文件/FS 默认关，由 Exserver security-policy 显式开启。
  // 此处仅声明全局开关；具体 csp/cors/blockedPaths 由 Exserver/security-policy 定义。
  security: { fsWrite: false, apiWritable: false },
};
