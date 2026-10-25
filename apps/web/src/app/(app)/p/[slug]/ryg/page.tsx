import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Row } from '@cohort/core';
import { createClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/server-data';
import { loadReport } from '@/lib/data';
import { filterQuery, parseFilters } from '@/lib/filters';
import { fmtMoney, fmtPct } from '@/lib/format';
import { Banner, Chip, Light, PageHead } from '@/components/ui';

export const metadata = { title: 'Đèn RYG' };

type Color = 'red' | 'yellow' | 'green' | 'grey';
const ACTION: Record<string, string> = {
  pause_ad: 'Tắt ad', replace_creative: 'Thay creative', increase_budget: 'Tăng budget +20%', hold: 'Giữ nguyên, chưa chạm (đang learning)',
  wait: 'Chờ budget ổn định', trust_crm: 'Tin số CRM, Meta đang báo dư', wait_for_data: 'Chờ thêm dữ liệu', watch: 'Theo dõi',
};
const TYPE: Record<string, string> = {
  burn: 'Đốt tiền', fatigue: 'Creative mỏi', learning: 'Đang learning', budget_wait: 'Vừa đổi budget', scale: 'Có thể scale', overreport: 'Meta over-report', insufficient: 'Thiếu dữ liệu',
};
const BASE: Record<string, string> = { target: 'target Project', campaign: 'trung vị 14 ngày của campaign', account: 'trung vị 30 ngày của tài khoản', none: 'chưa có mốc' };
const ORDER: Record<Color, number> = { red: 0, yellow: 1, green: 2, grey: 3 };

/** Giải thích con số lý do bằng lời, chỉ dùng số có trong tín hiệu. */
function reason(s: Row): string {
  const n = s.numbers || {};
  switch (s.type) {
    case 'burn': return `Tiêu ${fmtMoney(n.spend)} trong ${n.days ?? 3} ngày, 0 chuyển đổi (mốc ${fmtMoney(n.baseline)})`;
    case 'fatigue': return `Frequency 7 ngày ${n.frequency_7d}, CTR giảm ${fmtPct(n.ctr_drop)}${n.cpa_7d != null ? `, CPA 7 ngày ${fmtMoney(n.cpa_7d)}` : ''}`;
    case 'scale': return `CPA ${fmtMoney(n.cpa_window)} thấp hơn mốc ${fmtMoney(n.baseline)} (${fmtPct(n.below_baseline)}) suốt ${n.days} ngày${n.best_ad ? ` · ad tốt nhất: ${n.best_ad.ad_name}` : ''}`;
    case 'learning': return 'Adset vừa có thay đổi lớn, Meta đang học (< 72 giờ)';
    case 'budget_wait': return `Đổi budget ${n.hours_since_budget_change ?? '?'} giờ trước, cần ≥ ${n.hours_required} giờ`;
    case 'overreport': return `Meta báo ${n.purchases_meta_7d} purchase, CRM chỉ ${n.seats_crm_7d} seat (7 ngày)`;
    case 'insufficient': return n.reason === 'low_spend' ? `Mới tiêu ${fmtMoney(n.spend)}, chưa tới mốc ${fmtMoney(n.baseline)}` : 'Chưa đủ lead để tính mốc chuẩn';
    default: return '';
  }
}

export default async function RygPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const ws = await getWorkspace();
  const f = parseFilters(await searchParams, ws.latestDate);
  const loaded = await loadReport(await createClient(), ws, slug, f);
  if (!loaded) notFound();
  const { project, signals, signalsAsOf, entities, report } = loaded;
  const names = new Map<string, string>(entities.map((e) => [`${e.level}||${e.id}`, e.name as string]));
  const q = filterQuery(f);

  const rows = [...signals].sort((a, b) => ORDER[a.color as Color] - ORDER[b.color as Color] || Number(b.numbers?.spend ?? 0) - Number(a.numbers?.spend ?? 0));
  const counts = { red: 0, yellow: 0, green: 0, grey: 0 };
  rows.forEach((s) => { counts[s.color as Color] += 1; });

  return (
    <>
      <PageHead title="Đèn RYG" meta={<>{project.name} · tính cho ngày {signalsAsOf ?? '—'} · cửa sổ 3 ngày</>}
        right={<Link className="btn ghost" href={`/p/${slug}${q}`}>← Báo cáo</Link>} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {(['red', 'yellow', 'green', 'grey'] as Color[]).map((c) => (
          <div key={c} className="tile"><div className="lbl"><Light c={c} /> {{ red: 'Đỏ · hành động ngay', yellow: 'Vàng · theo dõi', green: 'Xanh · scale', grey: 'Xám · thiếu dữ liệu' }[c]}</div>
            <div className="v tnum">{counts[c]}</div></div>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="panel empty"><h3>Chưa có tín hiệu</h3><p>Tín hiệu được tính lại sau mỗi lần sync Meta.</p></div>
      ) : (
        <div className="panel tight tablewrap">
          <table className="data">
            <thead><tr><th className="l" style={{ cursor: 'default' }}>Đèn</th><th className="l" style={{ cursor: 'default' }}>Đối tượng</th><th className="l" style={{ cursor: 'default' }}>Tín hiệu</th><th className="l" style={{ cursor: 'default' }}>Hành động gợi ý</th><th className="l" style={{ cursor: 'default' }}>Con số lý do</th><th className="l hide-md" style={{ cursor: 'default' }}>Mốc so sánh</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const n = s.numbers || {};
                const name = n.entity_name || names.get(`${s.level}||${s.entity_id}`) || s.entity_id;
                return (
                  <tr key={`${s.level}-${s.entity_id}-${s.type}`}>
                    <td className="l"><Light c={s.color} /></td>
                    <td className="l" style={{ whiteSpace: 'normal', minWidth: 220 }}>
                      <b style={{ fontWeight: 600 }}>{name}</b>
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{s.level === 'ad' ? `ad · ${n.campaign_name ?? ''}` : 'campaign'}{n.concept ? ` · ${n.concept}` : ''}</div>
                    </td>
                    <td className="l"><Chip tone={s.color === 'red' ? 'burn' : s.color === 'yellow' ? 'warn' : s.color === 'green' ? 'crm' : ''}>{TYPE[s.type] ?? s.type}</Chip></td>
                    <td className="l">{ACTION[s.action] ?? s.action}</td>
                    <td className="l" style={{ whiteSpace: 'normal', minWidth: 260 }}>{reason(s)}</td>
                    <td className="l hide-md" style={{ color: 'var(--muted)' }}>{BASE[s.compared_to] ?? s.compared_to}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">Màu do code tính theo quy tắc cố định (PRD mục D); em/AI chỉ diễn giải, không đổi màu. Đèn chỉ là gợi ý, không có thao tác nào ghi vào tài khoản quảng cáo.</p>
      {signalsAsOf && !report.hasCrm && <Banner tone="meta">Chưa có CRM: mốc chuẩn dùng <b>CPL Meta</b>. Khi import HubSpot và đủ seat, campaign Sales sẽ chuyển sang đo bằng <b>CPA seat</b>.</Banner>}
    </>
  );
}
