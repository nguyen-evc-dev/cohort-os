/**
 * T0.4 — Test bảo mật trên Supabase THẬT (chỉ đọc, không ghi gì).
 * Chạy khi có biến môi trường; thiếu thì bỏ qua (CI không có secret vẫn xanh).
 *   SUPABASE_URL, SUPABASE_SECRET_KEY            ← .env.local ở gốc repo
 *   SUPABASE_PUBLISHABLE_KEY                     ← hoặc NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY trong apps/web/.env.local
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findPii } from '../../packages/core/src/mask';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['.env.local', 'apps/web/.env.local']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) process.loadEnvFile(p);
}
const URL_ = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const live = !!(URL_ && SECRET && PUBLISHABLE);

// Cột được phép chứa chuỗi giống email/SĐT: email của chính admin; nội dung quảng cáo công khai của Meta
const PII_ALLOW = new Set(['admins.email', 'meta_creatives.title', 'meta_creatives.body', 'meta_creatives.link_url', 'meta_creatives.thumbnail_url_meta']);

const rest = (p: string, key: string, init: RequestInit = {}) =>
  fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers || {}) } });

let tables: string[] = [];

describe.skipIf(!live)('Supabase thật — bảo mật (chỉ đọc)', () => {
  beforeAll(async () => {
    const r = await rest('', SECRET!, { headers: { Accept: 'application/openapi+json' } });
    expect(r.status).toBe(200);
    const spec = await r.json() as { paths: Record<string, unknown> };
    tables = Object.keys(spec.paths).filter((p) => p !== '/' && !p.startsWith('/rpc/')).map((p) => p.slice(1)).sort();
  });

  it('liệt kê được các bảng public (kiểm tra tiền đề)', () => {
    expect(tables).toEqual(expect.arrayContaining(['meta_ads_daily', 'crm_submissions', 'crm_deals', 'projects', 'admins', 'shares']));
  });

  it('anon (key công khai) đọc MỌI bảng/view → lỗi hoặc 0 dòng', async () => {
    const leaks: string[] = [];
    for (const t of tables) {
      const r = await rest(`${t}?select=*&limit=1`, PUBLISHABLE!);
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) leaks.push(t);
      }
    }
    expect(leaks).toEqual([]);
  }, 60_000);

  it('anon không ghi được (projects)', async () => {
    const r = await rest('projects', PUBLISHABLE!, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ slug: 'hack-probe', name: 'x' }),
    });
    expect(r.ok).toBe(false);
  });

  it('anon không đọc được schema bot trực tiếp', async () => {
    const r = await rest('v_project_master?select=*&limit=1', PUBLISHABLE!, { headers: { 'Accept-Profile': 'bot' } });
    expect(r.ok).toBe(false);
  });

  it('anon gọi is_admin / bot_read với token giả → bị từ chối', async () => {
    const a = await rest('rpc/is_admin', PUBLISHABLE!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(a.ok).toBe(false);
    const b = await rest('rpc/bot_read', PUBLISHABLE!, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: crypto.randomBytes(32).toString('base64url'), p_view: 'v_sync_status' }),
    });
    expect(b.ok).toBe(false);
  });

  it('email lạ gọi signUp → bị từ chối (đăng ký mới đã tắt)', async () => {
    const r = await fetch(`${URL_}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: PUBLISHABLE!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `probe-${crypto.randomBytes(4).toString('hex')}@example.com`, password: crypto.randomBytes(18).toString('base64url') }),
    });
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    expect(r.ok).toBe(false);
    expect(JSON.stringify(body)).toMatch(/signup_disabled|Signups not allowed/i);
  });

  it('quét toàn DB: không có email đầy đủ / SĐT (trừ cột được phép)', async () => {
    const hits: string[] = [];
    for (const t of tables) {
      for (let from = 0; ; from += 1000) {
        const r = await rest(`${t}?select=*`, SECRET!, { headers: { Range: `${from}-${from + 999}` } });
        if (!r.ok) break;
        const rows = await r.json() as Record<string, unknown>[];
        for (const h of findPii(rows, t)) {
          const col = `${t}.${h.path.replace(/^[^.]+\[\d+\]\./, '').split(/[.[]/)[0]}`;
          if (!PII_ALLOW.has(col)) hits.push(`${h.kind}@${col}`);
        }
        if (rows.length < 1000) break;
      }
    }
    expect([...new Set(hits)]).toEqual([]);
  }, 120_000);
});
