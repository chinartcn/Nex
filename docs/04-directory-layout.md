# 04 — 目录结构

采用**扁平顶层布局（布局 A）**。`NavExt-*` 均为目录名（非文件），仅示例性命名，可任意改名。

```
Nex/
├── src/                       引擎核心（多文件，取代旧单 server.js）
│   ├── index.js                入口：加载配置→发现→组装→启动
│   ├── config.js               配置加载 / 模式决议 / ROOT
│   ├── discover.js             自动扫描 Exserver/ 与 Exjs/
│   ├── registry.js             内存插件注册表（list/toggle/get）
│   ├── server.js               HTTP 服务：静态 + API + 请求钩子 + 总线挂载
│   ├── home.js                 多主页路由 resolveHome
│   ├── subpage.js              子页自动发现 SubpageRegistry
│   ├── log.js                  日志汇聚 LogHub
│   ├── bus/                    @NavExt-ws 全双工总线（ws.js/index.js/client.js）
│   ├── exserver/               服务端扩展运行时（含 server.conf.js 热更新）
│   ├── exjs/                   客户端扩展运行时（bootstrap 注入）
│   ├── security/               基础兜底 + 安全策略运行时
│   ├── client/                 window.Nex 客户端 API 源码
│   ├── web/                    请求体解析（body.js：标准 Web 格式）
│   └── dev/                    Vite 热更新接入（vite.js）
│
├── Exserver/                   服务端扩展目录（自动发现）
│   ├── example-ext/            示例服务端扩展（mod.js/index.js/server.conf.js/sub.js）
│   ├── markdown-render/        Markdown 渲染示例（onRequest 拦截 *.md）
│   └── security-policy/        安全策略定义（index.js，单独加载非扩展）
│
├── Exjs/                       客户端扩展目录（自动发现，TS/React，经打包器）
│   └── example-ext/            index.ts / panel.tsx / styles.css / conf.js
│
├── page/                       统一页面目录（无默认 index.html 主页）
│   ├── sub.js                  全局子页配置（home + pages 排序）
│   ├── a1/                     子页 a1（index.html/js/css + conf.js + sub.js + server.conf.js）
│   ├── a2/                     子页 a2
│   └── docs/hello.md           内容页示例（由 Markdown 渲染器处理）
│
├── NavExt-esbuild/             生产打包：依赖分析 + 分组 bundle（deps.mjs/build.mjs/analyze.mjs）
├── NavExt-vite/                Vite 开发热更新说明
├── NavExt-TS/                  TS 插件 SDK 说明
├── NavExt-React/               React UI 插件说明
├── NavExt-sub/                 子页能力：客户端路由器 router.js
│
├── ui/ui1/                     普通示例文件夹（作者随手取名，非内置概念）
├── test/                       全量测试套件（harness.mjs / run.mjs）
├── docs/                       本文档中心
├── nav-ext.config.js           全局配置
├── package.json                脚本与依赖
└── dist/                       构建产物（gitignore；prod 消费）
    ├── Exjs/                   分组后的浏览器 ESM（含大写 E）
    ├── page/<id>/              重写后的页面 HTML + 资源
    ├── manifest.json           page→bundles / bundle→exjs 映射
    └── build-report.json       依赖分析与分组报告
```

## 关键目录职责

| 目录 | 职责 | 详见 |
| --- | --- | --- |
| `src/` | 引擎运行时（零依赖） | [架构与运行机制](05-architecture.md) |
| `Exserver/` | 服务端扩展 + 安全策略 | [Exserver](06-exserver.md) / [安全](10-security.md) |
| `Exjs/` | 客户端扩展（TS/React） | [Exjs](07-exjs.md) |
| `page/` | 子页与内容页 | [子页与路由](11-subpages.md) |
| `NavExt-esbuild/` | 生产构建 | [构建](13-build.md) |
| `NavExt-sub/` | 客户端路由器 | [子页与路由](11-subpages.md) |
| `test/` | 全量测试 | [测试](16-testing.md) |
| `docs/` | 文档中心 | 本目录 |

## 关于命名的说明

- `NavExt-TS` / `NavExt-React` / `NavExt-esbuild` / `NavExt-vite` / `NavExt-sub` 是**目录名**，示例性命名，实际项目可任意改名。
- `ui/` 只是作者随手创建的一个普通示例文件夹，`ui1/` 是其中一个示例子目录，**不是内置或特殊概念**。
- 产物目录是 `dist/Exjs/`（大写 E），与源码目录 `Exjs/` 对应；注意历史上曾有小写 `dist/exjs` 的遗留引用，已统一。
