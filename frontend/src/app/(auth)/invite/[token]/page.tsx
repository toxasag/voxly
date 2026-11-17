import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";
import { Logo } from "@/components/brand";

/**
 * Принятие приглашения по прямому URL: `/invite/:token`.
 * Зеркалит `/accept-invite?token=…` для омниканальных ссылок в мессенджерах.
 */
export default async function InviteDirectTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const validToken = token && token.length > 0 ? token : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-4 py-12 transition-colors">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Logo size="lg" href="/" />
          <p className="text-sm text-[#666666]">Приглашение в рабочее пространство</p>
        </div>

        <div className="rounded-2xl border border-[#e5e5e5] bg-white p-8 shadow-2xs transition-colors">
          <AcceptInviteForm token={validToken} />
        </div>
      </div>
    </div>
  );
}
