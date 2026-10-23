import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { AppServiceWorker } from '@/components/shared/AppServiceWorker';

export const metadata: Metadata = {
  title: '123Dzô • Smart POS & KDS PWA',
  description:
    'Hệ thống Quản lý Quán nhậu, Gọi món QR Động & Điều phối Bếp thời gian thực',
  manifest: '/manifest.json',
  icons: { icon: '/icon-192x192.png', apple: '/icon-192x192.png' },
};

export const viewport: Viewport = {
  themeColor: '#f59e0b',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="vi" className="dark">
        <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
          <AppServiceWorker />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
