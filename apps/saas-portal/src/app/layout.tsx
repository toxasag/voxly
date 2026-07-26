import type { Metadata } from 'next';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: 'Voxly — 7 дней бесплатно. CRM, боты и AI в 3 раза дешевле рынка',
  description:
    'CRM, gift-боты, AI Telegram/WhatsApp и рассылки. Попробуйте 7 дней бесплатно, затем модули от 500 ₽ — обычно в 3 раза дешевле Salebot, Wazzup и amo в сборке.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="font-sans antialiased">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
