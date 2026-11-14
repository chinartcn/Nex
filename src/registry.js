// 内存插件注册表：发现即登记；禁用仍可见（取代旧 .js.list.json）
export class Registry {
  constructor() {
    this.map = new Map();
  }

  // 注册/刷新一个扩展。已存在则保留其 enabled 状态，实现热重载不丢状态
  register(ext) {
    const prev = this.map.get(ext.id);
    const enabled = prev ? prev.enabled : ext.enabled !== false;
    this.map.set(ext.id, { ...ext, enabled });
    return this.map.get(ext.id);
  }

  list() {
    return [...this.map.values()];
  }

  get(id) {
    return this.map.get(id);
  }

  // 启停：写内存状态，不回写任何 .json 清单
  toggle(id) {
    const e = this.map.get(id);
    if (!e) return null;
    e.enabled = !e.enabled;
    return e;
  }
}
