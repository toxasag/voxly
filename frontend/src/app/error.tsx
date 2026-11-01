"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-6 text-center">
        <h1 className="text-base font-semibold">Ошибка загрузки</h1>
        <p className="mt-2 text-sm text-rose-700">Не удалось отобразить раздел.</p>
        <button type="button" onClick={reset} className="mt-4 rounded-[8px] bg-[#4a38f5] px-3 py-2 text-sm text-white">Повторить</button>
      </div>
    </div>
  );
}
