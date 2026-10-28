import { getWorkspace } from '@/lib/server-data';
import { PageHead } from '@/components/ui';
import { MetaUploadClient } from './MetaUploadClient';

export const metadata = { title: 'Upload report Meta' };

export default async function ImportMetaPage() {
  const ws = await getWorkspace();
  const projects = ws.projects.filter((p) => p.status === 'active').map((p) => ({ id: p.id as string, slug: p.slug as string, name: p.name as string }));
  return (
    <>
      <PageHead title="Upload report Meta" meta="Cách nạp số Meta nhanh và đỡ tốn token nhất: xuất report từ Ads Manager, thả file vào đây. File được đọc ngay trên trình duyệt; chỉ số liệu quảng cáo được gửi lên." />
      <MetaUploadClient projects={projects} />
    </>
  );
}
