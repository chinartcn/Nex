// NavExt-React —— Exjs 的 React UI 框架
import { createRoot } from 'react-dom/client';
import type { NexBusClient } from '../NavExt-TS/index';

// 将 React 节点挂载到指定选择器，由 Exjs 生命周期管理
export function mountPanel(selector: string, node: import('react').ReactNode): void {
  const el = document.querySelector(selector);
  if (!el) {
    console.warn(`[NavExt-React] mount target not found: ${selector}`);
    return;
  }
  createRoot(el).render(node);
}

export type { NexBusClient };
