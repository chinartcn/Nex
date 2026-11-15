'use strict';

/**
 * Exserver：Markdown 渲染（移植自 NavExt 1.x 示例 ex3-markdown-render）
 *
 * 演示三件事（Nex 2.0 写法）：
 *   1. 用 server.conf.js 声明配置项，运行时经 ctx.config 读取；
 *   2. 用 onRequest 钩子拦截一类 URL（这里是 *.md），自己读文件生成响应；
 *   3. 安全：转义用户内容 + 限制体积，避免 XSS 与内存膨胀；路径经 isPathSafe 兜底。
 *
 * 着色采用「双保险」：内联 style（配置色）+ 外部样式表的
 * var(--accent-heading, 默认色)。这样即使浏览器缓存了旧 CSP 响应、
 * 或内联样式被策略拦截，标题仍是品牌色，不会退回深色正文色（表现为「变黑」）。
 *
 * 真项目里请用 markdown-it / marked；这里手写一份，保持「零依赖」的示例性质。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../src/config.js';
import { isPathSafe } from '../../src/security/core.js';

const DEFAULT_ACCENT = '#4f6ef7';

/* ── 配置颜色校验 ──
 * 只允许合法 CSS 颜色。若配置写成 undefined / 空串 / 含分号的注入串，
 * 直接拼进 style 会得到无效颜色（浏览器忽略 → 标题退回深色正文色，
 * 看起来就是「颜色丢失」）。这里统一兜底为默认品牌色。 */
function safeColor(v) {
  if (typeof v !== 'string') return DEFAULT_ACCENT;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;                        // #rgb / #rrggbb / #rrggbbaa
  if (/^(rgb|rgba|hsl|hsla)\(\s*[\d.%\s,/+-]+\s*\)$/i.test(s)) return s;
  if (/^[a-zA-Z]{3,20}$/.test(s)) return s;                            // 命名色 / transparent / currentColor
  return DEFAULT_ACCENT;
}

/* ── 极简 Markdown → HTML ── */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, href) {
      // 只允许 http/https/相对路径，挡掉 javascript: 伪协议
      if (!/^(https?:|\/|\.\/|#)/i.test(href)) return esc(text);
      return '<a href="' + esc(href) + '">' + esc(text) + '</a>';
    });
}

function mdToHtml(md, accent) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      closeList();
      out.push(inCode ? '</pre>' : '<pre>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(esc(line));
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const lv = h[1].length;
      out.push('<h' + lv + ' style="color:' + accent + '">' + inline(h[2]) + '</h' + lv + '>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push('<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>');
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    out.push('<p>' + inline(line) + '</p>');
  }
  closeList();
  if (inCode) out.push('</pre>');
  return out.join('\n');
}

/* ── onRequest：拦截 .md 请求（显式 Exserver 请求钩子）── */
export function onRequest(req, url, ctx) {
  if (!/\.md$/i.test(url.pathname)) return undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') return undefined;

  const cfg = ctx.config || {};
  const maxBytes = cfg.maxBytes || 262144;
  const accent = safeColor(cfg.accentHeading || DEFAULT_ACCENT);

  // URL 路径 → 站点相对路径，isPathSafe 做穿越兜底
  const rel = url.pathname;
  if (!isPathSafe(rel, ROOT)) return undefined;
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return undefined;

  const size = fs.statSync(fp).size;
  if (size > maxBytes) {
    return {
      status: 413,
      type: 'text/plain; charset=utf-8',
      body: '文件过大（' + size + ' 字节），超过 maxBytes=' + maxBytes,
    };
  }

  const md = fs.readFileSync(fp, 'utf8');
  const title = path.basename(fp);
  const body =
    '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title>' +
    '<link rel="stylesheet" href="/_navext/exserver/markdown-render/styles.css">' +
    // 配置色同步写成 CSS 变量：外部样式表用 var(--accent-heading, 默认色) 着色。
    // 即便这段内联 <style> 或每个 h 标签的 style 属性被 CSP 拦截（如浏览器
    // 缓存了放宽前的旧 CSP 响应），标题仍由外部 CSS 兜底为品牌色，不会变黑。
    '<style>.nx-md{--accent-heading:' + accent + '}</style>' +
    '</head><body class="nx-md"><article>' +
    mdToHtml(md, accent) +
    '</article></body></html>';

  return { status: 200, type: 'text/html; charset=utf-8', body };
}

export function onReady(ctx) {
  ctx.log('info', 'Markdown 渲染器就绪；标题色=', ctx.config.accentHeading);
}
