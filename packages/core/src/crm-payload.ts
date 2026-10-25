/**
 * Kiểm tra payload CRM mà trình duyệt gửi lên server. KHÔNG tin client: kiểm lại từng trường theo đúng
 * ràng buộc của DB và quét PII trước khi ghi. Chỉ cho phép ID, nguồn quảng cáo, stage, amount.
 */
import { assertNoPii } from './mask';
import type { CleanDeal, CleanSubmission } from './hubspot';

export interface CrmPayload {
  project_id: string;
  form_name: string;
  submissions: CleanSubmission[];
  deals: CleanDeal[];
  add_campaigns: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^\d{6,25}$/;
const SHORT_ID = /^\d{1,25}$/;
const CONV_ID = /^[A-Za-z0-9-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HINTS = new Set(['tracked', 'direct', 'test', 'invalid']);
const DEAL_TYPES = new Set(['seat', 'program', 'test', 'unknown']);
export const MAX_ROWS = 20000;

const ok = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
const optId = (v: unknown, what: string) => ok(v === null || v === undefined || (typeof v === 'string' && ID.test(v)), `${what} không hợp lệ`);
const optText = (v: unknown, max: number, what: string) => ok(v === null || v === undefined || (typeof v === 'string' && v.length <= max && !v.includes('@')), `${what} không hợp lệ`);

/** Ném Error tiếng Việt nếu có bất kỳ dòng nào sai; trả về payload đã chuẩn hóa. */
export function validateCrmPayload(input: unknown): CrmPayload {
  ok(!!input && typeof input === 'object', 'Dữ liệu import trống');
  const p = input as Record<string, any>;
  ok(typeof p.project_id === 'string' && UUID.test(p.project_id), 'Project không hợp lệ');
  ok(typeof p.form_name === 'string' && p.form_name.trim().length >= 1 && p.form_name.length <= 200 && !p.form_name.includes('@'), 'Tên form phải có 1–200 ký tự');
  ok(Array.isArray(p.submissions) && p.submissions.length > 0, 'Không có lượt đăng ký nào để nhập');
  const rawDeals: any[] = Array.isArray(p.deals) ? p.deals : [];
  ok(p.submissions.length <= MAX_ROWS && rawDeals.length <= MAX_ROWS, `Quá ${MAX_ROWS} dòng, hãy chia nhỏ file`);
  const add: unknown[] = Array.isArray(p.add_campaigns) ? p.add_campaigns : [];
  ok(add.length <= 200 && add.every((c) => typeof c === 'string' && ID.test(c)), 'Campaign ID không hợp lệ');

  const seen = new Set<string>();
  const submissions: CleanSubmission[] = p.submissions.map((s: Record<string, any>, i: number) => {
    const at = `Lượt đăng ký #${i + 1}`;
    ok(!!s && typeof s.conversion_id === 'string' && CONV_ID.test(s.conversion_id), `${at}: Conversion ID không hợp lệ`);
    ok(!seen.has(s.conversion_id), `${at}: Conversion ID bị trùng`);
    seen.add(s.conversion_id);
    ok(s.contact_id === null || s.contact_id === undefined || (typeof s.contact_id === 'string' && SHORT_ID.test(s.contact_id)), `${at}: Contact ID không hợp lệ (file có thể đã bị Excel đổi sang dạng 2.57E+11)`);
    ok(typeof s.converted_on === 'string' && DAY.test(s.converted_on), `${at}: ngày không hợp lệ`);
    optId(s.ad_id, `${at}: ad_id`); optId(s.adset_id, `${at}: adset_id`); optId(s.campaign_id, `${at}: campaign_id`);
    optText(s.placement, 80, `${at}: placement`); optText(s.platform, 20, `${at}: platform`); optText(s.page_path, 300, `${at}: page_path`);
    ok(HINTS.has(s.source_hint), `${at}: source_hint không hợp lệ`);
    return {
      conversion_id: s.conversion_id, contact_id: s.contact_id ?? null, converted_on: s.converted_on,
      ad_id: s.ad_id ?? null, adset_id: s.adset_id ?? null, campaign_id: s.campaign_id ?? null,
      placement: s.placement ?? null, platform: s.platform ?? null, page_path: s.page_path ?? null, source_hint: s.source_hint,
    };
  });

  const dealSeen = new Set<string>();
  const deals: CleanDeal[] = rawDeals.map((d, i) => {
    const at = `Deal #${i + 1}`;
    ok(!!d && typeof d.deal_id === 'string' && SHORT_ID.test(d.deal_id), `${at}: Record ID không hợp lệ`);
    ok(!dealSeen.has(d.deal_id), `${at}: Record ID bị trùng`);
    dealSeen.add(d.deal_id);
    ok(Array.isArray(d.contact_ids) && d.contact_ids.length <= 50 && d.contact_ids.every((c: unknown) => typeof c === 'string' && SHORT_ID.test(c)), `${at}: Contact ID không hợp lệ`);
    ok(typeof d.deal_stage === 'string' && d.deal_stage.length <= 60 && !d.deal_stage.includes('@'), `${at}: stage không hợp lệ`);
    ok(typeof d.amount === 'number' && Number.isFinite(d.amount) && d.amount >= 0 && d.amount < 1e9, `${at}: amount không hợp lệ`);
    ok(DEAL_TYPES.has(d.deal_type) && typeof d.is_won === 'boolean', `${at}: loại deal không hợp lệ`);
    ok((!d.created_on || DAY.test(d.created_on)) && (!d.closed_on || DAY.test(d.closed_on)), `${at}: ngày không hợp lệ`);
    return {
      deal_id: d.deal_id, contact_ids: d.contact_ids, deal_stage: d.deal_stage, amount: Math.round(d.amount * 100) / 100,
      created_on: d.created_on || '', closed_on: d.closed_on || '', deal_type: d.deal_type, is_won: d.is_won,
    };
  });

  const out: CrmPayload = { project_id: p.project_id, form_name: p.form_name.trim(), submissions, deals, add_campaigns: [...new Set(add as string[])] };
  assertNoPii(out, 'Payload import CRM');
  return out;
}
