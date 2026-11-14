// 最小化请求体解析：支持标准 Web 格式
//   - application/x-www-form-urlencoded → URLSearchParams
//   - application/json                   → JSON
//   - multipart/form-data               → 解析为字段数组（含可选文件）
// 仅实现解析所需子集，不引入外部依赖。

export function contentType(req) {
  return (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}

export function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export function parseUrlEncoded(buf) {
  return Array.from(new URLSearchParams(buf.toString('utf8')).entries());
}

export function parseJson(buf) {
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

// 解析 multipart/form-data，返回 [{ name, filename?, contentType?, data: Buffer }]
export function parseMultipart(buf, boundary) {
  if (!boundary) return [];
  const delim = Buffer.from('--' + boundary);
  const parts = [];
  let start = buf.indexOf(delim);
  if (start < 0) return parts;
  start += delim.length;
  while (start < buf.length) {
    // 结束边界：--boundary--
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    // 跳过 \r\n
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    const next = buf.indexOf(delim, start);
    if (next < 0) break;
    let seg = buf.slice(start, next);
    // 去掉段尾 \r\n
    if (seg[seg.length - 2] === 0x0d && seg[seg.length - 1] === 0x0a) seg = seg.slice(0, -2);
    const headerEnd = seg.indexOf('\r\n\r\n');
    if (headerEnd < 0) { start = next + delim.length; continue; }
    const header = seg.slice(0, headerEnd).toString('utf8');
    const body = seg.slice(headerEnd + 4);
    const nameM = header.match(/name="([^"]*)"/i);
    const fileM = header.match(/filename="([^"]*)"/i);
    const ctM = header.match(/Content-Type:\s*([^\r\n]+)/i);
    parts.push({
      name: nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : undefined,
      contentType: ctM ? ctM[1].trim() : undefined,
      data: body,
    });
    start = next + delim.length;
  }
  return parts;
}

export function multipartBoundary(contentTypeHeader) {
  const m = (contentTypeHeader || '').match(/boundary=("?)([^";]+)\1/i);
  return m ? m[2] : null;
}
