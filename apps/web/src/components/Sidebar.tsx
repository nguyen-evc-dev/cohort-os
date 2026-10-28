'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const NAV: { key: string; icon: string; label: string; href: (slug: string, q: string) => string; match: (p: string, slug: string) => boolean; project?: boolean }[] = [
  { key: 'overview', icon: '◆', label: 'Overview', href: (_s, q) => `/${q}`, match: (p) => p === '/' },
  { key: 'report', icon: '▤', label: 'Báo cáo', href: (s, q) => `/p/${s}${q}`, match: (p, s) => p === `/p/${s}`, project: true },
  { key: 'creatives', icon: '▦', label: 'Creative Vault', href: (s, q) => `/p/${s}/creatives${q}`, match: (p, s) => p === `/p/${s}/creatives`, project: true },
  { key: 'ryg', icon: '◉', label: 'Đèn RYG', href: (s, q) => `/p/${s}/ryg${q}`, match: (p, s) => p === `/p/${s}/ryg`, project: true },
];
const TOOLS = [
  { href: '/import-meta', icon: '⇧', label: 'Upload report Meta' },
  { href: '/import', icon: '⇪', label: 'Import HubSpot' },
  { href: '/projects', icon: '⚑', label: 'Project & campaign' },
  { href: '/settings', icon: '⚙', label: 'Cài đặt & sync log' },
];

export function Sidebar({ email, projects }: { email: string; projects: { slug: string; name: string }[] }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const q = sp.toString() ? `?${sp.toString()}` : '';
  const current = pathname.startsWith('/p/') ? decodeURIComponent(pathname.split('/')[2] || 'all') : 'all';
  return (
    <aside className="sidebar">
      <Link href="/" className="logo">C<span>OS</span><span className="full">&nbsp;Cohort OS</span></Link>
      <nav className="nav" aria-label="Điều hướng chính">
        {NAV.map((n) => (
          <Link key={n.key} href={n.href(current, q)} aria-current={n.match(pathname, current) ? 'page' : undefined}>
            <span className="ico">{n.icon}</span><span className="t">{n.label}</span>
          </Link>
        ))}
        <h4>Project</h4>
        {[{ slug: 'all', name: 'Toàn tài khoản' }, ...projects].map((p) => (
          <Link key={p.slug} href={`/p/${p.slug}${q}`} aria-current={pathname.startsWith(`/p/${p.slug}`) ? 'page' : undefined}>
            <span className="ico">{p.slug === 'all' ? '∑' : '●'}</span><span className="t">{p.name}</span>
          </Link>
        ))}
        <h4>Công cụ</h4>
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={pathname.startsWith(t.href) ? 'page' : undefined}>
            <span className="ico">{t.icon}</span><span className="t">{t.label}</span>
          </Link>
        ))}
      </nav>
      <div className="sidefoot">
        <div>{email}</div>
        <form action="/auth/signout" method="post"><button type="submit" className="ghost">Đăng xuất</button></form>
      </div>
    </aside>
  );
}
