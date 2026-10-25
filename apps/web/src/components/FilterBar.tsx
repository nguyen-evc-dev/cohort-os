'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const PRESETS = [['7', '7 ngày'], ['14', '14 ngày'], ['30', '30 ngày'], ['all', 'Tất cả']] as const;
const SRCS = [['both', 'Both'], ['meta', 'Meta'], ['crm', 'CRM']] as const;

/** Bộ lọc toàn cục (khoảng ngày + nguồn) — chỉ đổi query trên URL, trang server tự đọc lại. */
export function FilterBar({ projects }: { projects: { slug: string; name: string }[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null) q.delete(k); else q.set(k, v); }
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const d = sp.get('from') && sp.get('to') ? 'custom' : sp.get('d') || '7';
  const src = sp.get('src') === 'meta' || sp.get('src') === 'crm' ? sp.get('src') : 'both';
  const slug = pathname.startsWith('/p/') ? decodeURIComponent(pathname.split('/')[2] || 'all') : null;
  const tail = pathname.startsWith('/p/') ? pathname.split('/').slice(3).join('/') : '';
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const dateful = pathname === '/' || pathname.startsWith('/p/');
  if (!dateful) return null;
  return (
    <div className="topbar">
      {slug && (
        <label style={{ margin: 0 }}>
          <span className="sr" style={{ position: 'absolute', left: -9999 }}>Project</span>
          <select aria-label="Project" value={slug} onChange={(e) => router.push(`/p/${e.target.value}${tail ? `/${tail}` : ''}${qs}`)}>
            <option value="all">Toàn tài khoản</option>
            {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </label>
      )}
      <div className="seg" role="group" aria-label="Khoảng ngày">
        {PRESETS.map(([v, label]) => (
          <Link key={v} href={href({ d: v === '7' ? null : v, from: null, to: null })} aria-current={d === v}>{label}</Link>
        ))}
        {d === 'custom' && <a aria-current="true">{sp.get('from')} → {sp.get('to')}</a>}
      </div>
      <span className="sp" />
      <div className="seg src" role="group" aria-label="Nguồn số liệu">
        {SRCS.map(([v, label]) => (
          <Link key={v} data-s={v} href={href({ src: v === 'both' ? null : v })} aria-current={src === v}>{label}</Link>
        ))}
      </div>
    </div>
  );
}
