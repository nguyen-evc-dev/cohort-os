// Gom skills/*.md thành packages/core/src/skills.generated.ts để Web (Vercel) và Bé Sugar dùng chung.
// Chạy: pnpm build:skills   (CI kiểm tra file sinh ra không bị cũ: pnpm build:skills --check)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'skills');
const out = path.join(root, 'packages', 'core', 'src', 'skills.generated.ts');

const names = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
const body = names.map((f) => `  ${JSON.stringify(f.replace(/\.md$/, ''))}: ${JSON.stringify(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n'))},`).join('\n');
const content = `// TỰ SINH bởi scripts/build-skills.mjs từ thư mục skills/. KHÔNG sửa tay.\nexport const SKILLS: Record<string, string> = {\n${body}\n};\n`;

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== content) { console.error('skills.generated.ts đã cũ. Chạy: pnpm build:skills'); process.exit(1); }
  console.log('skills.generated.ts đã khớp.');
} else {
  fs.writeFileSync(out, content);
  console.log(`Đã sinh ${path.relative(root, out)} (${names.length} skill: ${names.join(', ')})`);
}
