import { describe, it, expect } from 'vitest';
import { decideAccess, safeNext } from '../src/lib/access';

const anon = { signedIn: false, isAdmin: false };
const stranger = { signedIn: true, isAdmin: false };
const admin = { signedIn: true, isAdmin: true };

describe('decideAccess', () => {
  it('chưa đăng nhập: mọi trang nội bộ → /login (giữ lại trang muốn vào)', () => {
    expect(decideAccess('/', anon)).toEqual({ action: 'redirect', to: '/login' });
    expect(decideAccess('/p/webinar-re11', anon, '?range=7d')).toEqual({ action: 'redirect', to: '/login?next=%2Fp%2Fwebinar-re11%3Frange%3D7d' });
    expect(decideAccess('/import', anon)).toEqual({ action: 'redirect', to: '/login?next=%2Fimport' });
    expect(decideAccess('/forbidden', anon).action).toBe('redirect');
  });

  it('route công khai: không cần đăng nhập', () => {
    for (const p of ['/login', '/auth/callback', '/s/abc123', '/api/thumb/1AbCdEf']) {
      expect(decideAccess(p, anon)).toEqual({ action: 'allow' });
    }
  });

  it('không nhầm route công khai với route có tên gần giống', () => {
    expect(decideAccess('/loginx', anon).action).toBe('redirect');
    expect(decideAccess('/s', anon).action).toBe('redirect');
    expect(decideAccess('/settings', anon).action).toBe('redirect');
  });

  it('đăng nhập nhưng KHÔNG phải admin → /forbidden, chỉ được ở /forbidden và đăng xuất', () => {
    expect(decideAccess('/', stranger)).toEqual({ action: 'redirect', to: '/forbidden' });
    expect(decideAccess('/import', stranger)).toEqual({ action: 'redirect', to: '/forbidden' });
    expect(decideAccess('/forbidden', stranger)).toEqual({ action: 'allow' });
    expect(decideAccess('/auth/signout', stranger)).toEqual({ action: 'allow' });
  });

  it('admin: vào mọi trang; mở /login hoặc /forbidden → về trang chính', () => {
    expect(decideAccess('/p/webinar-re11', admin)).toEqual({ action: 'allow' });
    expect(decideAccess('/login', admin)).toEqual({ action: 'redirect', to: '/' });
    expect(decideAccess('/forbidden', admin)).toEqual({ action: 'redirect', to: '/' });
  });
});

describe('safeNext — chặn chuyển hướng ra ngoài sau đăng nhập', () => {
  it.each([
    ['/p/webinar-re11', '/p/webinar-re11'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['https://evil.com', '/'],
    ['/login', '/'],
    ['', '/'],
    [null, '/'],
  ])('%s → %s', (input, out) => expect(safeNext(input as string | null)).toBe(out));
});
