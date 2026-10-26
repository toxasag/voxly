import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { Logo } from "@/components/brand";

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
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-4 py-12 dark:bg-[#09090b] transition-colors">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Logo size="lg" href="/" />
          <p className="text-sm text-[#666666] dark:text-[#a1a1aa]">Восстановление доступа</p>
        </div>

        <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-8 shadow-2xs dark:border-[#27272a] dark:bg-[#111111] transition-colors">
          <ResetPasswordForm token={token} />
        </div>
      </div>
    </div>
  );
}
