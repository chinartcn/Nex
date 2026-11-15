import { createElement, useEffect, useState } from 'react';

// Phase 1 + Phase 5 演示面板：
// - 实时统一日志查看器（server.log + client.log 经 @NavExt-ws 汇聚为 log:event）
// - 「前往 A2」按钮：Nex.router.go 经总线请求服务端解析后导航
export function Panel({ title }: { title: string }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [nav, setNav] = useState<string>('');

  useEffect(() => {
    const Nex: any = (window as any).Nex;
    if (!Nex) return;

    const fmtEntry = (raw: any) => {
      const e = raw || {};
      return {
        ...e,
        ts: new Date(e.time || Date.now()).toLocaleTimeString(),
        color: e.source === 'client' ? '#2a8' : e.level === 'error' ? '#c33' : '#557',
        msg: e.msg || '',
      };
    };

    // 初始拉取已汇聚的日志
    fetch('/api/logs')
      .then((r) => r.json())
      .then((d) => setLogs((d.logs || []).slice(-20).map(fmtEntry)))
      .catch(() => {});

    // 订阅统一日志流（Phase 1 汇聚）
    const off = Nex.logOn((e: any) => {
      setLogs((prev) => [...prev.slice(-19), fmtEntry(e)]);
    });
    return off;
  }, []);

  const goA2 = () => {
    const Nex: any = (window as any).Nex;
    Nex?.router.go('a2').then((r: any) => setNav(`-> ${r.url} (${r.via})`));
  };

  return createElement(
    'div',
    { className: 'exjs-example' },
    createElement('strong', null, title),
    createElement(
      'span',
      null,
      ' — NavExt-React 挂载 · Phase 1 日志汇聚 + Phase 5 总线导航'
    ),
    createElement(
      'div',
      { style: { marginTop: 8 } },
      createElement('button', { onClick: goA2 }, '前往 A2 子页（总线导航）'),
      nav ? createElement('code', { style: { marginLeft: 8 } }, nav) : null
    ),
    createElement(
      'ul',
      { className: 'exjs-log', style: { maxHeight: 180, overflow: 'auto', fontSize: 12, marginTop: 8, listStyle: 'none', padding: 0 } },
      logs.map((l, i) =>
        createElement(
          'li',
          { key: i, style: { color: l.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
          `[${l.source}] ${l.ts} ${l.msg}`
        )
      )
    )
  );
}
