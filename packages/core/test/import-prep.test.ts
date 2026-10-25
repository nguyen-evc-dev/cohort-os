import { describe, it, expect } from 'vitest';
import { findPii, prepareHubspotImport, validateCrmPayload } from '../src/index';

// Fixture TỰ TẠO theo đúng header export thật. Tên / email / SĐT là giả.
const AD_MOF = '120252750913970233';
const AD_KV = '120252743565200233';
const CAMP = '120252652862560233';
const url = (ad: string, adset: string, medium: string) =>
  `https://www.evancoaching.com/webinar-re11?fbc_id=${adset}&h_ad_id=${ad}&utm_source=fb&utm_medium=${medium}&utm_campaign=COACH-WBN-RE-PC-SAC&utm_id=${CAMP}&hsa_ad=${ad}&fbclid=abc`;

const SUBS = [
  '"First Name","Last Name","Phone Number","Email","Conversion ID","Conversion Date","Conversion Page","Conversion Title","Contact first name","Contact last name","Contact email","Contact ID"',
  `"Test","One","+14085550101","one@example.com","c-1","2026-10-20 09:00","${url(AD_MOF, '120252703228760233', 'Facebook_Mobile_Reels')}","Webinar","Test","One","one@example.com","257000000001"`,
  `"Test","Two","+14085550102","two@example.com","c-2","2026-10-21 10:00","${url(AD_KV, '120252743565210233', 'Facebook_Mobile_Feed')}","Webinar","Test","Two","two@example.com","257000000002"`,
  `"Test","One","+14085550101","one@example.com","c-3","2026-10-22 11:00","${url(AD_KV, '120252743565210233', 'Facebook_Mobile_Feed')}","Webinar","Test","One","one@example.com","257000000001"`,
  `"Test","Three","","three@example.com","c-4","2026-10-22 12:00","https://www.evancoaching.com/webinar-re11?email=three@example.com","Webinar","Test","Three","three@example.com","257000000003"`,
  `"Test","Four","","four@example.com","c-5","2026-10-05 09:00","https://wbn11.vercel.app/index.html","Webinar","Test","Four","four@example.com","257000000004"`,
].join('\n');
const DEALS = [
  '"Record ID","Deal Name","Deal Stage","Amount","Create Date","Close Date","Deal owner","Associated Contact","Associated Contact IDs"',
  '"66000000001","Webinar Đầu tư Địa ốc","Following","10.0","2026-10-20 09:05","2026-10-20 09:05","Sale Ai Đó","Test One (one@example.com)","257000000001"',
  '"66000000003","Coaching Program","Purchased","995.0","2026-10-23 08:00","2026-10-23 08:00","Sale Ai Đó","Test Three (three@example.com)","257000000003"',
].join('\n');

describe('prepareHubspotImport', () => {
  const p = prepareHubspotImport({ submissions: SUBS, deals: DEALS });
  it('giữ MỌI lượt đăng ký (kể cả lượt thứ 2 của 1 contact và lượt test) để view tự chọn first-touch', () => {
    expect(p.submissions.map((s) => [s.conversion_id, s.source_hint])).toEqual([
      ['c-1', 'tracked'], ['c-2', 'tracked'], ['c-3', 'tracked'], ['c-4', 'direct'], ['c-5', 'test'],
    ]);
    expect(p.fileRows).toEqual({ submissions: 5, deals: 2, contacts: 0 });
  });
  it('liệt kê cột bị bỏ và đánh dấu cột PII', () => {
    const cols = p.dropped.map((d) => d.column);
    expect(cols).toEqual(expect.arrayContaining(['First Name', 'Last Name', 'Phone Number', 'Email', 'Contact email', 'Conversion Title', 'Deal owner', 'Associated Contact']));
    expect(p.dropped.find((d) => d.column === 'Email')?.pii).toBe(true);
    expect(p.dropped.find((d) => d.column === 'Deal owner')?.pii).toBe(true);
    expect(p.dropped.find((d) => d.column === 'Conversion Title')?.pii).toBe(false);
    expect(cols).not.toContain('Conversion Page');
  });
  it('email nằm trong URL không lọt vào page_path', () => {
    expect(p.submissions.find((s) => s.conversion_id === 'c-4')?.page_path).toBe('/webinar-re11');
    expect(findPii(p.submissions)).toEqual([]);
    expect(findPii(p.deals)).toEqual([]);
    expect(JSON.stringify(p)).not.toMatch(/example\.com|Ai Đó|\+1408|Webinar Đầu tư/);
  });
  it('preview: 3 contact, 2 tracked, seat đã ghép; cảnh báo lượt test', () => {
    expect(p.preview.totals).toMatchObject({ unique_contacts: 3, tracked_contacts: 2, won_seats: 1, won_seats_matched: 1, test_submissions: 1 });
    expect(p.warnings.some((w) => /test/.test(w))).toBe(true);
  });
  it('từ chối file bị Excel đổi ID', () => {
    const bad = SUBS.replace('"257000000001"', '"2.57E+11"');
    expect(() => prepareHubspotImport({ submissions: bad })).toThrow(/dạng khoa học/);
  });
  it('thiếu file submissions / sai loại file', () => {
    expect(() => prepareHubspotImport({ deals: DEALS })).toThrow(/Thiếu file Form submissions/);
    expect(() => prepareHubspotImport({ submissions: DEALS })).toThrow(/không đúng định dạng/);
  });
});

describe('validateCrmPayload (server không tin client)', () => {
  const P = '11111111-1111-4111-8111-111111111111';
  const good = () => {
    const p = prepareHubspotImport({ submissions: SUBS, deals: DEALS });
    return { project_id: P, form_name: '00_webinar_11_5_26', submissions: p.submissions, deals: p.deals, add_campaigns: [CAMP] };
  };
  it('payload hợp lệ đi qua nguyên vẹn', () => {
    const v = validateCrmPayload(good());
    expect(v.submissions.length).toBe(5);
    expect(v.deals.map((d) => d.deal_type)).toEqual(['seat', 'program']);
    expect(v.add_campaigns).toEqual([CAMP]);
  });
  it('chặn email / SĐT lẫn vào bất kỳ trường nào', () => {
    const p = good(); (p.submissions[0] as any).placement = 'mail a@b.com'; expect(() => validateCrmPayload(p)).toThrow(/placement/);
    const q = good(); (q.deals[0] as any).deal_stage = 'x@y.com'; expect(() => validateCrmPayload(q)).toThrow(/stage/);
    const r = good(); r.form_name = 'form a@b.com'; expect(() => validateCrmPayload(r)).toThrow(/Tên form/);
  });
  it('chặn ID sai định dạng (ID dạng E+, chữ, SQL)', () => {
    const p = good(); (p.submissions[0] as any).contact_id = '2.57E+11'; expect(() => validateCrmPayload(p)).toThrow(/Contact ID/);
    const q = good(); (q.submissions[0] as any).ad_id = "1; drop table x"; expect(() => validateCrmPayload(q)).toThrow(/ad_id/);
    const r = good(); r.project_id = 'abc'; expect(() => validateCrmPayload(r)).toThrow(/Project/);
    const s = good(); s.add_campaigns = ['12345']; expect(() => validateCrmPayload(s)).toThrow(/Campaign ID/);
  });
  it('chặn trường lạ không có trong schema (tên, email) bị lén thêm vào', () => {
    const p = good(); (p.submissions[0] as any).email = 'one@example.com';
    const v = validateCrmPayload(p);
    expect(JSON.stringify(v)).not.toContain('example.com'); // trường lạ bị loại bỏ khi chuẩn hóa
  });
  it('chặn trùng Conversion ID, amount âm, loại deal lạ', () => {
    const p = good(); p.submissions[1].conversion_id = 'c-1'; expect(() => validateCrmPayload(p)).toThrow(/trùng/);
    const q = good(); q.deals[0].amount = -5; expect(() => validateCrmPayload(q)).toThrow(/amount/);
    const r = good(); (r.deals[0] as any).deal_type = 'vip'; expect(() => validateCrmPayload(r)).toThrow(/loại deal/);
  });
  it('payload rỗng', () => { expect(() => validateCrmPayload(null)).toThrow(/trống/); expect(() => validateCrmPayload({ ...good(), submissions: [] })).toThrow(/Không có lượt/); });
});
