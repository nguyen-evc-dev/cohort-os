/**
 * Test nhắc việc Bé Sugar (T1.5) trên sandbox Apps Script dùng chung (test/gas.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadGas } from './gas';

const okRun = (id: string, target: string, finished: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: 'meta', target_date: target, status: 'ok', started_at: finished, finished_at: finished, rows: 120, problems: null, note: null, ...extra });

describe('planAlerts (thuần)', () => {
  let plan: (i: any) => any;
  beforeEach(() => { plan = loadGas({ now: '2026-10-25T07:20:00Z' }).sb.planAlerts; });
  const base = { ptNow: '2026-10-25 00:20', vnNow: '2026-10-25 14:20', nowMs: Date.parse('2026-10-25T07:20:00Z') };

  it('sync vừa xong → báo 1 lần, lần sau không báo lại', () => {
    const runs = [okRun('r1', '2026-10-24', '2026-10-25T07:08:00Z')];
    const a = plan({ ...base, runs, state: {} });
    expect(a.actions.map((x: any) => x.type)).toEqual(['sync_ok']);
    expect(plan({ ...base, runs, state: a.state }).actions).toEqual([]);
  });
  it('sync bị từ chối → báo lỗi', () => {
    const runs = [okRun('r1', '2026-10-24', '2026-10-25T07:08:00Z', { status: 'rejected' })];
    expect(plan({ ...base, runs, state: {} }).actions.map((x: any) => x.type)).toEqual(['sync_failed']);
  });
  it('lần sync cũ (lúc mới cài bot) → không báo', () => {
    expect(plan({ ...base, runs: [okRun('r0', '2026-10-22', '2026-10-23T07:08:00Z')], state: {} }).actions).toEqual([]);
  });
  it('giờ yên lặng 22:00–08:00 VN → không gửi gì', () => {
    const runs = [okRun('r1', '2026-10-24', '2026-10-25T07:08:00Z')];
    expect(plan({ ...base, vnNow: '2026-10-25 23:10', runs, state: {} }).actions).toEqual([]);
  });
  it('PDT 15:30 VN (01:30 PT) chưa có sync → báo "chưa chạy" đúng 1 lần', () => {
    const t = { ptNow: '2026-10-25 01:30', vnNow: '2026-10-25 15:30', nowMs: Date.parse('2026-10-25T08:30:00Z') };
    const a = plan({ ...t, runs: [], state: {} });
    expect(a.actions).toEqual([{ type: 'sync_missing', targetDate: '2026-10-24' }]);
    expect(plan({ ...t, runs: [], state: a.state }).actions).toEqual([]);
  });
  it('PST: 15:30 VN mới là 00:30 PT → chưa báo; 16:30 VN (01:30 PT) mới báo', () => {
    const early = { ptNow: '2026-11-03 00:30', vnNow: '2026-11-03 15:30', nowMs: Date.parse('2026-11-03T08:30:00Z') };
    expect(plan({ ...early, runs: [], state: {} }).actions).toEqual([]);
    const late = { ptNow: '2026-11-03 01:30', vnNow: '2026-11-03 16:30', nowMs: Date.parse('2026-11-03T09:30:00Z') };
    expect(plan({ ...late, runs: [], state: {} }).actions).toEqual([{ type: 'sync_missing', targetDate: '2026-11-02' }]);
  });
  it('2 giờ sau sync chưa import → nhắc lần 2 đúng 1 lần; đã import → không nhắc', () => {
    const runs = [okRun('r1', '2026-10-24', '2026-10-25T07:08:00Z')];
    const t = { ptNow: '2026-10-25 02:10', vnNow: '2026-10-25 16:10', nowMs: Date.parse('2026-10-25T09:10:00Z') };
    const state = { notified: ['r1'] };
    const a = plan({ ...t, runs, state });
    expect(a.actions.map((x: any) => x.type)).toEqual(['import_reminder']);
    expect(plan({ ...t, runs, state: a.state }).actions).toEqual([]);
    const imported = [{ id: 'i1', kind: 'hubspot_import', status: 'ok', started_at: '2026-10-25T08:00:00Z', finished_at: '2026-10-25T08:00:00Z' }, ...runs];
    expect(plan({ ...t, runs: imported, state }).actions).toEqual([]);
  });
  it('chưa tới 2 giờ → chưa nhắc', () => {
    const runs = [okRun('r1', '2026-10-24', '2026-10-25T07:08:00Z')];
    const t = { ptNow: '2026-10-25 01:00', vnNow: '2026-10-25 15:00', nowMs: Date.parse('2026-10-25T08:00:00Z') };
    expect(plan({ ...t, runs, state: { notified: ['r1'] } }).actions).toEqual([]);
  });
});

describe('summarizeDay + alertText', () => {
  it('tóm tắt đúng ngày target, top đỏ theo spend, lời nhắc HubSpot', () => {
    const { sb } = loadGas({ now: '2026-10-25T07:20:00Z' });
    const s = sb.summarizeDay('2026-10-24', [
      { date: '2026-10-24', campaign_id: '1', spend: 100.5, leads_meta: 5, purchases_meta: 1 },
      { date: '2026-10-24', campaign_id: '2', spend: 20, leads_meta: 0, purchases_meta: 0 },
      { date: '2026-10-23', campaign_id: '1', spend: 999, leads_meta: 99 },
    ], [
      { as_of: '2026-10-24', color: 'red', type: 'burn', action: 'pause_ad', entity_id: '111', numbers: { spend: 30, baseline: 10, entity_name: 'Video ban doc_COLD' } },
      { as_of: '2026-10-24', color: 'red', type: 'burn', action: 'pause_ad', entity_id: '222', numbers: { spend: 60, baseline: 10, entity_name: 'Photo KV_COLD' } },
      { as_of: '2026-10-24', color: 'green', type: 'scale', action: 'increase_budget', entity_id: '333', numbers: { cpa_window: 7.5, below_baseline: 25, campaign_name: 'RES-SELLER-LEAD-SAC Jul 26' } },
    ]);
    expect(s).toMatchObject({ spend: 120.5, leads: 5, cpl: 24.1, campaigns: 2, counts: { red: 2, yellow: 0, green: 1 } });
    const text = sb.alertText({ type: 'sync_ok', run: okRun('r1', '2026-10-24', '2026-10-25T07:08:00Z') }, s);
    expect(text).toContain('Spend $120.50 · Lead 5 · CPL $24.10');
    expect(text).toContain('🔴 Photo KV_COLD · đã tiêu $60, 0 chuyển đổi (chuẩn $10) → Tắt ad');
    expect(text).toContain('🟢 RES-SELLER-LEAD-SAC Jul 26 · CPA $7.50 thấp hơn chuẩn 25% → Tăng budget +20%');
    expect(text).toContain('Sếp Nguyên ơi, xuất HubSpot nha');
  });
  it('tin lỗi nêu ngày lệch số', () => {
    const { sb } = loadGas({ now: '2026-10-25T07:20:00Z' });
    const text = sb.alertText({ type: 'sync_failed', run: okRun('r1', '2026-10-24', 'x', { status: 'rejected',
      problems: [{ date: '2026-10-23', ads_spend: 31.86, account_spend: 41.86, diff_ratio: 0.239 }] }) }, null);
    expect(text).toContain('2026-10-23: ads $31.86 vs tài khoản $41.86');
  });
});

describe('tick() đầu-cuối (sandbox Apps Script)', () => {
  it('đọc Supabase bằng token bot → gửi card E1 vào webhook Alerts → lưu trạng thái', () => {
    const { sb, posted, props, reads } = loadGas({
      now: '2026-10-25T07:20:00Z',
      db: {
        v_sync_status: [okRun('r1', '2026-10-24', '2026-10-25T07:08:00Z')],
        v_campaign_daily: [{ date: '2026-10-24', spend: 47.43, leads_meta: 3 }],
        v_signals_latest: [],
      },
    });
    sb.tick();
    expect(reads.every((r) => r.p_token === 't'.repeat(43))).toBe(true);
    expect(reads.map((r) => r.p_view)).toEqual(['v_sync_status', 'v_campaign_daily', 'v_signals_latest']);
    expect(posted.length).toBe(1);
    const card = posted[0].body.cardsV2[0].card;
    expect(card.header.title).toBe('🤖 Số Meta 2026-10-24');
    expect(JSON.stringify(card)).toContain('http://localhost:3100/import');
    expect(JSON.stringify(card)).toContain('Conversion Page');
    expect(JSON.parse(props.ALERT_STATE).notified).toEqual(['r1']);
    sb.tick();
    expect(posted.length).toBe(1); // không gửi trùng
  });
  it('webhook lỗi → không lưu trạng thái (lần sau gửi lại)', () => {
    const g = loadGas({ now: '2026-10-25T07:20:00Z', db: { v_sync_status: [okRun('r1', '2026-10-24', '2026-10-25T07:08:00Z', { status: 'error', note: 'boom' })] } });
    g.sb.UrlFetchApp.fetch = (url: string) => {
      if (url.includes('bot_read')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify([okRun('r1', '2026-10-24', '2026-10-25T07:08:00Z', { status: 'error', note: 'boom' })]) };
      return { getResponseCode: () => 500, getContentText: () => 'down' };
    };
    expect(() => g.sb.tick()).toThrow(/HTTP 500/);
    expect(g.props.ALERT_STATE).toBeUndefined();
  });
  it('người lạ gõ lệnh → từ chối lịch sự', () => {
    const { sb } = loadGas({ now: '2026-10-25T07:20:00Z' });
    const r = sb.onMessage({ chat: { user: { email: 'stranger@gmail.com' } } });
    expect(r.hostAppDataAction.chatDataAction.createMessageAction.message.text).toMatch(/chỉ làm việc với sếp Nguyên/);
  });
});
