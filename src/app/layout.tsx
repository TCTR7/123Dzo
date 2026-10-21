import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: '123Dzô • Smart POS & KDS PWA',
  description:
    'Hệ thống Quản lý Quán nhậu, Gọi món QR Động & Điều phối Bếp thời gian thực',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#f59e0b',
  width: 'device-width',
  initialScale: 1,
};

function hasValidClerkPublishableKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.includes('your_clerk_publishable_key')) return false;
  return key.startsWith('pk_test_') || key.startsWith('pk_live_');
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const content = (
    <html lang="vi" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );

  if (hasValidClerkPublishableKey(publishableKey)) {
    return (
      <ClerkProvider publishableKey={publishableKey}>{content}</ClerkProvider>
    );
  }

  return content;
}
