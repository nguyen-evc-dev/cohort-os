/** Xóa thư mục inbox cũ hơn N ngày (tên thư mục bắt đầu bằng YYYY-MM-DD). */
import fs from 'node:fs';
import path from 'node:path';
import { addDays } from '@cohort/core';

export function cleanupInbox(root: string, today: string, keepDays = 14): string[] {
  if (!fs.existsSync(root)) return [];
  const cutoff = addDays(today, -keepDays);
  const removed: string[] = [];
  for (const name of fs.readdirSync(root)) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})/);
    const full = path.join(root, name);
    if (!m || m[1] >= cutoff || !fs.statSync(full).isDirectory()) continue;
    fs.rmSync(full, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}
