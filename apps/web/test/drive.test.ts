import { describe, it, expect } from 'vitest';
import { extractShotImage, isShotImageUrl, parseAssetLink, shotKey, thumbSrc } from '../src/lib/drive';
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

describe('ảnh chụp prnt.sc (Lightshot)', () => {
  it('nhận link trang prnt.sc / prntscr.com', () => {
    expect(parseAssetLink('https://prnt.sc/F3q-UtARTvHl')).toEqual({ kind: 'shot', code: 'F3q-UtARTvHl', pageUrl: 'https://prnt.sc/F3q-UtARTvHl', imageUrl: null });
    expect(parseAssetLink('https://www.prntscr.com/2ocpi3m?x=1')).toMatchObject({ kind: 'shot', code: '2ocpi3m' });
  });
  it('nhận link ảnh trực tiếp trên CDN Lightshot, bỏ query', () => {
    expect(parseAssetLink('https://img.lightshot.app/gCtlGoIkT5iUSVGvKcAOlA.png?a=1')).toEqual({ kind: 'shot', code: 'gCtlGoIkT5iUSVGvKcAOlA', pageUrl: null, imageUrl: 'https://img.lightshot.app/gCtlGoIkT5iUSVGvKcAOlA.png' });
    expect(parseAssetLink('https://image.prntscr.com/image/abcdEFGH12.jpg')).toMatchObject({ kind: 'shot', imageUrl: 'https://image.prntscr.com/image/abcdEFGH12.jpg' });
  });
  it('từ chối link lạ giả danh prnt.sc, đường dẫn sai, http, ảnh không đuôi ảnh', () => {
    for (const bad of ['https://prnt.sc.evil.com/abcdef', 'https://prnt.sc/', 'https://prnt.sc/a/b', 'https://prnt.sc/ab', 'http://prnt.sc/F3q-UtARTvHl',
      'https://evil.com/img.lightshot.app/a.png', 'https://img.lightshot.app.evil.com/abcdef.png', 'https://img.lightshot.app/abcdef.svg', 'https://user:pw@img.lightshot.app/abcdef.png']) {
      expect(parseAssetLink(bad).kind, bad).toBe('error');
    }
  });
  it('isShotImageUrl: chỉ https + host CDN cố định + đuôi ảnh', () => {
    expect(isShotImageUrl('https://img.lightshot.app/a1b2c3d4.png')).toBe(true);
    for (const bad of ['http://img.lightshot.app/a.png', 'https://img.lightshot.app/a.html', 'https://169.254.169.254/a.png', 'https://img.lightshot.app:8443/a.png', 'https://evil.com/a.png', 'nope']) expect(isShotImageUrl(bad)).toBe(false);
  });
  it('extractShotImage: lấy og:image (đúng như trang thật) hoặc ảnh chính; bỏ link ngoài CDN', () => {
    const real = '<head><meta property="og:image" content="https://img.lightshot.app/gCtlGoIkT5iUSVGvKcAOlA.png"/></head><body><img class="no-click screenshot-image" src="https://img.lightshot.app/gCtlGoIkT5iUSVGvKcAOlA.png" id="screenshot-image" image-id="2ocpi3m"/></body>';
    expect(extractShotImage(real)).toBe('https://img.lightshot.app/gCtlGoIkT5iUSVGvKcAOlA.png');
    expect(extractShotImage('<img id="screenshot-image" src="//img.lightshot.app/x1y2z3.png">')).toBe('https://img.lightshot.app/x1y2z3.png');
    expect(extractShotImage('<meta property="og:image" content="https://evil.com/a.png"/>')).toBeNull();
    expect(extractShotImage('<html>không có ảnh</html>')).toBeNull();
  });
  it('khóa ảnh bìa: prnt.sc dùng s~<mã>, không thể trùng fileId Drive; thumbSrc chọn đúng route', () => {
    expect(shotKey('F3q-UtARTvHl')).toBe('s~F3q-UtARTvHl');
    expect(thumbSrc('s~F3q-UtARTvHl')).toBe('/api/shot/F3q-UtARTvHl');
    expect(thumbSrc('1AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe('/api/thumb/1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(/^[A-Za-z0-9_-]{10,120}$/.test(shotKey('F3q-UtARTvHl'))).toBe(false);
  });
});
