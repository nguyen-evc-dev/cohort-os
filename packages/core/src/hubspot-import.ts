/**
 * Chuẩn bị import cho Web / CLI: giữ MỌI lượt đăng ký (view crm_leads tự chọn first-touch),
 * báo cột bị bỏ, cảnh báo chất lượng. Không trả về bất kỳ giá trị PII nào.
 */
import { defaultConfig, type Config } from './config';
import {
  ALWAYS_DROP, buildCrmImport, cleanDeals, cleanSubmissions, contactIdsByDealFromContacts, detectFileKind, findScientificIds, parseCsv,
  type CleanDeal, type CleanSubmission, type CrmImportResult, type ImportFiles,
} from './hubspot';
import { DEFAULT_AUDIT_DOMAINS } from './time';

type Kind = 'submissions' | 'deals' | 'contacts';
const USED_COLUMNS: Record<Kind, string[]> = {
  submissions: ['Conversion ID', 'Conversion Date', 'Conversion Page', 'Contact ID'],
  deals: ['Record ID', 'Deal Name', 'Deal Stage', 'Amount', 'Create Date', 'Close Date', 'Associated Contact IDs'],
  contacts: ['Record ID', 'Associated Deal IDs'],
};

export interface PreparedImport {
  submissions: CleanSubmission[];
  deals: CleanDeal[];
  /** Cột có trong file nhưng KHÔNG được đọc. `pii` = tên cột thuộc nhóm luôn bỏ (tên / email / SĐT / owner…). */
  dropped: { file: Kind; column: string; pii: boolean }[];
  preview: CrmImportResult;
  warnings: string[];
  fileRows: { submissions: number; deals: number; contacts: number };
}

export function prepareHubspotImport(files: ImportFiles, config: Config = defaultConfig(), scope?: string): PreparedImport {
  const dropped: PreparedImport['dropped'] = [];
  const read = (text: string | undefined, expect: Kind) => {
    if (!text) return null;
    const { header, rows } = parseCsv(text);
    const kind = detectFileKind(header);
    if (kind !== expect) throw new Error(`File ${expect} không đúng định dạng (nhận diện là: ${kind}).`);
    const sci = findScientificIds(rows);
    if (sci.length) throw new Error(`File ${expect} có ID dạng khoa học ở cột ${sci.join(', ')} — file đã bị Excel lưu lại. Export lại và KHÔNG mở bằng Excel.`);
    for (const h of header) {
      if (!USED_COLUMNS[expect].includes(h)) dropped.push({ file: expect, column: h, pii: ALWAYS_DROP.test(h) || /name|email|phone|address/i.test(h) });
    }
    return rows;
  };
  const subsRows = read(files.submissions, 'submissions');
  if (!subsRows) throw new Error('Thiếu file Form submissions (bắt buộc).');
  const dealRows = read(files.deals, 'deals') || [];
  const contactRows = read(files.contacts, 'contacts') || [];
  const audit = String(config.global.audit_domains || DEFAULT_AUDIT_DOMAINS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  // page_path không được chứa '@' (có thể là email nằm trong URL) → bỏ
  const submissions = cleanSubmissions(subsRows, audit).filter((s) => s.conversion_id)
    .map((s) => (s.page_path && s.page_path.includes('@') ? { ...s, page_path: null } : s));
  const deals = cleanDeals(dealRows, config, scope, contactIdsByDealFromContacts(contactRows)).filter((d) => d.deal_id);
  const preview = buildCrmImport(submissions, deals, config);

  const warnings: string[] = [];
  const noContact = submissions.filter((s) => !s.contact_id).length;
  if (noContact) warnings.push(`${noContact} lượt đăng ký không có Contact ID nên không ghép được với deal.`);
  if (preview.totals.test_submissions) warnings.push(`${preview.totals.test_submissions} lượt đăng ký từ trang test / ngoài domain sẽ bị loại khỏi báo cáo.`);
  const unlinked = deals.filter((d) => d.deal_type !== 'test' && d.contact_ids.length === 0).length;
  if (unlinked) warnings.push(`${unlinked} deal không có Associated Contact IDs. Thêm cột này vào view Deals hoặc đính kèm file Contacts.`);
  if (preview.totals.won_seats > preview.totals.won_seats_matched) {
    warnings.push(`${preview.totals.won_seats - preview.totals.won_seats_matched}/${preview.totals.won_seats} deal seat đã mua chưa ghép được với lượt đăng ký nào (contact không có trong form này).`);
  }
  const pct = preview.totals.unique_contacts ? (preview.totals.tracked_contacts / preview.totals.unique_contacts) * 100 : 0;
  if (preview.totals.unique_contacts && pct < 50) warnings.push(`Chỉ ${pct.toFixed(0)}% lead gắn được ad (h_ad_id). Kiểm tra chuỗi tracking trong link quảng cáo.`);
  return { submissions, deals, dropped, preview, warnings, fileRows: { submissions: subsRows.length, deals: dealRows.length, contacts: contactRows.length } };
}
