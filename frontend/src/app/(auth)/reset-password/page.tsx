import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

/**
 * Смена пароля по ссылке из письма: `/reset-password?token=…`.
 *
 * Серверный компонент: токен читается из `searchParams`, а не из `location` на
 * клиенте, поэтому форма получает его сразу при первой отрисовке и не мигает
 * состоянием «ссылка без токена» до гидрации.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = raw !== undefined && raw.length > 0 ? raw : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">GETVOXLY</h1>
          <p className="text-sm text-slate-400">Восстановление доступа</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-8">
          <ResetPasswordForm token={token} />
        </div>
      </div>
    </div>
  );
}
