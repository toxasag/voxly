import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";
import { Logo } from "@/components/brand";

/**
 * Принятие приглашения сотрудником: `/accept-invite?token=…`.
 *
 * Серверный компонент читает токен из `searchParams` — как и `/reset-password`,
 * чтобы форма не мигала состоянием «ссылка без токена» до гидрации.
 */
export default async function AcceptInvitePage({
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
          <p className="text-sm text-[#666666] dark:text-[#a1a1aa]">Приглашение в рабочее пространство</p>
        </div>

        <div className="rounded-2xl border border-[#e5e5e5] bg-white p-8 shadow-2xs dark:border-[#27272a] dark:bg-[#111111] transition-colors">
          <AcceptInviteForm token={token} />
        </div>
      </div>
    </div>
  );
}
