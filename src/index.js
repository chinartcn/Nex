import { loadConfig, ROOT } from './config.js';
import { Registry } from './registry.js';
import { discoverExtensions } from './discover.js';
import { createServer } from './server.js';
import { SecurityPolicy } from './security/runtime.js';
import { Bus } from './bus/index.js';
import { loadExservers } from './exserver/runtime.js';
import { createExjsRuntime } from './exjs/runtime.js';
import { SubpageRegistry } from './subpage.js';
import { startVite } from './dev/vite.js';
import { LogHub } from './log.js';

async function main() {
  const config = await loadConfig();

  const registry = new Registry();
  await discoverExtensions(registry);

  // Phase 5：安全策略外置 + API
  const security = new SecurityPolicy(config);
  await security.load();

  // Phase 5：子页自动发现（NavExt-sub）
  const subpages = new SubpageRegistry();
  await subpages.discover();

  const bus = new Bus();
  const hub = new LogHub(bus); // Phase 1：日志汇聚
  hub.attach();

  const exjs = createExjsRuntime(registry, ROOT);
  security.attachBus(bus); // 策略变更经总线广播
  const server = createServer(registry, config, { bus, exjs, security, subpages, log: hub });
  bus.attach(server); // @NavExt-ws 全双工总线

  const loadedEx = await loadExservers(registry, bus, { subpages, security, registry, log: hub }); // Phase 2：加载服务端扩展
  subpages.addExtensionPages(loadedEx); // 扩展可贡献子页路由

  // Phase 5：总线中介的子页导航（服务端权威解析，必要时改写 url）
  bus.on('subpage:open', (env, conn) => {
    const id = env?.payload?.id;
    const pg = subpages.get(id);
    const url = pg ? pg.url : `/page/${id}/index.html`;
    hub.server('info', `[hub] subpage:open ${id} -> ${url}`);
    if (conn) bus.send(conn, { type: 'subpage:open:ok', scope: env.scope || 'global', payload: { id, url } });
  });

  const port = config.server?.port ?? 3000;
  await startVite(config, port); // Phase 4：Vite 热更（仅 dev），开发地址 3001

  hub.server('info', `[Nex] mode=${config.mode} root=${ROOT}`);
  hub.server('info', `[Nex] security.fsWrite=${security.policy.fsWrite} (默认最小授权)`);
  server.listen(port, () => {
    hub.server('info', `[Nex] listening on :${port}`);
    hub.server(
      'info',
      `[Nex] discovered ${registry.list().length} extensions; exjs=${exjs.manifest(config.mode === 'dev').length}; pages=${subpages.list().length}`
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
