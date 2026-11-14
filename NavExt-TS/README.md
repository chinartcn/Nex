# NavExt-TS

TypeScript 插件 SDK / 示例目录。

- 所有 **Exjs**（客户端扩展）用 TS 编写，必要时配合 `NavExt-React` 用 `.tsx` 写 UI。
- **TS 与 Exjs 统一走打包器**（决议 Q3）：开发态由 `NavExt-vite` 提供 HMR，生产态由 `NavExt-esbuild` 打包。
- 提供 `NexBus` 全局类型声明（全双工总线 `@NavExt-ws` 客户端句柄）。
