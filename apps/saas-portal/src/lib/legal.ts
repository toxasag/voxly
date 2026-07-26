/** Public legal / merchant details for Robokassa store review and 152-FZ. */

export const LEGAL = {
  brand: 'Voxly',
  siteUrl: 'https://getvoxly.ru',
  siteHost: 'getvoxly.ru',
  legalEntityShort: 'ИП Сагайдак Антон Геннадьевич',
  legalEntityFull: 'Индивидуальный предприниматель Сагайдак Антон Геннадьевич',
  inn: '505030516451',
  ogrnip: '320508100357911',
  legalAddress:
    '143923, Московская обл., Балашиха г.о., г. Балашиха, ул. Демин луг, д. 6/5',
  correspondenceAddress:
    '127018, Москва, 3-й проезд Марьиной Рощи, 40с1, 2 этаж, каб. 214',
  phone: '+7 915 094-69-44',
  phoneHref: 'tel:+79150946944',
  email: 'anton@genadich.com',
  emailHref: 'mailto:anton@genadich.com',
  /** Revision date shown on legal pages */
  revisedAt: '26 июля 2026 г.',
} as const;

export const LEGAL_LINKS = [
  { href: '/terms', label: 'Оферта' },
  { href: '/privacy', label: 'Конфиденциальность' },
  { href: '/consent', label: 'Согласие на ПДн' },
  { href: '/refund', label: 'Возврат' },
] as const;
