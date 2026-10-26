import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { viVN } from '@clerk/localizations';
import { AppServiceWorker } from '@/components/shared/AppServiceWorker';

export const metadata: Metadata = {
  title: '123Dzô • Gọi món & Quản lý quán',
  description:
    'Hệ thống Quản lý Quán nhậu, Gọi món QR Động & Điều phối Bếp thời gian thực',
  manifest: '/manifest.json',
  icons: { icon: '/icon-192x192.png', apple: '/icon-192x192.png' },
};

export const viewport: Viewport = {
  themeColor: '#edf2ef',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider localization={viVN} appearance={{ variables: { colorPrimary: "#0f766e", colorBackground: "#f3f6f2", colorText: "#223d35", colorInputBackground: "#edf2ef", colorInputText: "#223d35", borderRadius: "1rem" } }}>
      <html lang="vi" >
        <body className="min-h-screen bg-soft text-ink antialiased">
          <AppServiceWorker />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
