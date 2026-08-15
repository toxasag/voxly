import type { Metadata } from 'next';
import { VoxlyLanding } from '@/components/landing/voxly/voxly-landing';

export const metadata: Metadata = {
  title: 'Voxly — все клиенты в одном окне на телефоне',
  description:
    'WhatsApp, Telegram, Max и сайты — в одном окне. Voxly найдёт соцсети, ФИО и дату рождения. 7 дней без карты, от 500 ₽.',
  openGraph: {
    title: 'Voxly — все клиенты в одном окне на телефоне',
    description:
      'WhatsApp, Telegram, Max и сайты — в одном окне. 7 дней бесплатно, от 500 ₽.',
    siteName: 'Voxly',
    locale: 'ru_RU',
    type: 'website',
  },
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref: rawRef } = await searchParams;
  const refCode = rawRef?.trim() || null;

  return <VoxlyLanding refCode={refCode} />;
}
