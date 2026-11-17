// NavExt-esbuild 依赖分析核心（纯函数，无副作用，构建阶段复用）
// 声明来源：page/<id>/conf.js 的 exjs 白名单数组（原版 jsx.json 是黑名单，这里反过来）。
//   exjs: ['example-ext']        目录名
//   exjs: ['exjs:example-ext']   完整 id（兼容写法）
// 没声明 exjs = 该页面不加载任何 Exjs（白名单默认拒绝）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
export const PAGE_DIR = path.join(ROOT, 'page');
export const EXJS_DIR = path.join(ROOT, 'Exjs');
const ENTRY_FILES = ['index.ts', 'index.tsx', 'index.js', 'client.js'];

async function loadJs(fp) {
  if (!fs.existsSync(fp)) return null;
  const mod = await import(pathToFileURL(fp).href + `?t=${Date.now()}`);
  return mod.default ?? mod;
}

export function normalizeId(raw) {
  const s = String(raw || '').trim();
  return s.startsWith('exjs:') ? s.slice(5) : s;
}

// 扫描所有子页的白名单声明；全局默认（nav-ext.config.js.exjs）由调用方合并。
export async function collectPageDeclarations() {
  const pages = [];
  if (!fs.existsSync(PAGE_DIR)) return pages;
  for (const ent of fs.readdirSync(PAGE_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(PAGE_DIR, ent.name);
    if (!fs.existsSync(path.join(dir, 'index.html'))) continue;
    const conf = (await loadJs(path.join(dir, 'conf.js'))) || {};
    const raw = Array.isArray(conf.exjs) ? conf.exjs : [];
    pages.push({
      id: ent.name,
      html: `page/${ent.name}/index.html`,
      title: conf.title || ent.name,
      exjs: [...new Set(raw.map(normalizeId).filter(Boolean))],
      declaredRaw: raw,
    });
  }
  pages.sort((a, b) => a.id.localeCompare(b.id));
  return pages;
}

// 扫描 Exjs 目录下可用扩展（id = 目录名），带 enabled / 入口 / 是否已构建信息。
export async function collectAvailableExjs() {
  const exts = [];
  if (!fs.existsSync(EXJS_DIR)) return exts;
  for (const ent of fs.readdirSync(EXJS_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(EXJS_DIR, ent.name);
    const conf = (await loadJs(path.join(dir, 'conf.js'))) || {};
    const entry = ENTRY_FILES.find((f) => fs.existsSync(path.join(dir, f))) || null;
    exts.push({
      id: ent.name,
      dir: `Exjs/${ent.name}`,
      enabled: conf.enabled !== false,
      entry,
      built: fs.existsSync(path.join(ROOT, 'dist', 'Exjs', ent.name + '.js')),
    });
  }
  exts.sort((a, b) => a.id.localeCompare(b.id));
  return exts;
}

// 校验白名单：不存在的扩展、已禁用、缺入口。
export function validate(pages, exts) {
  const byId = new Map(exts.map((e) => [e.id, e]));
  const issues = [];
  for (const p of pages) {
    for (const id of p.exjs) {
      const e = byId.get(id);
      if (!e) issues.push({ level: 'error', page: p.id, id, msg: '扩展不存在' });
      else if (!e.enabled) issues.push({ level: 'warn', page: p.id, id, msg: '扩展已禁用' });
      else if (!e.entry) issues.push({ level: 'warn', page: p.id, id, msg: '缺少构建入口' });
    }
  }
  return issues;
}

// 枚举频繁项集并取极大项集（不被其他频繁项集真包含）。
// 扩展数量通常很少；>16 时跳过子集枚举，避免 2^n 爆炸（报告会注明）。
export function maximalItemsets(sets, minSupport = 2) {
  const counts = new Map();
  const skipped = [];
  for (const s of sets) {
    const arr = [...new Set(s)].sort();
    if (arr.length > 16) { skipped.push(arr.length); continue; }
    for (let mask = 1; mask < 1 << arr.length; mask++) {
      const sub = arr.filter((_, i) => mask & (1 << i));
      const k = sub.join('|');
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const frequent = [...counts.entries()]
    .filter(([, c]) => c >= minSupport)
    .map(([k, c]) => ({ items: k.split('|'), support: c }));
  const maximal = frequent.filter((f) =>
    !frequent.some((g) => g !== f && g.items.length > f.items.length &&
      f.items.every((i) => g.items.includes(i)))
  );
  maximal.sort((a, b) =>
    b.support - a.support || b.items.length - a.items.length || a.items.join().localeCompare(b.items.join())
  );
  return { frequent, maximal, skipped };
}

// 生成 bundle 计划：每页先选一个覆盖它、支持度最高的极大项集做共享 bundle，
// 剩余扩展打成一个该页独有 bundle。这正是「多页共用合并 + 多出来的单独打包」。
export function planBundles(pages, maximal) {
  const groupsUsed = new Map();
  const rows = pages.map((p) => {
    const set = new Set(p.exjs);
    const matched = maximal
      .filter((f) => f.items.every((i) => set.has(i)))
      .sort((a, b) => b.items.length - a.items.length || b.support - a.support);
    const group = matched[0] || null;
    const alone = p.exjs.filter((i) => !group || !group.items.includes(i));
    let shared = null;
    if (group) {
      const name = `group-${group.items.join('-')}`;
      shared = name;
      if (!groupsUsed.has(name)) {
        groupsUsed.set(name, { name, exjs: group.items, support: group.support, pages: [] });
      }
      groupsUsed.get(name).pages.push(p.id);
    }
    return {
      page: p.id,
      exjs: p.exjs,
      shared,
      alone,
      bundles: [shared, alone.length ? alone.join('-') : null].filter(Boolean),
    };
  });
  return { rows, groups: [...groupsUsed.values()] };
}

// 从分析结果生成构建 manifest：page -> bundles、bundle -> exjs/files。
// 同名 bundle 自动合并（多个页面若独有集合相同，复用同一份产物）。
export function buildManifest({ pages, groups, plan, exts }) {
  const extMap = new Map(exts.map((e) => [e.id, e]));
  const groupByName = new Map(groups.map((g) => [g.name, g]));
  const bundles = new Map();

  const ensure = (name) => {
    if (!bundles.has(name)) {
      bundles.set(name, {
        name,
        exjs: new Set(),
        pages: new Set(),
        shared: name.startsWith('group-'),
      });
    }
    return bundles.get(name);
  };

  const pageMap = {};
  for (const row of plan) {
    const list = [];
    if (row.shared) {
      const b = ensure(row.shared);
      const g = groupByName.get(row.shared);
      if (g) g.exjs.forEach((id) => b.exjs.add(id));
      b.pages.add(row.page);
      list.push(row.shared);
    }
    if (row.alone && row.alone.length) {
      const name = row.alone.join('-');
      const b = ensure(name);
      row.alone.forEach((id) => b.exjs.add(id));
      b.pages.add(row.page);
      list.push(name);
    }
    const p = pages.find((x) => x.id === row.page);
    pageMap[row.page] = {
      html: p ? p.html : `page/${row.page}/index.html`,
      exjs: row.exjs,
      bundles: list,
    };
  }

  const bundleMap = {};
  for (const [name, b] of bundles) {
    const exjsList = [...b.exjs];
    const files = exjsList
      .map((id) => {
        const e = extMap.get(id);
        return e && e.entry ? `Exjs/${id}/${e.entry}` : null;
      })
      .filter(Boolean);
    bundleMap[name] = {
      name,
      file: `Exjs/${name}.js`,
      exjs: exjsList,
      files,
      shared: b.shared,
      pages: [...b.pages],
    };
  }

  return { pages: pageMap, bundles: bundleMap };
}

export async function analyze({ minSupport = 2 } = {}) {
  const pages = await collectPageDeclarations();
  const exts = await collectAvailableExjs();
  const issues = validate(pages, exts);
  // 只让「存在且启用且有入口」的扩展参与分组，脏数据留在 issues 里
  const valid = new Set(exts.filter((e) => e.enabled && e.entry).map((e) => e.id));
  const sets = pages.map((p) => p.exjs.filter((id) => valid.has(id)));
  const { frequent, maximal, skipped } = maximalItemsets(sets, minSupport);
  const { rows, groups } = planBundles(pages, maximal);
  return { pages, exts, issues, frequent, maximal, groups, plan: rows, skipped, minSupport };
}
