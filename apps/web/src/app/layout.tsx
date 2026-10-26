import type { Metadata } from 'next';
import { Be_Vietnam_Pro, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-inter', display: 'swap' });
const beVietnam = Be_Vietnam_Pro({ subsets: ['latin', 'vietnamese'], weight: ['400', '500', '600', '700'], variable: '--font-be-vietnam', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-face', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Cohort OS', template: '%s · Cohort OS' },
  description: 'Báo cáo master Meta Ads → HubSpot (dùng cá nhân)',
  robots: { index: false, follow: false },
  // Commit đang chạy (Vercel tự cấp) — xem nhanh bản deploy nào đang live
  other: { 'cohort-build': process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${beVietnam.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
