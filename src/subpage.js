import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './config.js';

// 子页运行时（NavExt-sub）：自动发现 page/<id>/ 为子页，无需清单。
// 每个子页可带 conf.js（元数据：title/description）与 sub.js（作用域 paths）。
// Exserver 扩展也可经 mod.subpages 贡献子页路由。
const PAGE_DIR = path.join(ROOT, 'page');

async function loadJs(dir, file) {
  const fp = path.join(dir, file);
  if (!fs.existsSync(fp)) return null;
  const m = await import(pathToFileURL(fp).href + `?t=${Date.now()}`);
  return m.default ?? m;
}

export class SubpageRegistry {
  constructor() {
    this.pages = [];
  }

  async discover() {
    this.pages = [];
    if (!fs.existsSync(PAGE_DIR)) return this.pages;

    for (const entry of fs.readdirSync(PAGE_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const dir = path.join(PAGE_DIR, id);
      if (!fs.existsSync(path.join(dir, 'index.html'))) continue;

      const conf = (await loadJs(dir, 'conf.js')) || {};
      const sub = (await loadJs(dir, 'sub.js')) || {};
      this.pages.push({
        id,
        title: conf.title || id,
        description: conf.description || '',
        paths: Array.isArray(sub.paths) ? sub.paths : [`/${id}/*`],
        url: `/page/${id}/index.html`,
        home: sub.home === true || conf.home === true, // sub.js/conf.js 可声明本页为主页
      });
    }

    // 可选：page/sub.js 中的 pages 顺序优先排序
    const g = await loadJs(PAGE_DIR, 'sub.js');
    if (g && Array.isArray(g.pages)) {
      const order = g.pages;
      this.pages.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
    return this.pages;
  }

  // 扩展贡献的子页（Exserver mod.subpages = [{ id, title, paths, url }]）
  addExtensionPages(loaded) {
    for (const e of loaded || []) {
      const sp = e.mod?.subpages;
      if (Array.isArray(sp)) {
        for (const pg of sp) this.pages.push({ ...pg, from: e.id });
      }
    }
    return this.pages;
  }

  list() {
    return this.pages;
  }

  get(id) {
    return this.pages.find((p) => p.id === id);
  }
}
