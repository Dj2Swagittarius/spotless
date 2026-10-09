import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import Shell from '@/components/Shell';

// closest open font to Spotify's Circular: geometric, rounded, friendly. Self-hosted (OFL, see
// fonts/LICENSE-*.txt) so builds never depend on fetching Google Fonts.
const figtree = localFont({
  src: './fonts/figtree-latin-wght-normal.woff2',
  weight: '300 900',
  variable: '--font-app',
  display: 'swap',
});

// display face for the wordmark only — sharper, more character than the UI font
const bricolage = localFont({
  src: './fonts/bricolage-grotesque-latin-wght-normal.woff2',
  weight: '200 800',
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Spotless',
  description: 'Self-hosted music streaming',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icon-192.png', sizes: '192x192' }],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#121212',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${bricolage.variable}`}>
      <body className="font-sans">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
