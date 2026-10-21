import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Paper & Pixels', template: '%s · Paper & Pixels' },
  description: 'Production, orders and inventory management for Paper & Pixels, San Carlos City, Pangasinan',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#14191f' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
