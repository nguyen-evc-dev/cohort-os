// Gói packages/core (phần bot cần) thành apps/bot/src/Core.generated.js để đưa lên Apps Script.
// Chạy: pnpm build:bot   (CI kiểm tra file không bị cũ: pnpm check:bot)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const entry = path.join(root, 'packages', 'core', 'src', 'bot-entry.ts');
const out = path.join(root, 'apps', 'bot', 'src', 'Core.generated.js');

const res = buildSync({
  entryPoints: [entry], bundle: true, write: false, format: 'iife', globalName: 'CohortCore', target: 'es2019', legalComments: 'none', charset: 'utf8', logLevel: 'error',
});
const code = `// TỰ SINH bởi apps/bot/scripts/build-core.mjs từ packages/core. KHÔNG sửa tay.\n${res.outputFiles[0].text}`.replace(/\r\n/g, '\n');
const banned = ['Intl.', 'new URL(', 'TextEncoder', 'TextDecoder', 'structuredClone', 'process.', 'require('];
const hit = banned.filter((b) => code.includes(b));
if (hit.length) { console.error(`Bundle dùng API không có trong Apps Script: ${hit.join(', ')}`); process.exit(1); }

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== code) { console.error('Core.generated.js đã cũ. Chạy: pnpm build:bot'); process.exit(1); }
  console.log('Core.generated.js đã khớp.');
} else {
  fs.writeFileSync(out, code);
  console.log(`Đã sinh ${path.relative(root, out)} (${Math.round(code.length / 1024)} KB)`);
}
