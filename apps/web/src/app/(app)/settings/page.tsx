import { defaultConfig } from '@cohort/core';
import { getWorkspace } from '@/lib/server-data';
import { createClient } from '@/lib/supabase/server';
import { revokeShare } from '../p/[slug]/share-actions';
import { fmtDay, fmtInt, fmtVnTime } from '@/lib/format';
import { Chip, PageHead } from '@/components/ui';

export const metadata = { title: 'Cài đặt & sync log' };

const STATUS: Record<string, 'crm' | 'warn' | 'burn' | ''> = { ok: 'crm', running: '', rejected: 'burn', error: 'burn', skipped: '' };
const KIND: Record<string, string> = { meta: 'Meta daily', meta_backfill: 'Meta backfill', hubspot: 'HubSpot' };
const THRESHOLDS: [string, string][] = [
  ['baseline_days', 'Số ngày tính mốc chuẩn của campaign'], ['account_baseline_days', 'Số ngày mốc chuẩn toàn tài khoản'], ['eval_window_days', 'Cửa sổ đánh giá (ngày)'],
  ['burn_cpl_multiple', 'Đốt tiền: spend ≥ N × CPL chuẩn mà 0 lead'], ['burn_cpa_seat_multiple', 'Đốt tiền: spend ≥ N × CPA seat chuẩn mà 0 seat'],
  ['fatigue_frequency', 'Mỏi: frequency 7 ngày vượt'], ['fatigue_red_frequency', 'Mỏi nặng (đỏ): frequency vượt'], ['scale_cpl_ratio', 'Scale: CPL ≤ X × chuẩn'],
  ['scale_min_hours_since_budget', 'Scale: tối thiểu giờ kể từ đổi budget'], ['learning_hold_hours', 'Learning: giữ N giờ sau thay đổi lớn'],
  ['import_spend_tolerance', 'Sync: sai lệch spend tối đa'], ['meta_stale_hours', 'Cảnh báo Meta cũ sau (giờ)'], ['crm_stale_hours', 'Cảnh báo CRM cũ sau (giờ)'],
  ['seat_keyword', 'Deal seat: từ khóa trong Deal Name'], ['seat_min_amount', 'Deal seat: Amount từ'], ['seat_max_amount', 'Deal seat: Amount đến'], ['program_min_amount', 'Deal program: Amount từ'],
  ['audit_domains', 'Domain landing page được audit'],
];

export default async function SettingsPage() {
  const ws = await getWorkspace();
  const { data: shares } = await (await createClient()).from('shares').select('token,title,hide_money,created_at,expires_at,revoked_at,view_count').order('created_at', { ascending: false }).limit(30);
  const now = Date.now();
  const cfg = defaultConfig().global;
  return (
    <>
      <PageHead title="Cài đặt & sync log" meta="Chỉ đọc. Ngưỡng sửa trong bảng app_config (Supabase) hoặc packages/core/src/config.ts." />

      <h2 className="section-title" id="sync">Lịch sử sync Meta <small>30 lần gần nhất</small></h2>
      <div className="panel tight tablewrap">
        <table className="data">
          <thead><tr><th className="l" style={{ cursor: 'default' }}>Loại</th><th className="l" style={{ cursor: 'default' }}>Ngày PT</th><th className="l" style={{ cursor: 'default' }}>Trạng thái</th><th style={{ cursor: 'default' }}>Dòng</th><th className="l" style={{ cursor: 'default' }}>Bắt đầu (giờ VN)</th><th className="l" style={{ cursor: 'default' }}>Ghi chú / lỗi</th></tr></thead>
          <tbody>
            {ws.syncRuns.length === 0 && <tr><td className="l" colSpan={6} style={{ textAlign: 'center' }}>Chưa có lần sync nào.</td></tr>}
            {ws.syncRuns.map((r) => (
              <tr key={r.id}>
                <td className="l">{KIND[r.kind] ?? r.kind}</td>
                <td className="l">{r.date_from && r.date_to && r.date_from !== r.date_to ? `${fmtDay(r.date_from)} → ${fmtDay(r.date_to)}` : fmtDay(r.target_date)}</td>
                <td className="l"><Chip tone={STATUS[r.status] ?? ''}>{r.status}</Chip></td>
                <td className="n">{fmtInt(r.rows)}</td>
                <td className="l">{fmtVnTime(r.started_at)}</td>
                <td className="l" style={{ whiteSpace: 'normal', maxWidth: 520, color: 'var(--muted)' }}>
                  {r.status === 'rejected' && Array.isArray(r.problems)
                    ? r.problems.slice(0, 3).map((p: Record<string, unknown>) => (p.ads_spend !== undefined ? `${p.date}: ads $${p.ads_spend} vs tài khoản $${p.account_spend}` : String(p.reason ?? 'lỗi'))).join('; ')
                    : r.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Lịch sử import HubSpot</h2>
      <div className="panel tight">
        <table className="data">
          <thead><tr><th className="l" style={{ cursor: 'default' }}>Lúc (giờ VN)</th><th className="l" style={{ cursor: 'default' }}>Form</th><th style={{ cursor: 'default' }}>Lượt đăng ký</th><th style={{ cursor: 'default' }}>Deal</th><th style={{ cursor: 'default' }}>% gắn ad</th><th className="l" style={{ cursor: 'default' }}>Khoảng</th></tr></thead>
          <tbody>
            {ws.imports.length === 0 && <tr><td className="l" colSpan={6} style={{ textAlign: 'center' }}>Chưa import lần nào.</td></tr>}
            {ws.imports.map((i) => (
              <tr key={i.id}><td className="l">{fmtVnTime(i.imported_at)}</td><td className="l mono">{i.form_name ?? '—'}</td><td className="n">{fmtInt(i.submissions_rows)}</td><td className="n">{fmtInt(i.deals_rows)}</td><td className="n">{i.tracked_pct ?? '—'}%</td><td className="l">{fmtDay(i.date_from)} → {fmtDay(i.date_to)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title" id="shares">Link chia sẻ <small>thu hồi bất cứ lúc nào</small></h2>
      <div className="panel tight">
        <table className="data">
          <thead><tr><th className="l" style={{ cursor: 'default' }}>Báo cáo</th><th className="l" style={{ cursor: 'default' }}>Tạo lúc</th><th className="l" style={{ cursor: 'default' }}>Hết hạn</th><th style={{ cursor: 'default' }}>Lượt xem</th><th className="l" style={{ cursor: 'default' }}>Trạng thái</th><th className="l" style={{ cursor: 'default' }}> </th></tr></thead>
          <tbody>
            {(shares ?? []).length === 0 && <tr><td className="l" colSpan={6} style={{ textAlign: 'center' }}>Chưa có link nào.</td></tr>}
            {(shares ?? []).map((sh) => {
              const dead = !!sh.revoked_at || new Date(sh.expires_at).getTime() <= now;
              return (
                <tr key={sh.token}>
                  <td className="l" style={{ whiteSpace: 'normal' }}>{sh.title}{sh.hide_money && <> <Chip>ẩn tiền</Chip></>}<div className="mono" style={{ color: 'var(--faint)' }}>…{String(sh.token).slice(-6)}</div></td>
                  <td className="l">{fmtVnTime(sh.created_at)}</td><td className="l">{fmtVnTime(sh.expires_at)}</td><td className="n">{fmtInt(sh.view_count)}</td>
                  <td className="l"><Chip tone={dead ? 'burn' : 'crm'}>{sh.revoked_at ? 'đã thu hồi' : dead ? 'hết hạn' : 'đang hiệu lực'}</Chip></td>
                  <td className="l">{!dead && <form action={revokeShare}><input type="hidden" name="token" value={sh.token} /><button type="submit" className="ghost" style={{ margin: 0, width: 'auto', padding: '3px 10px', fontSize: 12 }}>Thu hồi</button></form>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Ngưỡng đang dùng <small>mặc định của hệ thống</small></h2>
      <div className="panel tight">
        <table className="data"><tbody>
          {THRESHOLDS.map(([k, label]) => (
            <tr key={k}><td className="l" style={{ color: 'var(--muted)' }}>{label}</td><td className="n mono" style={{ textAlign: 'right' }}>{String(cfg[k])}</td></tr>
          ))}
        </tbody></table>
      </div>
    </>
  );
}
