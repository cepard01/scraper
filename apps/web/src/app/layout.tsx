import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Brique',
  description: 'Fila de oportunidades e giro de revenda',
};

const NAV = [
  ['/', 'Início'],
  ['/deals', 'Deals'],
  ['/monitors', 'Monitores'],
  ['/inventory', 'Estoque'],
  ['/pnl', 'P&L'],
  ['/settings', 'Ajustes'],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <nav className="nav">
          <strong>Brique</strong>
          {NAV.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
