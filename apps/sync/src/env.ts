/** Đọc .env.local ở gốc repo (Node 22 có sẵn process.loadEnvFile) và tìm thư mục inbox. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const INBOX_ROOT = path.join(REPO_ROOT, 'sync', 'inbox');

export function loadEnv(): void {
  const p = path.join(REPO_ROOT, '.env.local');
  if (fs.existsSync(p)) process.loadEnvFile(p);
}
