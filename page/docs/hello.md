# NavExt 2.0 Markdown 渲染示例

这是 **Nex** 引擎的 Markdown 渲染演示，由 `Exserver/markdown-render` 扩展通过显式
请求拦截钩子 `onRequest` 提供服务端渲染。

## 功能清单

- 拦截所有 `*.md` 请求
- 零依赖的极简 Markdown → HTML 转换器
- 标题颜色、最大字节数等可经 `server.conf.js` 配置
- 转义用户输入，挡掉 `javascript:` 伪协议

## 代码示例

```js
export function onRequest(req, url, ctx) {
  if (!/\.md$/i.test(url.pathname)) return undefined;
  // ...读取并渲染
}
```

行内代码如 `const x = 1` 与 *斜体* 也受支持。

## 链接

访问 [Nex 仓库](https://github.com/chinartcn/Nex) 了解更多。

> 提示：本页由服务端渲染，不经过任何外部 Markdown 库。
