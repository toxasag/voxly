import type { ReactElement } from "react";
import Link from "next/link";

export default function NotFound(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-[#111111]">
      <div className="max-w-md">
        <p className="font-mono text-sm text-[#4a38f5]">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Страница не найдена</h1>
        <p className="mt-3 text-sm text-[#666666]">
          Проверьте адрес или вернитесь на главную страницу рабочего пространства.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-[8px] bg-[#4a38f5] px-4 py-2 text-sm font-medium text-white hover:bg-[#3d2ee0]"
        >
          Вернуться в рабочее пространство
        </Link>
      </div>
    </main>
  );
}
