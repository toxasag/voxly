import type { Metadata } from 'next';
import { Manrope, Unbounded } from 'next/font/google';
import { TooltipProvider } from '@/components/ui/tooltip';
import { YandexMetrika } from '@/components/yandex-metrika';
import './globals.css';

const display = Unbounded({
  subsets: ['cyrillic', 'latin'],
  variable: '--font-voxly-display',
  display: 'swap',
  weight: ['500', '600', '700'],
});

const body = Manrope({
  subsets: ['cyrillic', 'latin'],
  variable: '--font-voxly-body',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://getvoxly.ru'),
  title: 'Voxly — CRM для заявок с сайта и мессенджеров',
  description:
    'Заявки с Tilda и WordPress бесплатно. Диалоги из Telegram и WhatsApp в той же CRM. Браузер на телефоне — без приложений. 7 дней free, от 500 ₽.',
  openGraph: {
    title: 'Voxly — командный центр продаж',
    description:
      'Формы free + мессенджеры + CRM. Без приложений. 7 дней бесплатно, от 500 ₽.',
    siteName: 'Voxly',
    locale: 'ru_RU',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${display.variable} ${body.variable}`}>
      <body className="font-sans antialiased">
        <YandexMetrika />
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
