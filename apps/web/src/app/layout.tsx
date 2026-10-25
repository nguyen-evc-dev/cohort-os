import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cohort OS',
  description: 'Báo cáo master Meta Ads → HubSpot (dùng cá nhân)',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
