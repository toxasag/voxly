"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[NEXT_RUNTIME_ERROR]", error);
  }, [error]);

  return (
    <html lang="ru">
      <body className="flex min-h-screen items-center justify-center bg-white p-6 text-[#111111]">
        <main className="w-full max-w-md rounded-[8px] border border-rose-200 bg-rose-50 p-6">
          <h1 className="text-base font-semibold">Не удалось загрузить страницу</h1>
          <p className="mt-2 text-sm text-rose-700">Попробуйте повторить запрос или обновить страницу.</p>
          <button type="button" onClick={reset} className="mt-4 rounded-[8px] bg-[#4a38f5] px-3 py-2 text-sm font-medium text-white">
            Повторить
          </button>
        </main>
      </body>
    </html>
  );
}
