import { describe, it, expect } from 'vitest';
import {
  parseCsv, detectFileKind, findScientificIds, parseConversionPage, classifyDeal, parseHubspotDate,
  importHubspotFiles, findPii,
} from '../src/index';
import { makeCfg } from './helpers';

// Fixture TỰ TẠO theo đúng header của export thật (24/10/2026). Tên/email/SĐT là giả.
const AD_MOF = '120252750913970233';
const AD_KV = '120252743565200233';
const CAMP = '120252652862560233';
const url = (ad: string, adset: string, medium: string) =>
  `https://www.evancoaching.com/webinar-re11?fbc_id=${adset}&h_ad_id=${ad}&utm_source=fb&utm_medium=${medium}` +
  `&utm_campaign=COACH-WBN-RE-PC-SAC&utm_content=Video%20ban%20doc_WARM&utm_id=${CAMP}&hsa_ad=${ad}&hsa_grp=${adset}&hsa_cam=${CAMP}&fbclid=abc`;

const SUBMISSIONS = [
  '"First Name","Last Name","Phone Number","Email","Conversion ID","Conversion Date","Conversion Page","Conversion Title","Contact first name","Contact last name","Contact email","Contact ID"',
  `"Test","One","+14085550101","one@example.com","c-1","2026-10-20 09:00","${url(AD_MOF, '120252703228760233', 'Facebook_Mobile_Reels')}","Webinar","Test","One","one@example.com","257000000001"`,
  `"Test","Two","+14085550102","two@example.com","c-2","2026-10-21 10:00","${url(AD_KV, '120252743565210233', 'Facebook_Mobile_Feed')}","Webinar","Test","Two","two@example.com","257000000002"`,
  // contact 1 đăng ký lần 2 (ad khác) → first-touch giữ lượt đầu
  `"Test","One","+14085550101","one@example.com","c-3","2026-10-22 11:00","${url(AD_KV, '120252743565210233', 'Facebook_Mobile_Feed')}","Webinar","Test","One","one@example.com","257000000001"`,
  // vào thẳng, không tham số → unattributed
  `"Test","Three","","three@example.com","c-4","2026-10-22 12:00","https://www.evancoaching.com/webinar-re11","Webinar","Test","Three","three@example.com","257000000003"`,
  // lượt test trên host khác → bị loại
  `"Test","Four","","four@example.com","c-5","2026-10-05 09:00","https://wbn11.vercel.app/index.html","Webinar","Test","Four","four@example.com","257000000004"`,
].join('\n');

const DEALS = [
  '"Record ID","Deal Name","Deal Stage","Amount","Create Date","Close Date","Associated Contact","Associated Invoice","Associated Contact IDs","Associated Invoice IDs"',
  '"66000000001","Webinar Đầu tư Địa ốc via Payment Link","Following","10.0","2026-10-20 09:05","2026-10-20 09:05","Test One (one@example.com)","INV-1","257000000001","599000000001"',
  '"66000000002","Webinar Đầu tư Địa ốc via Payment Link","Lost","10.0","2026-10-21 10:05","2026-10-21 10:05","Test Two (two@example.com)","INV-2","257000000002","599000000002"',
  '"66000000003","Coaching Program","Purchased","995.0","2026-10-23 08:00","2026-10-23 08:00","Test Three (three@example.com)","INV-3","257000000003","599000000003"',
  '"66000000004","Webinar test","Following","1.0","2026-10-14 03:44","2026-10-14 03:44","Test Four","INV-4","257000000004","599000000004"',
  '"66000000005","Webinar Đầu tư Địa ốc via Payment Link","Following","10.0","2026-10-14 03:44","2026-10-14 03:44","Internal Test","INV-5","1501","599000000005"',
].join('\n');

describe('đọc file', () => {
  it('parseCsv + detectFileKind nhận đúng 3 loại', () => {
    expect(detectFileKind(parseCsv(SUBMISSIONS).header)).toBe('submissions');
    expect(detectFileKind(parseCsv(DEALS).header)).toBe('deals');
    expect(detectFileKind(['Record ID', 'Associated Deal IDs'])).toBe('contacts');
    expect(detectFileKind(['foo'])).toBe('unknown');
  });
  it('phát hiện ID bị Excel đổi sang dạng E+', () => {
    expect(findScientificIds([{ 'Contact ID': '2.57478E+11' }, { 'Contact ID': '257478007363' }])).toEqual(['Contact ID']);
  });
  it('parseHubspotDate: 2 định dạng của HubSpot', () => {
    expect(parseHubspotDate('2026-10-23 16:44')).toBe('2026-10-23');
    expect(parseHubspotDate('10/9/2026 2:52')).toBe('2026-10-09');
  });
});

describe('parseConversionPage', () => {
  it('lấy ad/adset/campaign/placement theo thứ tự ưu tiên', () => {
    expect(parseConversionPage(url(AD_MOF, '120252703228760233', 'Facebook_Mobile_Reels'))).toMatchObject({
      ad_id: AD_MOF, adset_id: '120252703228760233', campaign_id: CAMP, placement: 'Facebook_Mobile_Reels', platform: 'fb', source_hint: 'tracked',
    });
  });
  it('chỉ có hsa_* vẫn đọc được', () => {
    expect(parseConversionPage(`https://www.evancoaching.com/x?hsa_ad=${AD_KV}&hsa_grp=1202527435652102&hsa_cam=${CAMP}`))
      .toMatchObject({ ad_id: AD_KV, campaign_id: CAMP, source_hint: 'tracked' });
  });
  it('không tham số → direct; host lạ → test; rác → invalid', () => {
    expect(parseConversionPage('https://www.evancoaching.com/webinar-re11').source_hint).toBe('direct');
    expect(parseConversionPage('https://js.hsforms.net/ui-forms-embed-components-app/frame.html').source_hint).toBe('test');
    expect(parseConversionPage('???').source_hint).toBe('invalid');
  });
});

describe('classifyDeal', () => {
  const cfg = makeCfg();
  it.each([
    ['Webinar … via Payment Link', '10.0', 'Following', 'seat', true],
    ['Webinar … via Payment Link', '10.0', 'Lost', 'seat', false],
    ['Coaching Program', '995.0', 'Purchased', 'program', true],
    ['Coaching Program', '1250.0', 'Following', 'program', false],
    ['Webinar test', '1.0', 'Following', 'test', false],
    ['Webinar test', '2.0', 'Following', 'test', false],
    ['Khác', '', 'Following', 'unknown', false],
    ['Không có chữ khóa', '15', 'Following', 'seat', true],
  ])('%s · $%s · %s → %s', (name, amount, stage, type, won) => {
    expect(classifyDeal(name, amount, stage, cfg)).toEqual({ deal_type: type, is_won: won });
  });
  it('từ khóa seat chỉnh được theo Project', () => {
    const c = makeCfg({}, { 'webinar-re12': { seat_keyword: 'Workshop' } });
    expect(classifyDeal('Workshop RE12', '', 'Following', c, 'webinar-re12').deal_type).toBe('seat');
  });
});

describe('importHubspotFiles — luồng đầy đủ', () => {
  const out = importHubspotFiles({ submissions: SUBMISSIONS, deals: DEALS });

  it('first-touch, loại lượt test, gắn ad', () => {
    expect(out.totals).toMatchObject({ submissions: 5, test_submissions: 1, unique_contacts: 3, tracked_contacts: 2 });
    const c1 = out.leads.find((l) => l.contact_id === '257000000001');
    expect(c1).toMatchObject({ conversion_id: 'c-1', ad_id: AD_MOF, attribution: 'first_touch' });
  });
  it('ghép seat/program với lượt đăng ký; loại deal test và contact test', () => {
    expect(out.totals).toMatchObject({ won_seats: 1, won_seats_matched: 1, won_programs: 1, won_programs_matched: 1 });
    expect(out.totals.deals_by_type).toEqual({ seat: 2, program: 1, test: 2 });
    const mof = out.by_ad.find((r) => r.ad_id === AD_MOF);
    expect(mof).toMatchObject({ registrations: 1, seats: 1, seat_revenue: 10 });
    const un = out.by_ad.find((r) => r.ad_id === null);
    expect(un).toMatchObject({ registrations: 1, programs: 1, program_revenue: 995 });
  });
  it('placement và campaign', () => {
    expect(out.by_placement).toEqual({ Facebook_Mobile_Reels: { registrations: 1, seats: 1 }, Facebook_Mobile_Feed: { registrations: 1, seats: 0 } });
    expect(out.campaigns_seen).toEqual([CAMP]);
  });
  it('KẾT QUẢ KHÔNG CÓ PII: không email, không SĐT, không tên, không Deal Name', () => {
    const json = JSON.stringify(out);
    expect(findPii(out)).toEqual([]);
    expect(json).not.toMatch(/example\.com|Test One|Payment Link|\+1408/);
  });
  it('last-touch gắn theo lượt cuối', () => {
    const lt = importHubspotFiles({ submissions: SUBMISSIONS, deals: DEALS }, makeCfg({ attribution_model: 'last_touch' }));
    expect(lt.leads.find((l) => l.contact_id === '257000000001')).toMatchObject({ conversion_id: 'c-3', ad_id: AD_KV });
  });
  it('từ chối file sai loại / thiếu / bị Excel lưu', () => {
    expect(() => importHubspotFiles({ deals: DEALS })).toThrow(/Thiếu file Form submissions/);
    expect(() => importHubspotFiles({ submissions: DEALS })).toThrow(/không đúng định dạng/);
    const excel = SUBMISSIONS.replace('"257000000002"', '"2.57E+11"');
    expect(() => importHubspotFiles({ submissions: excel })).toThrow(/Excel/);
  });
  it('dự phòng: ghép deal qua file Contacts khi Deals không có Associated Contact IDs', () => {
    const dealsNoContacts = DEALS.split('\n').map((l) => l.replace(/,"(\d+)","599\d+"$/, ',"","x"')).join('\n');
    const contacts = '"Record ID","Associated Deal IDs"\n"257000000001","66000000001"\n"257000000003","66000000003;66009999999"';
    const r = importHubspotFiles({ submissions: SUBMISSIONS, deals: dealsNoContacts, contacts });
    expect(r.totals).toMatchObject({ won_seats_matched: 1, won_programs_matched: 1 });
  });
});
