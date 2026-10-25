/**
 * Đọc export HubSpot NGAY TRÊN MÁY (trình duyệt hoặc CLI) và trả về dữ liệu KHÔNG có PII.
 * Đã kiểm tra trên 3 file thật (24/10/2026):
 *   ① Form submissions: Conversion ID · Conversion Date · Conversion Page (URL tracking) · Contact ID (+ cột tên/email/SĐT → bỏ)
 *   ② Deals: Record ID · Deal Name (chỉ đọc tại chỗ) · Deal Stage · Amount · Create/Close Date · Associated Contact IDs
 *   ③ Contacts (dự phòng): Record ID · Associated Deal IDs
 */
import { configValue, defaultConfig, type Config } from './config';
import { assertNoPii } from './mask';
import { DEFAULT_AUDIT_DOMAINS } from './time';
import { num } from './util';

export type FileKind = 'submissions' | 'deals' | 'contacts' | 'unknown';
export type Raw = Record<string, string>;

/** CSV → mảng object theo header. Hỗ trợ ngoặc kép, dấu phẩy và xuống dòng trong ô, BOM. */
export function parseCsv(text: string): { header: string[]; rows: Raw[] } {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...data] = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
  return { header, rows: data.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export function detectFileKind(header: string[]): FileKind {
  const h = new Set(header);
  if (h.has('Conversion Page') && h.has('Contact ID')) return 'submissions';
  if (h.has('Deal Stage') && h.has('Record ID')) return 'deals';
  if (h.has('Associated Deal IDs') && h.has('Record ID')) return 'contacts';
  return 'unknown';
}

/** Cột chứa ID bị Excel đổi sang dạng khoa học (2.57478E+11) → không ghép được, phải export lại. */
export function findScientificIds(rows: Raw[]): string[] {
  const cols = new Set<string>();
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (/^\d(\.\d+)?E\+\d+$/i.test(v)) cols.add(k);
  return [...cols];
}

/** Cột luôn bỏ, không bao giờ gửi đi. */
export const ALWAYS_DROP = /^(first name|last name|phone number|email|contact first name|contact last name|contact email|contact owner|deal owner|associated contact|associated deal|deal name|associated invoice)$/i;

/** 'YYYY-MM-DD HH:mm' hoặc 'M/D/YYYY H:mm' → 'YYYY-MM-DD'. */
export function parseHubspotDate(s: string | undefined): string {
  const v = String(s || '').trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return '';
}

export interface Attribution {
  ad_id: string | null; adset_id: string | null; campaign_id: string | null;
  placement: string | null; platform: string | null; page_path: string | null;
  source_hint: 'tracked' | 'direct' | 'test' | 'invalid';
}

/** URL Conversion Page → nguồn quảng cáo. Thứ tự: h_ad_id→hsa_ad, fbc_id→hsa_grp, utm_id→hsa_cam. */
export function parseConversionPage(url: string, auditDomains: string[] = DEFAULT_AUDIT_DOMAINS): Attribution {
  let u: URL;
  try { u = new URL(url); } catch {
    return { ad_id: null, adset_id: null, campaign_id: null, placement: null, platform: null, page_path: null, source_hint: 'invalid' };
  }
  const p = u.searchParams;
  const pickId = (...keys: string[]) => keys.map((k) => p.get(k)).find((v) => !!v && /^\d{10,20}$/.test(v)) || null;
  const host = u.hostname.toLowerCase();
  const ownHost = auditDomains.some((d) => host === d || host.endsWith(`.${d}`));
  const ad_id = pickId('h_ad_id', 'hsa_ad');
  return {
    ad_id,
    adset_id: pickId('fbc_id', 'hsa_grp'),
    campaign_id: pickId('utm_id', 'hsa_cam'),
    placement: p.get('utm_medium') || null,
    platform: p.get('utm_source') || null,
    page_path: u.pathname,
    source_hint: !ownHost ? 'test' : ad_id ? 'tracked' : 'direct',
  };
}

export type DealType = 'seat' | 'program' | 'test' | 'unknown';

/** Phân loại deal (PRD B1.0). `nameLocalOnly` chỉ dùng tại chỗ, không được trả ra ngoài. */
export function classifyDeal(nameLocalOnly: string, amount: string | number, stage: string, config: Config = defaultConfig(), scope?: string):
  { deal_type: DealType; is_won: boolean } {
  const cv = (k: string) => configValue(config, k, scope);
  const a = num(amount);
  const hasAmount = String(amount ?? '').trim() !== '';
  const keyword = String(cv('seat_keyword') || 'Webinar');
  if (hasAmount && a < Number(cv('seat_min_amount'))) return { deal_type: 'test', is_won: false };
  if (new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(nameLocalOnly || '')
    || (hasAmount && a >= Number(cv('seat_min_amount')) && a <= Number(cv('seat_max_amount')))) {
    return { deal_type: 'seat', is_won: stage !== String(cv('seat_lost_stage')) };
  }
  if (a >= Number(cv('program_min_amount'))) return { deal_type: 'program', is_won: stage === String(cv('program_won_stage')) };
  return { deal_type: 'unknown', is_won: false };
}

export interface CleanSubmission extends Attribution { conversion_id: string; contact_id: string | null; converted_on: string }
export interface CleanDeal { deal_id: string; contact_ids: string[]; deal_stage: string; amount: number; created_on: string; closed_on: string; deal_type: DealType; is_won: boolean }

const splitIds = (s: string | undefined) => String(s || '').split(';').map((x) => x.trim()).filter(Boolean);

export function cleanSubmissions(rows: Raw[], auditDomains?: string[]): CleanSubmission[] {
  return rows.map((r) => ({
    conversion_id: r['Conversion ID'],
    contact_id: r['Contact ID'] || null,
    converted_on: parseHubspotDate(r['Conversion Date']),
    ...parseConversionPage(r['Conversion Page'], auditDomains),
  }));
}

export function cleanDeals(rows: Raw[], config?: Config, scope?: string, contactIdsByDeal: Record<string, string[]> = {}): CleanDeal[] {
  return rows.map((r) => {
    const contactIds = splitIds(r['Associated Contact IDs']);
    const ids = contactIds.length ? contactIds : contactIdsByDeal[r['Record ID']] || [];
    // Contact ID quá ngắn (vd "1501") = contact thử nghiệm nội bộ
    const testContact = ids.length > 0 && ids.every((id) => id.length < 6);
    const cls = testContact ? { deal_type: 'test' as const, is_won: false } : classifyDeal(r['Deal Name'] || '', r['Amount'] ?? '', r['Deal Stage'] || '', config, scope);
    return {
      deal_id: r['Record ID'], contact_ids: ids, deal_stage: r['Deal Stage'] || '', amount: num(r['Amount']),
      created_on: parseHubspotDate(r['Create Date']), closed_on: parseHubspotDate(r['Close Date']), ...cls,
    };
  });
}

/** File ③ Contacts (dự phòng) → { dealId: [contactId] }. */
export function contactIdsByDealFromContacts(rows: Raw[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) for (const d of splitIds(r['Associated Deal IDs'])) (out[d] ||= []).push(r['Record ID']);
  return out;
}

export interface CrmAggregate { ad_id: string | null; adset_id: string | null; campaign_id: string | null; registrations: number; seats: number; seat_revenue: number; programs: number; program_revenue: number }
export interface CrmImportResult {
  range: { from: string; to: string };
  leads: (CleanSubmission & { attribution: 'first_touch' | 'last_touch' })[];
  deals: CleanDeal[];
  totals: {
    submissions: number; test_submissions: number; unique_contacts: number; tracked_contacts: number;
    deals: number; deals_by_type: Partial<Record<DealType, number>>; won_seats: number; won_programs: number;
    won_seats_matched: number; won_programs_matched: number;
  };
  by_ad: CrmAggregate[];
  by_placement: Record<string, { registrations: number; seats: number }>;
  campaigns_seen: string[];
  registrations_by_day: Record<string, number>;
  seats_by_day: Record<string, number>;
}

/**
 * Ghép lượt đăng ký với deal và tổng hợp. Mỗi contact gắn 1 lượt đăng ký:
 * first_touch = lượt có tracking sớm nhất (mặc định), last_touch = lượt có tracking muộn nhất.
 */
export function buildCrmImport(subs: CleanSubmission[], deals: CleanDeal[], config: Config = defaultConfig()): CrmImportResult {
  const model = String(config.global.attribution_model || 'first_touch') as 'first_touch' | 'last_touch';
  const sorted = [...subs].sort((a, b) => a.converted_on.localeCompare(b.converted_on));
  if (model === 'last_touch') sorted.reverse();
  const byContact: Record<string, CleanSubmission> = {};
  for (const s of sorted) {
    if (!s.contact_id || s.source_hint === 'test' || s.source_hint === 'invalid') continue;
    const cur = byContact[s.contact_id];
    if (!cur || (cur.source_hint !== 'tracked' && s.source_hint === 'tracked')) byContact[s.contact_id] = s;
  }
  const leads = Object.values(byContact).map((l) => ({ ...l, attribution: model }));

  const wonByContact: Record<string, CleanDeal[]> = {};
  for (const d of deals.filter((x) => x.is_won)) for (const id of d.contact_ids) (wonByContact[id] ||= []).push(d);

  const agg: Record<string, CrmAggregate> = {};
  const placement: Record<string, { registrations: number; seats: number }> = {};
  for (const l of leads) {
    const key = l.ad_id || 'unattributed';
    const row = (agg[key] ||= { ad_id: l.ad_id, adset_id: l.adset_id, campaign_id: l.campaign_id, registrations: 0, seats: 0, seat_revenue: 0, programs: 0, program_revenue: 0 });
    row.registrations++;
    const won = wonByContact[l.contact_id as string] || [];
    for (const d of won) {
      if (d.deal_type === 'seat') { row.seats++; row.seat_revenue += d.amount; }
      if (d.deal_type === 'program') { row.programs++; row.program_revenue += d.amount; }
    }
    if (l.source_hint === 'tracked' && l.placement) {
      const pl = (placement[l.placement] ||= { registrations: 0, seats: 0 });
      pl.registrations++;
      pl.seats += won.filter((d) => d.deal_type === 'seat').length;
    }
  }

  const wonSeats = deals.filter((d) => d.deal_type === 'seat' && d.is_won);
  const wonPrograms = deals.filter((d) => d.deal_type === 'program' && d.is_won);
  const matched = (list: CleanDeal[]) => list.filter((d) => d.contact_ids.some((id) => byContact[id])).length;
  const dates = leads.map((l) => l.converted_on).filter(Boolean).sort();
  const count = <T>(list: T[], key: (x: T) => string) => list.reduce<Record<string, number>>((m, x) => ((m[key(x)] = (m[key(x)] || 0) + 1), m), {});

  const result: CrmImportResult = {
    range: { from: dates[0] || '', to: dates[dates.length - 1] || '' },
    leads,
    deals,
    totals: {
      submissions: subs.length,
      test_submissions: subs.filter((s) => s.source_hint === 'test').length,
      unique_contacts: leads.length,
      tracked_contacts: leads.filter((l) => l.source_hint === 'tracked').length,
      deals: deals.length,
      deals_by_type: count(deals, (d) => d.deal_type),
      won_seats: wonSeats.length,
      won_programs: wonPrograms.length,
      won_seats_matched: matched(wonSeats),
      won_programs_matched: matched(wonPrograms),
    },
    by_ad: Object.values(agg).sort((a, b) => b.registrations - a.registrations),
    by_placement: placement,
    campaigns_seen: [...new Set(leads.map((l) => l.campaign_id).filter((x): x is string => !!x))],
    registrations_by_day: count(leads, (l) => l.converted_on),
    seats_by_day: count(wonSeats, (d) => d.created_on),
  };
  assertNoPii(result, 'Kết quả import HubSpot');
  return result;
}

export interface ImportFiles { submissions?: string; deals?: string; contacts?: string }

/** Điểm vào chung cho Web (trình duyệt) và CLI: nhận nội dung text của các file, trả kết quả sạch hoặc lỗi rõ ràng. */
export function importHubspotFiles(files: ImportFiles, config: Config = defaultConfig(), scope?: string): CrmImportResult {
  const read = (text: string | undefined, expect: FileKind) => {
    if (!text) return null;
    const { header, rows } = parseCsv(text);
    const kind = detectFileKind(header);
    if (kind !== expect) throw new Error(`File ${expect} không đúng định dạng (nhận diện là: ${kind}).`);
    const sci = findScientificIds(rows);
    if (sci.length) throw new Error(`File ${expect} có ID dạng khoa học ở cột ${sci.join(', ')} — file đã bị Excel lưu lại. Export lại và KHÔNG mở bằng Excel.`);
    return rows;
  };
  const subsRows = read(files.submissions, 'submissions');
  if (!subsRows) throw new Error('Thiếu file Form submissions (bắt buộc).');
  const dealRows = read(files.deals, 'deals') || [];
  const contactRows = read(files.contacts, 'contacts') || [];
  const audit = String(config.global.audit_domains || DEFAULT_AUDIT_DOMAINS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  return buildCrmImport(cleanSubmissions(subsRows, audit), cleanDeals(dealRows, config, scope, contactIdsByDealFromContacts(contactRows)), config);
}
