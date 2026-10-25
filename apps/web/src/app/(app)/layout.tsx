import { Suspense } from 'react';
import { requireAdmin } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/server-data';
import { SyncBar } from '@/components/SyncBar';
import { Sidebar } from '@/components/Sidebar';
import { FilterBar } from '@/components/FilterBar';

export const dynamic = 'force-dynamic'; // dữ liệu thay đổi sau mỗi lần sync

/** Khung ứng dụng: chỉ vào được khi là admin (lớp kiểm tra thứ 2, sau proxy). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  const ws = await getWorkspace();
  const projects = ws.projects.filter((p) => p.status === 'active').map((p) => ({ slug: p.slug as string, name: p.name as string }));
  return (
    <div className="shell">
      <SyncBar syncRuns={ws.syncRuns} imports={ws.imports} />
      <Suspense fallback={<aside className="sidebar" />}>
        <Sidebar email={user.email ?? ''} projects={projects} />
      </Suspense>
      <div className="main">
        <Suspense fallback={null}><FilterBar projects={projects} /></Suspense>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
