/**
 * Soát chính sách quảng cáo (lệnh /audit). Phần CHẮC CHẮN được code tính (targeting của SAC, cụm hứa hẹn thu nhập, link ngoài phạm vi);
 * Claude chỉ soát phần cần đọc hiểu (nội dung chữ, landing page) và diễn giải, không được đổi màu kết luận của code.
 * Hàm thuần, không dùng URL / Intl / Node API nên bundle chạy được trong Apps Script.
 */

/** Chỉ audit landing page thuộc các domain này (kèm mọi subdomain). */
export const AUDIT_DOMAINS = ['evancoaching.net', 'evancoaching.com'] as const;

export type AuditSeverity = 'red' | 'yellow' | 'info' | 'green';
export interface AuditFinding { severity: AuditSeverity; code: string; message: string; quote?: string }
export type LpScope = 'in' | 'out' | 'none';

export interface AdAuditInput {
  ad_id: string; ad_name?: string | null; campaign_name?: string | null; objective?: string | null; is_sac?: boolean | null;
  targeting_summary?: Record<string, any> | null;
  title?: string | null; body?: string | null; link_url?: string | null; cta?: string | null;
}
export interface AdAudit { adId: string; adName: string; isSac: boolean; findings: AuditFinding[]; lp: { url: string | null; scope: LpScope } }

/** Phạm vi của 1 link: trong danh sách domain (kèm subdomain), ngoài, hoặc không có / không hợp lệ. */
export function lpScope(url: string | null | undefined): LpScope {
  const s = String(url ?? '').trim();
  if (!s) return 'none';
  const m = /^https?:\/\/([^/?#]+)([/?#].*)?$/i.exec(s);
  if (!m || s.length > 250) return 'none';
  const authority = m[1];
  if (authority.includes('@')) return 'out'; // userinfo: dấu hiệu lừa domain (evancoaching.net@evil.com)
  const host = authority.replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return 'out'; // domain ký tự lạ (homograph)
  return AUDIT_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)) ? 'in' : 'out';
}

const num = (v: unknown): number | null => { const x = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(x) ? null : x; };
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Targeting của campaign SAC (Housing): tuổi 18–65+, mọi giới tính, không mã bưu chính, bán kính ≥ 15 dặm, không Lookalike. */
export function auditSacTargeting(t: Record<string, any> | null | undefined): AuditFinding[] {
  if (!t || typeof t !== 'object') return [{ severity: 'yellow', code: 'SAC_NO_TARGETING', message: 'Chưa có dữ liệu targeting của adset, không soát được các giới hạn SAC. Sync lại số Meta rồi audit lại.' }];
  const out: AuditFinding[] = [];
  const min = num(t.age_min), max = num(t.age_max);
  if (min !== null && min > 18) out.push({ severity: 'red', code: 'SAC_AGE_MIN', message: `Targeting tuổi từ ${min} trở lên. Campaign SAC bắt buộc từ 18 tuổi.`, quote: `age_min=${min}` });
  if (max !== null && max < 65) out.push({ severity: 'red', code: 'SAC_AGE_MAX', message: `Targeting tuổi tối đa ${max}. Campaign SAC bắt buộc tới 65+.`, quote: `age_max=${max}` });
  const genders = list(t.genders).map(String);
  if (genders.length && !(genders.includes('1') && genders.includes('2'))) {
    out.push({ severity: 'red', code: 'SAC_GENDER', message: 'Targeting theo giới tính. Campaign SAC không được nhắm theo giới tính.', quote: `genders=${genders.join(',')}` });
  }
  const zips = num(t.zips_count);
  if (zips && zips > 0) out.push({ severity: 'red', code: 'SAC_ZIP', message: `Targeting theo ${zips} mã bưu chính. Campaign SAC không được nhắm theo mã bưu chính.`, quote: `zips_count=${zips}` });
  for (const c of list(t.cities) as Record<string, any>[]) {
    const r = num(c?.radius);
    if (r === null) continue;
    const unit = String(c?.distance_unit || 'mile');
    const miles = unit.toLowerCase().startsWith('k') ? r / 1.609 : r;
    if (miles < 15) out.push({ severity: 'red', code: 'SAC_RADIUS', message: `Bán kính ${r} ${unit} quanh ${c?.name || 'một thành phố'} (nhỏ hơn 15 dặm). Campaign SAC yêu cầu tối thiểu 15 dặm.`, quote: `${c?.name || ''} ${r} ${unit}`.trim() });
  }
  if (t.has_lookalike) out.push({ severity: 'red', code: 'SAC_LOOKALIKE', message: 'Có audience Lookalike. Campaign SAC không được dùng Lookalike.' });
  if (list(t.interests).length || list(t.behaviors).length) {
    out.push({ severity: 'yellow', code: 'SAC_DETAILED', message: 'Có Detailed targeting (sở thích / hành vi). Với SAC, nhiều lựa chọn bị giới hạn. Anh kiểm tra từng mục trong Ads Manager.' });
  }
  if (!out.length) out.push({ severity: 'green', code: 'SAC_TARGETING_OK', message: 'Targeting đúng các giới hạn SAC code kiểm được (tuổi 18–65+, giới tính, mã bưu chính, bán kính, Lookalike).' });
  return out;
}

const COPY_RULES: { re: RegExp; severity: AuditSeverity; code: string; message: string }[] = [
  { re: /(chắc chắn|đảm bảo|cam kết|guarantee[d]?)[^.!?\n]{0,40}(kiếm|thu nhập|lợi nhuận|doanh thu|income|profit|return|earn|\$\s?\d[\d,.]*)/i, severity: 'red', code: 'COPY_INCOME_GUARANTEE', message: 'Hứa hẹn thu nhập / lợi nhuận chắc chắn. Meta coi là tuyên bố gây hiểu lầm.' },
  { re: /(thu nhập thụ động|passive income)[^.!?\n]{0,40}(không rủi ro|risk[- ]?free|no risk)/i, severity: 'red', code: 'COPY_NO_RISK', message: 'Khẳng định không rủi ro về thu nhập.' },
  { re: /(giàu nhanh|get rich quick|làm giàu trong\s+\d+\s*(ngày|tuần|tháng)|không cần (kinh nghiệm|vốn))/i, severity: 'yellow', code: 'COPY_GET_RICH', message: 'Cụm từ kiểu "giàu nhanh / không cần kinh nghiệm" hay bị Meta từ chối.' },
  { re: /(before\s*(\/|and|&)\s*after|trước\s*(\/|và)\s*sau)/i, severity: 'yellow', code: 'COPY_BEFORE_AFTER', message: 'Nội dung kiểu before / after có thể vi phạm chính sách tuyên bố kết quả.' },
  { re: /(?<![\p{L}])(bạn|you)(?![\p{L}])[^.!?\n]{0,15}(?<![\p{L}])(đang|are|have|đã)(?![\p{L}])[^.!?\n]{0,25}(?<![\p{L}])(nợ|debt|bankrupt|phá sản|ly hôn|divorce[d]?|mẹ đơn thân|single (mom|mother|dad)|thất nghiệp|unemployed)/iu, severity: 'yellow', code: 'COPY_PERSONAL_ATTR', message: 'Câu khẳng định thuộc tính cá nhân của người xem (tài chính, gia đình, việc làm).' },
];
const HOUSING_RE = /(bất động sản|real estate|nhà ở|housing|mortgage|vay mua nhà|home\s?buyer|\bseller\b|\bbuyer\b|investor|đầu tư nhà)/i;

export function auditCopy(i: AdAuditInput): AuditFinding[] {
  const text = [i.title, i.body].filter(Boolean).join('\n');
  const out: AuditFinding[] = [];
  for (const r of COPY_RULES) {
    const m = r.re.exec(text);
    if (!m) continue;
    // Với SAC, thuộc tính cá nhân là vi phạm thật (không chỉ cảnh báo)
    const severity: AuditSeverity = r.code === 'COPY_PERSONAL_ATTR' && i.is_sac ? 'red' : r.severity;
    out.push({ severity, code: r.code, message: r.message, quote: m[0].slice(0, 120) });
  }
  if (!i.is_sac && HOUSING_RE.test(`${i.campaign_name ?? ''} ${text}`) && !/\bSAC\b/i.test(i.campaign_name ?? '')) {
    out.push({ severity: 'yellow', code: 'SAC_MAYBE_MISSING', message: 'Nội dung liên quan nhà ở / bất động sản nhưng tên campaign không có token SAC. Anh kiểm tra khai báo Special Ad Category.' });
  }
  return out;
}

const ORDER: Record<AuditSeverity, number> = { red: 0, yellow: 1, info: 2, green: 3 };

export function auditAd(i: AdAuditInput): AdAudit {
  const findings: AuditFinding[] = [];
  const isSac = !!i.is_sac;
  if (isSac) findings.push(...auditSacTargeting(i.targeting_summary));
  findings.push(...auditCopy(i));
  const scope = lpScope(i.link_url);
  if (scope === 'out') findings.push({ severity: 'info', code: 'LP_OUT_OF_SCOPE', message: 'Landing page ngoài phạm vi audit (chỉ evancoaching.net / evancoaching.com). Em không đọc trang này.', quote: String(i.link_url).slice(0, 120) });
  if (scope === 'none') findings.push({ severity: 'yellow', code: 'LP_MISSING', message: 'Ad không có link landing page hợp lệ.' });
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return { adId: i.ad_id, adName: i.ad_name ?? i.ad_id, isSac, findings, lp: { url: scope === 'in' ? String(i.link_url).trim() : null, scope } };
}

export function countFindings(audits: AdAudit[]): { red: number; yellow: number; green: number } {
  const c = { red: 0, yellow: 0, green: 0 };
  for (const a of audits) for (const f of a.findings) { if (f.severity === 'red') c.red++; else if (f.severity === 'yellow') c.yellow++; else if (f.severity === 'green') c.green++; }
  return c;
}
