import { describe, it, expect } from 'vitest';
import { auditAd, auditSacTargeting, countFindings, lpScope } from '../src/index';

const sacOk = { age_min: 18, age_max: 65, genders: [], countries: ['US'], cities: [{ name: 'San Jose', radius: 15, distance_unit: 'mile' }], zips_count: 0, has_lookalike: false, interests: [], behaviors: [] };
const base = { ad_id: '120252750913970233', ad_name: 'Video ban doc_WARM', campaign_name: 'RES-SELLER-LEAD-SAC Jul 26', objective: 'OUTCOME_LEADS', is_sac: true, link_url: 'https://evancoaching.net/webinar', title: 'Webinar bất động sản', body: 'Học cách bán nhà đúng giá.' };

describe('lpScope — chỉ evancoaching.net / .com và subdomain', () => {
  it.each([
    ['https://evancoaching.net/webinar', 'in'], ['https://www.evancoaching.net/x?utm=1', 'in'], ['http://go.evancoaching.com', 'in'],
    ['https://evancoaching.net:443/x', 'in'], ['https://EvanCoaching.NET./x', 'in'],
    ['https://evil.com/evancoaching.net', 'out'], ['https://evancoaching.net.evil.com', 'out'], ['https://notevancoaching.net', 'out'],
    ['https://evancoaching.net@evil.com/x', 'out'], ['https://evancoaching.net:pw@evil.com', 'out'], ['https://évancoaching.net', 'out'],
    ['https://fb.me/abc', 'out'], ['', 'none'], [null, 'none'], ['javascript:alert(1)', 'none'], ['ftp://evancoaching.net', 'none'],
  ])('%s → %s', (u, s) => { expect(lpScope(u as string | null)).toBe(s); });
});

describe('auditSacTargeting (AC T4.5)', () => {
  it('targeting theo độ tuổi 25–45 → 🔴 đúng lý do, kèm trích dẫn', () => {
    const f = auditSacTargeting({ ...sacOk, age_min: 25, age_max: 45 });
    expect(f.filter((x) => x.severity === 'red').map((x) => [x.code, x.quote])).toEqual([['SAC_AGE_MIN', 'age_min=25'], ['SAC_AGE_MAX', 'age_max=45']]);
    expect(f[0].message).toMatch(/từ 25 trở lên.*bắt buộc từ 18/);
  });
  it('giới tính, mã bưu chính, bán kính nhỏ, lookalike → mỗi cái 1 🔴', () => {
    const f = auditSacTargeting({ ...sacOk, genders: [2], zips_count: 12, cities: [{ name: 'San Jose', radius: 10, distance_unit: 'mile' }, { name: 'Oakland', radius: 20, distance_unit: 'kilometer' }], has_lookalike: true });
    expect(f.map((x) => x.code)).toEqual(['SAC_GENDER', 'SAC_ZIP', 'SAC_RADIUS', 'SAC_RADIUS', 'SAC_LOOKALIKE']);
  });
  it('20 km (≈12,4 dặm) < 15 dặm → đỏ; 25 km (≈15,5 dặm) → ổn', () => {
    expect(auditSacTargeting({ ...sacOk, cities: [{ name: 'A', radius: 20, distance_unit: 'kilometer' }] }).map((x) => x.code)).toEqual(['SAC_RADIUS']);
    expect(auditSacTargeting({ ...sacOk, cities: [{ name: 'A', radius: 25, distance_unit: 'kilometer' }] }).map((x) => x.code)).toEqual(['SAC_TARGETING_OK']);
  });
  it('cả hai giới (1,2) = không giới hạn; targeting chuẩn → 🟢; interests → 🟡', () => {
    expect(auditSacTargeting({ ...sacOk, genders: [1, 2] }).map((x) => x.severity)).toEqual(['green']);
    expect(auditSacTargeting({ ...sacOk, interests: ['Real estate'] }).map((x) => x.code)).toEqual(['SAC_DETAILED']);
  });
  it('chưa có targeting → 🟡 (không kết luận bừa)', () => {
    expect(auditSacTargeting(null)).toEqual([expect.objectContaining({ severity: 'yellow', code: 'SAC_NO_TARGETING' })]);
  });
});

describe('auditAd', () => {
  it('SAC + age 25–45 → đỏ đứng đầu, đếm đúng', () => {
    const a = auditAd({ ...base, targeting_summary: { ...sacOk, age_min: 25, age_max: 45 } });
    expect(a.isSac).toBe(true);
    expect(a.findings.slice(0, 2).map((f) => f.severity)).toEqual(['red', 'red']);
    expect(countFindings([a])).toEqual({ red: 2, yellow: 0, green: 0 });
    expect(a.lp).toEqual({ url: 'https://evancoaching.net/webinar', scope: 'in' });
  });
  it('hứa hẹn thu nhập → 🔴 có trích dẫn; "giàu nhanh" → 🟡', () => {
    const a = auditAd({ ...base, is_sac: false, campaign_name: 'WBN', title: 'Webinar kinh doanh online', body: 'Cam kết kiếm $5,000 mỗi tháng. Làm giàu nhanh không cần kinh nghiệm.' });
    expect(a.findings.map((f) => [f.severity, f.code])).toEqual([['red', 'COPY_INCOME_GUARANTEE'], ['yellow', 'COPY_GET_RICH']]);
    expect(a.findings[0].quote).toMatch(/Cam kết kiếm \$5,000/i);
  });
  it('thuộc tính cá nhân: SAC → 🔴, không SAC → 🟡', () => {
    const body = 'Bạn đang nợ ngân hàng? Webinar này dành cho bạn.';
    expect(auditAd({ ...base, targeting_summary: sacOk, body }).findings.find((f) => f.code === 'COPY_PERSONAL_ATTR')!.severity).toBe('red');
    expect(auditAd({ ...base, is_sac: false, campaign_name: 'WBN', body }).findings.find((f) => f.code === 'COPY_PERSONAL_ATTR')!.severity).toBe('yellow');
  });
  it('nội dung nhà ở mà campaign không có token SAC → 🟡 nhắc kiểm tra khai báo', () => {
    expect(auditAd({ ...base, is_sac: false, campaign_name: 'COACH-WBN-RE-PC' }).findings.map((f) => f.code)).toContain('SAC_MAYBE_MISSING');
    expect(auditAd({ ...base, is_sac: false, campaign_name: 'RES-LEAD-SAC' }).findings.map((f) => f.code)).not.toContain('SAC_MAYBE_MISSING');
  });
  it('link ngoài phạm vi → ghi "ngoài phạm vi audit", không có url để fetch', () => {
    const a = auditAd({ ...base, targeting_summary: sacOk, link_url: 'https://fb.me/abc' });
    expect(a.lp).toEqual({ url: null, scope: 'out' });
    expect(a.findings.find((f) => f.code === 'LP_OUT_OF_SCOPE')).toMatchObject({ severity: 'info' });
  });
  it('không có link → 🟡', () => {
    expect(auditAd({ ...base, targeting_summary: sacOk, link_url: null }).findings.map((f) => f.code)).toContain('LP_MISSING');
  });
});
