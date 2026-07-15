import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Voxly — CRM для чат-ботов и AI-ассистентов',
  description: 'Платформа для управления чат-ботами, AI-ассистентами и воронками продаж',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
