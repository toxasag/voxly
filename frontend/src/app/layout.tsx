import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { QueryProvider } from "@/lib/api/QueryProvider";
import { AuthProvider } from "@/lib/auth/use-auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "GETVOXLY — платформа для бизнеса",
  description: "Модульная CRM-платформа: продажи, сервис, финансы и AI-боты",
};

/**
 * Без этого мобильный браузер отдаёт вымышленную ширину 980px и масштабирует
 * готовую страницу, поэтому ни один медиазапрос и ни один `md:`-класс не
 * срабатывают так, как задумано: адаптация просто не работает.
 *
 * Стоит первым пунктом мобильной работы именно поэтому — иначе всё остальное
 * проверялось бы в неверном масштабе.
 *
 * `maximumScale` и `userScalable` не задаются намеренно: запрет масштабирования
 * ломает доступность для тех, кому нужен зум, а никакой пользы интерфейсу не
 * даёт.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Применяет сохранённую тему до первой отрисовки.
 *
 * Блокирующий инлайновый скрипт намеренно: в эффекте он сработал бы уже после
 * рендера, и на каждой загрузке была бы вспышка чужой темы.
 *
 * Светлая тема — по умолчанию, поэтому тёмная включается только при явно
 * сохранённом выборе. Класс `light` уже стоит на <html> в разметке, так что при
 * отсутствии записи в localStorage скрипт не меняет ничего и мигания нет.
 */
const THEME_INIT_SCRIPT = `
try {
  document.documentElement.classList.add('light');
  document.documentElement.classList.remove('dark');
} catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/*
        `text-sm` базовым размером: без него неразмеченный текст наследовал
        браузерные 16px, а вся оболочка набрана 13px и 12px. У Twenty
        база 13px, чистый белый холст (#ffffff) и высококонтрастный текст (#111111).
      */}
      <body className="min-h-screen bg-white text-sm text-[#111111] antialiased">
        {/*
          AuthProvider sits at the root, not per route group: /login needs it
          too (the OTP form calls useAuth), and one provider per group would
          mean several independent sessions each firing its own /auth/refresh.
        */}
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
        {/*
          richColors делает деструктивный вариант заметно красным: здесь
          показываются ошибки входа, а нейтральный toast читался бы как
          статусное сообщение, а не ошибка.
        */}
        <Toaster position="bottom-right" richColors closeButton theme="light" />
      </body>
    </html>
  );
}