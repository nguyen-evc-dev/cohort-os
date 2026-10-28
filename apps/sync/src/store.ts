/**
 * Nơi lưu dữ liệu của sync. Bản thật = Supabase (service role, chỉ có trên máy Nguyên).
 * Bản nhớ (MemoryStore) dùng cho test: cùng hành vi upsert/khóa.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Row } from '@cohort/core';

export interface SyncRunPatch { status: 'ok' | 'rejected' | 'error'; rows?: number; problems?: unknown; note?: string; date_from?: string; date_to?: string }

export interface Store {
  lastMetaSyncedDate(): Promise<string | null>;
  startRun(kind: 'meta' | 'meta_backfill' | 'meta_upload', targetDate: string): Promise<string>;
  finishRun(id: string, patch: SyncRunPatch): Promise<void>;
  select(table: string, opts?: { gte?: [string, string]; in?: [string, string[]] }): Promise<Row[]>;
  upsert(table: string, rows: Row[], onConflict: string): Promise<void>;
  /** Xóa tín hiệu của ngày as_of rồi ghi lại (tính lại toàn bộ). */
  replaceSignals(asOf: string, rows: Row[]): Promise<void>;
  /** Xóa chuyển đổi trong [from, to] rồi ghi lại (chuyển đổi có thể giảm khi Meta điều chỉnh attribution). */
  replaceActions(from: string, to: string, rows: Row[]): Promise<void>;
  /** Thay chuyển đổi custom của các campaign × loại hành động trong [from, to] (upload report chỉ đụng phần của mình). */
  replaceActionsScoped(scope: { campaignIds: string[]; actionTypes: string[]; from: string; to: string }, rows: Row[]): Promise<void>;
  /** Ghi bản chụp báo cáo cho bot (khóa slug + range_key) và xóa bản của Project không còn. */
  replaceSnapshots(rows: Row[]): Promise<void>;
}

/** Lỗi do DB chưa có bảng / cột mới (migration chưa đẩy). */
export const isMissingSchema = (e: unknown) => /does not exist|schema cache|Could not find the .* (column|table)/i.test(String((e as Error)?.message ?? e));

const PAGE = 1000;
const CHUNK = 500;

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseStore {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error('Thiếu SUPABASE_URL / SUPABASE_SECRET_KEY trong .env.local');
    return new SupabaseStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  }

  async lastMetaSyncedDate() {
    const { data, error } = await this.db.from('sync_runs').select('target_date')
      .eq('kind', 'meta').eq('status', 'ok').not('target_date', 'is', null)
      .order('target_date', { ascending: false }).limit(1);
    if (error) throw new Error(`sync_runs: ${error.message}`);
    return data?.[0]?.target_date ?? null;
  }

  async startRun(kind: 'meta' | 'meta_backfill' | 'meta_upload', targetDate: string) {
    const { data, error } = await this.db.from('sync_runs')
      .insert({ kind, target_date: targetDate, status: 'running' }).select('id').single();
    if (error) throw new Error(`sync_runs: ${error.message}`);
    return data.id as string;
  }

  async finishRun(id: string, patch: SyncRunPatch) {
    const { error } = await this.db.from('sync_runs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(`sync_runs: ${error.message}`);
  }

  async select(table: string, opts: { gte?: [string, string]; in?: [string, string[]] } = {}) {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.db.from(table).select('*');
      if (opts.gte) q = q.gte(opts.gte[0], opts.gte[1]);
      if (opts.in) q = q.in(opts.in[0], opts.in[1]);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < PAGE) return out;
    }
  }

  async upsert(table: string, rows: Row[], onConflict: string) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await this.db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }

  async replaceActions(from: string, to: string, rows: Row[]) {
    const { error } = await this.db.from('meta_actions_daily').delete().gte('date', from).lte('date', to);
    if (error) throw new Error(`meta_actions_daily: ${error.message}`);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: e2 } = await this.db.from('meta_actions_daily').insert(rows.slice(i, i + CHUNK));
      if (e2) throw new Error(`meta_actions_daily: ${e2.message}`);
    }
  }

  async replaceActionsScoped(scope: { campaignIds: string[]; actionTypes: string[]; from: string; to: string }, rows: Row[]) {
    const { error } = await this.db.from('meta_actions_daily').delete().in('campaign_id', scope.campaignIds).in('action_type', scope.actionTypes).gte('date', scope.from).lte('date', scope.to);
    if (error) throw new Error(`meta_actions_daily: ${error.message}`);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: e2 } = await this.db.from('meta_actions_daily').insert(rows.slice(i, i + CHUNK));
      if (e2) throw new Error(`meta_actions_daily: ${e2.message}`);
    }
  }

  async replaceSnapshots(rows: Row[]) {
    const keep = new Set(rows.map((r) => `${r.slug}|${r.range_key}`));
    const { data, error } = await this.db.from('bot_snapshots').select('slug,range_key');
    if (error) throw new Error(`bot_snapshots: ${error.message}`);
    for (const old of data || []) {
      if (keep.has(`${old.slug}|${old.range_key}`)) continue;
      const { error: e1 } = await this.db.from('bot_snapshots').delete().eq('slug', old.slug).eq('range_key', old.range_key);
      if (e1) throw new Error(`bot_snapshots: ${e1.message}`);
    }
    await this.upsert('bot_snapshots', rows, 'slug,range_key');
  }

  async replaceSignals(asOf: string, rows: Row[]) {
    const { error } = await this.db.from('signals').delete().eq('as_of', asOf);
    if (error) throw new Error(`signals: ${error.message}`);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: e2 } = await this.db.from('signals').insert(rows.slice(i, i + CHUNK));
      if (e2) throw new Error(`signals: ${e2.message}`);
    }
  }
}

/** Store trong bộ nhớ cho test. */
export class MemoryStore implements Store {
  tables: Record<string, Row[]> = {};
  private seq = 0;
  constructor(seed: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r }));
  }
  t(name: string) { return (this.tables[name] ||= []); }

  async lastMetaSyncedDate() {
    const ok = this.t('sync_runs').filter((r) => r.kind === 'meta' && r.status === 'ok' && r.target_date)
      .map((r) => r.target_date as string).sort();
    return ok.length ? ok[ok.length - 1] : null;
  }
  async startRun(kind: string, targetDate: string) {
    const id = `run-${++this.seq}`;
    this.t('sync_runs').push({ id, kind, target_date: targetDate, status: 'running' });
    return id;
  }
  async finishRun(id: string, patch: SyncRunPatch) {
    Object.assign(this.t('sync_runs').find((r) => r.id === id)!, patch, { finished_at: new Date().toISOString() });
  }
  async select(table: string, opts: { gte?: [string, string]; in?: [string, string[]] } = {}) {
    return this.t(table).filter((r) => (!opts.gte || String(r[opts.gte[0]]) >= opts.gte[1])
      && (!opts.in || opts.in[1].includes(String(r[opts.in[0]])))).map((r) => ({ ...r }));
  }
  async upsert(table: string, rows: Row[], onConflict: string) {
    const keys = onConflict.split(',');
    const t = this.t(table);
    for (const r of rows) {
      const i = t.findIndex((x) => keys.every((k) => String(x[k]) === String(r[k])));
      if (i >= 0) t[i] = { ...t[i], ...r }; else t.push({ ...r });
    }
  }
  async replaceActions(from: string, to: string, rows: Row[]) {
    this.tables.meta_actions_daily = this.t('meta_actions_daily').filter((r) => r.date < from || r.date > to).concat(rows.map((r) => ({ ...r })));
  }
  async replaceActionsScoped(scope: { campaignIds: string[]; actionTypes: string[]; from: string; to: string }, rows: Row[]) {
    this.tables.meta_actions_daily = this.t('meta_actions_daily').filter((r) => !(scope.campaignIds.includes(String(r.campaign_id)) && scope.actionTypes.includes(String(r.action_type)) && r.date >= scope.from && r.date <= scope.to)).concat(rows.map((r) => ({ ...r })));
  }
  async replaceSnapshots(rows: Row[]) {
    this.tables.bot_snapshots = rows.map((r) => ({ ...r }));
  }
  async replaceSignals(asOf: string, rows: Row[]) {
    this.tables.signals = this.t('signals').filter((r) => r.as_of !== asOf).concat(rows.map((r) => ({ ...r })));
  }
}
