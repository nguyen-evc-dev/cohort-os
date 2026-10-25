/**
 * Test bảo mật schema (T0.2 / một phần T0.4) — chạy migration trên PGlite (Postgres trong Node, không cần Docker).
 * Mô phỏng vai trò Supabase: anon, authenticated (+ auth.uid() từ JWT), service_role, cộng bot_reader của Cohort OS.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { buildProjectReport } from '../../packages/core/src/report';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
// Schema bot được tạo sẵn cho role mô phỏng (PGlite không cấp được quyền CREATE trên database) → bỏ dòng tạo schema khi test.
const MIGRATIONS_DIR = path.join(dir, '..', 'migrations');
const MIGRATIONS = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').replace('create schema if not exists bot;', ''));
export const BOT_TOKEN = 'test-bot-token-0123456789abcdefghijklmnop';

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
    -- Mô phỏng role "postgres" của Supabase: KHÔNG phải superuser, KHÔNG bypassrls, có CREATEROLE.
    create role supa_postgres nologin createrole;
    create schema bot authorization supa_postgres; -- Supabase: role postgres tự tạo được schema; PGlite không cấp được quyền trên database
    alter schema public owner to supa_postgres;
  `);
  // Chạy migration bằng role không phải superuser để bắt lỗi quyền giống Supabase thật
  for (const m of MIGRATIONS) {
    await db.transaction(async (tx) => { await tx.exec('set local role supa_postgres'); await tx.exec(m); });
  }
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
    insert into public.sync_runs (kind, target_date, status, rows, problems) values
      ('meta', '2026-10-20', 'ok', 2, null),
      ('meta', '2026-10-21', 'rejected', 0, '[{"date":"2026-10-21","ads_spend":90,"account_spend":100}]');
    insert into public.bot_tokens (token_hash, label) values
      (encode(sha256(convert_to('${BOT_TOKEN}', 'UTF8')), 'hex'), 'test'),
      (encode(sha256(convert_to('revoked-token-0123456789abcdefghijklmnop', 'UTF8')), 'hex'), 'old');
    update public.bot_tokens set revoked_at = now() where label = 'old';
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

describe('bot_read (cổng đọc của Bé Sugar qua anon key)', () => {
  const call = (token: string, view: string, since: string | null = null) =>
    as<{ r: any }>('anon', `select public.bot_read(${token === null ? 'null' : `'${token}'`}, '${view}', ${since ? `'${since}'` : 'null'}) as r`);
  it('token đúng → đọc được view trạng thái sync, mới nhất trước', async () => {
    const [{ r }] = await call(BOT_TOKEN, 'v_sync_status');
    expect(r.map((x: any) => [x.target_date, x.status])).toEqual([['2026-10-21', 'rejected'], ['2026-10-20', 'ok']]);
  });
  it('lọc theo ngày (p_since)', async () => {
    const [{ r }] = await call(BOT_TOKEN, 'v_campaign_daily', '2026-10-21');
    expect(r).toEqual([]);
    const [{ r: all }] = await call(BOT_TOKEN, 'v_campaign_daily', '2026-10-20');
    expect(all.length).toBe(1);
  });
  it.each([['sai', 'abcdefghijklmnopqrstuvwxyz0123456789'], ['ngắn', 'x'], ['đã thu hồi', 'revoked-token-0123456789abcdefghijklmnop']])(
    'token %s → unauthorized', async (_n, t) => { await expect(call(t, 'v_sync_status')).rejects.toThrow(/unauthorized/); });
  it('chỉ đọc view trong whitelist, không đọc bảng / view nội bộ', async () => {
    for (const v of ['_leads', '_lead_outcomes', 'crm_submissions', 'v_sync_status; drop table x']) {
      await expect(call(BOT_TOKEN, v)).rejects.toThrow(/unknown_view/);
    }
  });
  it('anon không đọc được bot_tokens; authenticated không gọi được bot_read', async () => {
    await denied(as('anon', 'select * from public.bot_tokens'));
    await denied(as('authenticated', `select public.bot_read('${BOT_TOKEN}', 'v_sync_status')`, ADMIN));
  });
  it('hàm chạy bằng quyền bot_reader (không phải chủ bảng)', async () => {
    const r = await db.query<{ owner: string; secdef: boolean }>(
      `select pg_get_userbyid(proowner) as owner, prosecdef as secdef from pg_proc where proname = 'bot_read'`);
    expect(r.rows).toEqual([{ owner: 'bot_reader', secdef: true }]);
  });
});

describe('AC T2.3 — báo cáo Web khớp view bot.v_project_master', () => {
  it('buildProjectReport(không lọc ngày) = v_project_master cho cùng dữ liệu', async () => {
    // to_jsonb → dữ liệu dạng chuỗi giống PostgREST (ngày là 'YYYY-MM-DD')
    const q = (table: string, where = 'true') => db.query<any>(`select to_jsonb(t) as j from public.${table} t where ${where}`).then((r) => r.rows.map((x) => x.j));
    const [meta, subs, deals, camps] = await Promise.all([
      q('meta_ads_daily'), q('crm_submissions'),
      q('crm_deals'), q('project_campaigns', `project_id = '${projectId}'`),
    ]);
    const r = buildProjectReport({ metaRows: meta, campaignIds: camps.map((c) => c.campaign_id), submissions: subs, deals });
    const [m] = await as<any>('bot_reader', 'select * from bot.v_project_master');
    expect({
      spend: r.total.meta.spend, registrations: r.total.crm.leads, tracked: r.total.crm.tracked, seats: r.total.crm.seats,
      seat_revenue: r.total.crm.seatRevenue, programs: r.total.crm.programs, program_revenue: r.total.crm.programRevenue,
      cpa_seat: r.total.crm.cpaSeat, cash_roas: r.total.crm.cashRoas, purchases_meta: r.total.meta.purchases,
    }).toEqual({
      spend: Number(m.spend), registrations: Number(m.registrations), tracked: Number(m.tracked_registrations), seats: Number(m.seats),
      seat_revenue: Number(m.seat_revenue), programs: Number(m.programs), program_revenue: Number(m.program_revenue),
      cpa_seat: Number(m.cpa_seat), cash_roas: Number(m.cash_roas), purchases_meta: Number(m.purchases_meta),
    });
  });
});

describe('cổng công khai (thumb_allowed, share_open) — T2.5 / T2.9', () => {
  const TOKEN = 'A'.repeat(43);
  const EXPIRED = 'B'.repeat(43);
  const REVOKED = 'C'.repeat(43);
  const FILE = '1AbCdEfGhIjKlMnOp';
  beforeAll(async () => {
    await db.exec(`
      insert into public.shares (token, title, snapshot, expires_at, created_at) values
        ('${TOKEN}', 'Báo cáo thử', '{"spend": 150}', now() + interval '7 days', now()),
        ('${EXPIRED}', 'Hết hạn', '{}', now() - interval '1 hour', now() - interval '2 days'),
        ('${REVOKED}', 'Đã thu hồi', '{}', now() + interval '7 days', now());
      update public.shares set revoked_at = now() where token = '${REVOKED}';
    `);
  });
  const q = (v: string) => v.replace(/'/g, "''"); // escape cho SQL của chính test; hàm DB phải tự an toàn với chuỗi lạ
  const open = (t: string) => as<{ r: any }>('anon', `select public.share_open('${q(t)}') as r`).then((x) => x[0].r);
  const thumb = (f: string) => as<{ r: boolean }>('anon', `select public.thumb_allowed('${q(f)}') as r`).then((x) => x[0].r);

  it('thumb_allowed: chỉ true với fileId đã gắn trong creative_assets', async () => {
    expect(await thumb(FILE)).toBe(true);          // đã gắn ở test "admin ghi được bảng creative"
    expect(await thumb('1ZzZzZzZzZzZzZzZz')).toBe(false);
    expect(await thumb("x'; drop table shares; --")).toBe(false);
  });
  it('share_open: token đúng → snapshot + tăng view_count', async () => {
    const r = await open(TOKEN);
    expect(r).toMatchObject({ title: 'Báo cáo thử', snapshot: { spend: 150 }, hide_money: false });
    await open(TOKEN);
    const [row] = await db.query<{ view_count: number }>(`select view_count from public.shares where token = '${TOKEN}'`).then((x) => x.rows);
    expect(row.view_count).toBe(2);
  });
  it('share_open: hết hạn / thu hồi / sai / token ngắn / null → null (không lộ lý do)', async () => {
    for (const t of [EXPIRED, REVOKED, 'D'.repeat(43), 'ngan', "x'--"]) expect(await open(t)).toBeNull();
    expect(await as('anon', `select public.share_open(null) as r`)).toEqual([{ r: null }]);
  });
  it('anon vẫn KHÔNG đọc trực tiếp shares / creative_assets', async () => {
    await denied(as('anon', 'select * from public.shares'));
    await denied(as('anon', 'select * from public.creative_assets'));
    await denied(as('anon', `update public.shares set revoked_at = null`));
  });
  it('hàm chạy bằng role gateway, không phải chủ bảng', async () => {
    const r = await db.query<{ n: string; o: string }>(`select proname as n, pg_get_userbyid(proowner) as o from pg_proc where proname in ('thumb_allowed','share_open') order by 1`);
    expect(r.rows).toEqual([{ n: 'share_open', o: 'gateway' }, { n: 'thumb_allowed', o: 'gateway' }]);
  });
});

describe('creative_assets.stage (gắn stage thủ công)', () => {
  it('chỉ nhận TOFU / MOFU / BOFU hoặc null', async () => {
    await as('authenticated', `insert into public.creative_assets (scope, concept_key, stage) values ('concept', 'photo poster kv', 'MOFU')`, ADMIN);
    await as('authenticated', `insert into public.creative_assets (scope, ad_id, stage) values ('ad', '120252743565200233', null)`, ADMIN);
    await expect(db.exec(`insert into public.creative_assets (scope, concept_key, stage) values ('concept', 'x', 'MOF')`)).rejects.toThrow(/violates check constraint/);
    const rows = await as<{ stage: string | null }>('authenticated', `select stage from public.creative_assets where concept_key = 'photo poster kv'`, ADMIN);
    expect(rows).toEqual([{ stage: 'MOFU' }]);
  });
  it('anon vẫn không đọc được creative_assets (stage không lộ)', async () => {
    await denied(as('anon', 'select stage from public.creative_assets'));
  });
});
