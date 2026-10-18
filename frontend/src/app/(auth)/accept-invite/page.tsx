import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";

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
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">GETVOXLY</h1>
          <p className="text-sm text-[#666666]">Приглашение в рабочее пространство</p>
        </div>

<<<<<<< HEAD
        <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-8 shadow-2xs">
=======
        <div className="rounded-2xl border border-[#e5e5e5] bg-white p-8 shadow-2xs">
>>>>>>> master
          <AcceptInviteForm token={token} />
        </div>
      </div>
    </div>
  );
}
