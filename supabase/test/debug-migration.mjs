// Công cụ gỡ lỗi: chạy migration TỪNG CÂU LỆNH bằng role không phải superuser (giống "postgres" của Supabase)
// để tìm chính xác câu nào lỗi quyền.  node test/debug-migration.mjs migrations/<file>.sql
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

// Schema bot đã tạo sẵn ở dưới (PGlite không cấp được quyền CREATE trên database cho role mô phỏng)
const sql = fs.readFileSync(process.argv[2], 'utf8').replace('create schema if not exists bot;', '');
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  grant usage on schema auth to public;
  grant usage on schema public to anon, authenticated, service_role;
  create role supa_postgres nologin createrole;
`);
await db.exec('create schema bot authorization supa_postgres;'); // Supabase: postgres tự tạo được schema; PGlite không cấp được quyền trên database
await db.exec('alter schema public owner to supa_postgres;');
await db.exec('set role supa_postgres;');

// Tách câu lệnh cấp cao, không cắt bên trong khối $$ … $$
const stmts = [];
let cur = '';
let inDollar = false;
for (const line of sql.split('\n')) {
  cur += line + '\n';
  if ((line.match(/\$\$/g) || []).length % 2) inDollar = !inDollar;
  if (!inDollar && /;\s*(--.*)?$/.test(line)) { stmts.push(cur); cur = ''; }
}
for (const [i, s] of stmts.entries()) {
  try { await db.exec(s); } catch (e) {
    console.log(`FAIL #${i}: ${e.message}\n${s.trim().slice(0, 400)}`);
    process.exit(1);
  }
}
console.log(`OK — ${stmts.length} câu lệnh chạy được bằng role không phải superuser`);
