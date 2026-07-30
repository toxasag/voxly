import { TwentyClient } from '@voxly/twenty-client';
import { decrypt, encrypt } from '@voxly/crypto';
import { fetchTwentyInvitationTokenValue } from './twenty-invitation-token.js';

function formatTwentyProvisionError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('user does not have access to this workspace')) {
    return 'Не удалось создать пользователя в CRM. Проверьте приглашение и попробуйте снова.';
  }
  if (lower.includes('invitation not found') || lower.includes('invalid invitation')) {
    return 'Приглашение в CRM недействительно или истекло. Отправьте invite ещё раз.';
  }
  if (lower.includes('already invited') || lower.includes('already a member')) {
    return 'Этот email уже приглашён или состоит в команде CRM.';
  }
  if (lower.includes('could not resolve workspace invitation token')) {
    return 'Не удалось получить токен приглашения CRM. Обратитесь в поддержку.';
  }
  if (raw.length > 180 || raw.includes('"query"') || raw.includes('GraphQL')) {
    return 'Ошибка при создании пользователя в CRM. Попробуйте ещё раз или обратитесь в поддержку.';
  }
  return raw;
}

export async function provisionTwentyMemberForTenant(params: {
  tenant: {
    twentyWorkspaceId: string | null;
    twentyOwnerPasswordEncrypted: string | null;
  };
  ownerEmail: string;
  memberEmail: string;
  memberPassword: string;
  log?: { warn: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void };
}): Promise<{ ok: boolean; twentyPasswordEncrypted?: string; error?: string }> {
  const { tenant, ownerEmail, memberEmail, memberPassword, log } = params;
  if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    return { ok: false, error: 'CRM workspace is not ready yet' };
  }

  try {
    const ownerPassword = decrypt(tenant.twentyOwnerPasswordEncrypted);
    const client = new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    });
    await client.provisionWorkspaceMember({
      ownerEmail,
      ownerPassword,
      workspaceId: tenant.twentyWorkspaceId,
      memberEmail: memberEmail.trim().toLowerCase(),
      memberPassword,
      resolveInvitationToken: async ({ workspaceId, memberEmail: email, appTokenId }) => {
        const value = await fetchTwentyInvitationTokenValue({
          workspaceId,
          appTokenId,
          memberEmail: email,
        });
        if (!value) {
          throw new Error('Could not resolve workspace invitation token value');
        }
        return value;
      },
    });
    return { ok: true, twentyPasswordEncrypted: encrypt(memberPassword) };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    log?.error({ err, memberEmail }, 'Twenty member provisioning failed');
    return { ok: false, error: formatTwentyProvisionError(raw) };
  }
}

export function resolveTwentyPasswordForMember(
  tenant: { twentyOwnerPasswordEncrypted: string | null },
  member: { role: string; twentyPasswordEncrypted?: string | null } | null,
): string | null {
  if (member?.twentyPasswordEncrypted) {
    return decrypt(member.twentyPasswordEncrypted);
  }
  if (member?.role === 'owner' && tenant.twentyOwnerPasswordEncrypted) {
    return decrypt(tenant.twentyOwnerPasswordEncrypted);
  }
  if (!member && tenant.twentyOwnerPasswordEncrypted) {
    return decrypt(tenant.twentyOwnerPasswordEncrypted);
  }
  return null;
}
