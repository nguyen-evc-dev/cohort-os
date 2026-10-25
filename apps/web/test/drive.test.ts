import { describe, it, expect } from 'vitest';
import { parseAssetLink } from '../src/lib/drive';
import { guessFormName } from '../src/lib/import-helpers';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('parseAssetLink', () => {
  it.each([
    [`https://drive.google.com/file/d/${ID}/view?usp=sharing`],
    [`https://drive.google.com/file/d/${ID}/view`],
    [`https://drive.google.com/open?id=${ID}`],
    [`https://drive.google.com/uc?export=view&id=${ID}`],
    [`https://drive.google.com/thumbnail?id=${ID}&sz=w800`],
    [ID],
  ])('nhận link Drive %s', (link) => { expect(parseAssetLink(link)).toEqual({ kind: 'drive', fileId: ID }); });

  it('link thư mục bị từ chối kèm hướng dẫn', () => {
    const r = parseAssetLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp');
    expect(r).toMatchObject({ kind: 'error' });
    expect((r as { message: string }).message).toMatch(/thư mục/);
  });
  it('link bài đăng Facebook / Instagram', () => {
    expect(parseAssetLink('https://www.facebook.com/evancoaching/posts/123')).toEqual({ kind: 'post', url: 'https://www.facebook.com/evancoaching/posts/123' });
    expect(parseAssetLink('https://www.instagram.com/p/AbCd/')).toMatchObject({ kind: 'post' });
  });
  it('từ chối domain lạ, http, rác, tham số token', () => {
    for (const bad of ['https://evil.com/file/d/' + ID, 'http://drive.google.com/file/d/' + ID, 'hello world', '', 'https://facebook.com/x?access_token=abc', 'javascript:alert(1)']) {
      expect(parseAssetLink(bad).kind).toBe('error');
    }
  });
  it('host giả mạo kiểu drive.google.com.evil.com bị chặn', () => {
    expect(parseAssetLink(`https://drive.google.com.evil.com/file/d/${ID}/view`).kind).toBe('error');
    expect(parseAssetLink('https://notfacebook.com/x').kind).toBe('error');
  });
});

describe('guessFormName', () => {
  it('lấy tên form từ tên file export', () => {
    expect(guessFormName('hubspot-form-submissions-00_webinar_11_5_26-2026-10-24.csv')).toBe('00_webinar_11_5_26');
    expect(guessFormName('hubspot-form-submissions-00_webinar_11_5_26-2026-10-24 (1).csv')).toBe('00_webinar_11_5_26');
    expect(guessFormName('submissions.csv')).toBe('submissions');
  });
});
