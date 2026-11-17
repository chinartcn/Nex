# 12 — 标准 Web 格式

Nex 采用**原生标准 Web 格式**做数据交换，不引入私有 RPC 协议（决议：弃用 JSON-RPC）。

## 格式与用途

| 数据形态 | 标准格式 | 场景 |
| --- | --- | --- |
| 键值 / 查询式 | `URLSearchParams` | 简单参数、表单 POST、总线键值载荷 |
| 含文件 / 多部分 | `FormData` | 上传、多字段表单 |
| 流式 | `ReadableStream` / Standard Web Streams | 分片传输、大响应 |
| 二进制 | `Blob` / `ArrayBuffer` / `Uint8Array` | 文件内容 |

## 客户端构造

```js
const p = Nex.params({ a: 1, b: 2 });    // URLSearchParams
const f = Nex.form({ name: 'nex' });     // FormData
```

总线侧：

```js
Nex.bus.sendParams('kv', { a: 1 });      // {format:'urlsearchparams', body:'a=1'}
Nex.bus.sendForm('upload', f);           // {format:'formdata', body:[[k,v],...]}
```

## 服务端解析

`src/web/body.js` 提供最小化解析（零依赖）：

| 函数 | 用途 |
| --- | --- |
| `contentType(req)` | 取 `content-type`（去掉参数、转小写） |
| `readRaw(req)` | 读完整请求体为 Buffer |
| `parseUrlEncoded(buf)` | → `URLSearchParams` 条目数组 |
| `parseJson(buf)` | → 对象 |
| `parseMultipart(buf, boundary)` | → `[{ name, filename?, contentType?, data }]` |
| `multipartBoundary(header)` | 从 content-type 提取 boundary |

`src/bus/index.js` 提供 `packParams` / `unpackParams` 做总线载荷的标准格式封装/还原。

## HTTP 端点示例

### `/api/form`（POST）

支持三种 content-type：

```bash
# JSON
curl -H 'content-type: application/json' -d '{"a":1}' http://localhost:3000/api/form

# URLSearchParams
curl -d 'x=10&y=hi' http://localhost:3000/api/form

# FormData / multipart
curl -F user=nex -F 'file=@a.txt' http://localhost:3000/api/form
```

响应统一为 `{ ok, contentType, fields:[{ name, value, filename?, contentType? }] }`。不支持的类型返回 415。

### `/api/stream`（GET）

Standard Web Streams 出站分片：

```bash
curl "http://localhost:3000/api/stream?n=4&delay=50"
# 依次返回 chunk 1/4 ... chunk 4/4
```

参数 `n`（1–20，默认 5）、`delay`（ms，默认 100）。服务端用 `ReadableStream` + `Readable.fromWeb().pipe(res)` 实现。

## 总线流 `stream:data`

`Nex.stream.send(name, source)` 逐片发送信封：

```json
{ "type":"stream:data", "scope":"global",
  "payload": { "format":"stream", "name":"logs", "seq":0, "chunk":"...", "done":false } }
```

- 总线内置中继：首次收到打 `_relayed` 并广播给所有连接（含回环）。
- 订阅用 `Nex.stream.read(name, cb)`；回调收到 `(chunk, { seq, done })`。
- 二进制分片编码为逗号分隔字节串（见 [客户端 API](09-client-api.md#流收发-nexstream)）。

## 设计收益

- 与浏览器原生 API 一致，学习成本低。
- 文件、流式天然支持，无需自定义二进制协议。
- 便于测试：直接用 `fetch` / `FormData` / `ReadableStream` 即可验证。
