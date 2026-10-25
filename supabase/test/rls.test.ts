/**
 * Test bảo mật schema (T0.2 / một phần T0.4) — chạy migration trên PGlite (Postgres trong Node, không cần Docker).
 * Mô phỏng vai trò Supabase: anon, authenticated (+ auth.uid() từ JWT), service_role, cộng bot_reader của Cohort OS.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(path.join(dir, '..', 'migrations', '20261025000000_init.sql'), 'utf8');

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';
const CAMP = '120252652862560233';
const AD_MOF = '120252750913970233';
const AD_KV = '120252743565200233';

let db: PGlite;
let projectId: string;

/** Chạy SQL dưới 1 vai trò (và user JWT nếu có), trả rows hoặc ném lỗi Postgres. */
async function as<T = any>(role: string, sql: string, sub?: string): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (sub) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    const r = await tx.query<T>(sql);
    return r.rows;
  });
}
const denied = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied|violates row-level security/i);

beforeAll(async () => {
  db = new PGlite();
  // Môi trường giống Supabase
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to public;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(MIGRATION);
  await db.exec(`grant all on all tables in schema public to service_role;`);

  // Dữ liệu mẫu (nạp bằng superuser = giống service_role của sync)
  const p = await db.query<{ id: string }>(`insert into public.projects (slug, name) values ('webinar-re11', 'Webinar RE11') returning id`);
  projectId = p.rows[0].id;
  await db.exec(`
    insert into public.admins (user_id, email) values ('${ADMIN}', 'nguyen@evancoaching.net');
    insert into public.project_campaigns (campaign_id, project_id) values ('${CAMP}', '${projectId}');
    insert into public.meta_ads_daily (date, ad_id, account_id, campaign_id, campaign_name, objective, adset_id, ad_name, creative_concept, concept_key, creative_format, spend, purchases_meta) values
      ('2026-10-20', '${AD_MOF}', '763840845228631', '${CAMP}', 'COACH-WBN-RE-PC-SAC', 'OUTCOME_SALES', '120252703228760233', 'Video ban doc_WARM_MOF', 'Video ban doc', 'video ban doc', 'video', 60.00, 2),
      ('2026-10-20', '${AD_KV}',  '763840845228631', '${CAMP}', 'COACH-WBN-RE-PC-SAC', 'OUTCOME_SALES', '120252743565210233', 'Photo Poster KV_WARM', 'Photo Poster KV', 'photo poster kv', 'photo', 40.00, 1);
    insert into public.meta_entities (level, id, name, campaign_id, is_sac) values ('campaign', '${CAMP}', 'COACH-WBN-RE-PC-SAC', '${CAMP}', true);
    insert into public.crm_submissions (conversion_id, project_id, contact_id, converted_on, ad_id, campaign_id, placement, source_hint) values
      ('c-1', '${projectId}', '257000000001', '2026-10-20', '${AD_MOF}', '${CAMP}', 'Facebook_Mobile_Reels', 'tracked'),
      ('c-2', '${projectId}', '257000000002', '2026-10-20', '${AD_KV}',  '${CAMP}', 'Facebook_Mobile_Feed', 'tracked'),
      ('c-3', '${projectId}', '257000000001', '2026-10-21', '${AD_KV}',  '${CAMP}', 'Facebook_Mobile_Feed', 'tracked'),
      ('c-4', '${projectId}', '257000000003', '2026-10-19', null, null, null, 'direct'),
      ('c-5', '${projectId}', '257000000003', '2026-10-22', '${AD_KV}',  '${CAMP}', 'Facebook_Mobile_Feed', 'tracked'),
      ('c-6', '${projectId}', '257000000004', '2026-10-05', null, null, null, 'test');
    insert into public.crm_deals (deal_id, project_id, contact_ids, deal_stage, deal_type, amount, is_won) values
      ('66000000001', '${projectId}', '{257000000001}', 'Following', 'seat', 10, true),
      ('66000000002', '${projectId}', '{257000000002}', 'Lost', 'seat', 10, false),
      ('66000000003', '${projectId}', '{257000000003}', 'Purchased', 'program', 995, true);
  `);
});

describe('cấu trúc an toàn', () => {
  it('mọi bảng public đều ENABLE + FORCE RLS (trừ admins: chỉ ENABLE, có chủ đích)', async () => {
    const r = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`);
    expect(r.rows.map((x) => x.relname)).toEqual(['admins']);
    const a = await db.query<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where relname = 'admins'`);
    expect(a.rows[0].rls).toBe(true);
  });
  it('không có cột PII (trừ email của chính admin)', async () => {
    const r = await db.query<{ col: string }>(`
      select table_schema || '.' || table_name || '.' || column_name as col from information_schema.columns
      where table_schema in ('public', 'bot')
        and column_name ~* '(e_?mail|phone|first_name|last_name|full_name|contact_name|deal_name|owner)'`);
    expect(r.rows.map((x) => x.col)).toEqual(['public.admins.email']);
  });
  it('anon/authenticated không có quyền gì trên schema bot', async () => {
    await denied(as('authenticated', 'select * from bot.v_project_master', ADMIN));
    await denied(as('anon', 'select * from bot.v_project_master'));
  });
});

describe('anon (key công khai)', () => {
  it.each(['projects', 'meta_ads_daily', 'crm_submissions', 'crm_deals', 'shares', 'admins', 'app_config', 'crm_leads'])(
    'không đọc được %s', async (t) => { await denied(as('anon', `select * from public.${t}`)); });
  it('không gọi được is_admin()', async () => { await denied(as('anon', 'select public.is_admin()')); });
});

describe('authenticated KHÔNG phải admin (vd tài khoản lạ lọt vào)', () => {
  it('đọc mọi bảng → 0 dòng', async () => {
    for (const t of ['projects', 'meta_ads_daily', 'crm_submissions', 'crm_deals', 'crm_leads']) {
      expect(await as('authenticated', `select * from public.${t}`, STRANGER)).toEqual([]);
    }
  });
  it('ghi → bị RLS chặn', async () => {
    await denied(as('authenticated', `insert into public.projects (slug, name) values ('hack', 'x')`, STRANGER));
  });
  it('is_admin() = false', async () => {
    expect(await as('authenticated', 'select public.is_admin() as a', STRANGER)).toEqual([{ a: false }]);
  });
});

describe('admin', () => {
  it('đọc được dữ liệu', async () => {
    expect((await as('authenticated', 'select slug from public.projects', ADMIN)).map((r: any) => r.slug)).toEqual(['webinar-re11']);
    expect(await as('authenticated', 'select count(*)::int as n from public.meta_ads_daily', ADMIN)).toEqual([{ n: 2 }]);
  });
  it('ghi được bảng do Web quản lý (project, creative)', async () => {
    await as('authenticated', `insert into public.creative_assets (scope, concept_key, drive_file_id) values ('concept', 'video ban doc', '1AbCdEfGhIjKlMnOp')`, ADMIN);
    expect(await as('authenticated', 'select count(*)::int as n from public.creative_assets', ADMIN)).toEqual([{ n: 1 }]);
  });
  it('KHÔNG ghi được bảng Meta (chỉ sync được ghi)', async () => {
    await denied(as('authenticated', `update public.meta_ads_daily set spend = 0`, ADMIN));
    await denied(as('authenticated', `delete from public.signals`, ADMIN));
  });
});

describe('crm_leads (first-touch, khớp packages/core)', () => {
  it('ưu tiên lượt có tracking sớm nhất; bỏ lượt test', async () => {
    const rows = await as<{ contact_id: string; conversion_id: string; source_hint: string }>(
      'authenticated', 'select contact_id, conversion_id, source_hint from public.crm_leads order by contact_id', ADMIN);
    expect(rows).toEqual([
      { contact_id: '257000000001', conversion_id: 'c-1', source_hint: 'tracked' },
      { contact_id: '257000000002', conversion_id: 'c-2', source_hint: 'tracked' },
      { contact_id: '257000000003', conversion_id: 'c-5', source_hint: 'tracked' }, // direct sớm hơn nhưng tracked được ưu tiên
    ]);
  });
});

describe('bot_reader (Bé Sugar)', () => {
  it('đọc được báo cáo master tổng hợp, số đúng', async () => {
    const [m] = await as<any>('bot_reader', 'select * from bot.v_project_master');
    expect({
      spend: Number(m.spend), registrations: Number(m.registrations), seats: Number(m.seats),
      programs: Number(m.programs), program_revenue: Number(m.program_revenue), cpa_seat: Number(m.cpa_seat), cash_roas: Number(m.cash_roas),
    }).toEqual({ spend: 100, registrations: 3, seats: 1, programs: 1, program_revenue: 995, cpa_seat: 100, cash_roas: 10.05 });
  });
  it('creative theo concept: seat gắn đúng concept của ad', async () => {
    const rows = await as<any>('bot_reader', 'select concept_key, registrations, seats from bot.v_creative_perf order by concept_key');
    expect(rows.map((r) => ({ k: r.concept_key, regs: Number(r.registrations), seats: Number(r.seats) }))).toEqual([
      { k: 'photo poster kv', regs: 2, seats: 0 },
      { k: 'video ban doc', regs: 1, seats: 1 },
    ]);
  });
  it('campaign theo ngày có cờ SAC', async () => {
    const [r] = await as<any>('bot_reader', 'select campaign_id, is_sac, spend from bot.v_campaign_daily');
    expect({ id: r.campaign_id, sac: r.is_sac, spend: Number(r.spend) }).toEqual({ id: CAMP, sac: true, spend: 100 });
  });
  it('KHÔNG đọc được bảng gốc hay view nội bộ có contact_id', async () => {
    for (const q of ['select * from public.crm_submissions', 'select * from public.crm_deals', 'select * from public.crm_leads',
      'select * from public.meta_ads_daily', 'select * from bot._lead_outcomes', 'select * from bot._leads']) {
      await denied(as('bot_reader', q));
    }
  });
  it('view cho bot không lộ contact_id / deal_id', async () => {
    const r = await db.query<{ col: string }>(`
      select table_name || '.' || column_name as col from information_schema.columns
      where table_schema = 'bot' and table_name not like '\\_%' and column_name ~ '(contact|deal_id|conversion)'`);
    expect(r.rows).toEqual([]);
  });
});

describe('ràng buộc dữ liệu (chặn PII lọt vào bằng cột sai định dạng)', () => {
  it.each([
    [`insert into public.crm_submissions (conversion_id, project_id, page_path, source_hint) values ('x1', '$P', '/x?email=a@b.com', 'direct')`, 'page_path có @'],
    [`insert into public.crm_submissions (conversion_id, project_id, contact_id, source_hint) values ('x2', '$P', '2.57E+11', 'direct')`, 'contact_id dạng E+'],
    [`insert into public.crm_deals (deal_id, contact_ids, deal_type) values ('1', '{abc}', 'seat')`, 'contact_ids không phải số'],
    [`insert into public.crm_deals (deal_id, deal_type) values ('2', 'vip')`, 'deal_type lạ'],
    [`insert into public.meta_ads_daily (date, ad_id, account_id, campaign_id, adset_id) values ('2026-10-01', 'Video ban doc', '1234567', '1234567', '1234567')`, 'ad_id không phải số'],
    [`insert into public.shares (token, title, snapshot, expires_at) values ('ngan', 't', '{}', now() + interval '1 day')`, 'token share quá ngắn'],
  ])('%s → bị từ chối (%s)', async (sql) => {
    await expect(db.exec(sql.replace('$P', projectId))).rejects.toThrow(/violates check constraint/);
  });
});
