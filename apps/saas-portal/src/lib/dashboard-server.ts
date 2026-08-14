import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_BASE = process.env.SAAS_API_URL || 'http://saas-api:3002';

export interface MeResponse {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  telegramUserId?: string;
  tenant?: {
    id: string;
    slug: string;
    name: string;
    status: string;
    portalHost: string;
    crmSubdomain: string;
    twentyWorkspaceId: string;
    membershipRole: string;
    subscription: {
      status: string;
      plan: string;
      isTrial: boolean;
      startsAt: string;
      expiresAt: string;
      seatsUsed: number;
      seatsIncluded: number;
    } | null;
    addons: { id: string; type: string; status: string }[];
    aiWallet: { balanceRub: number };
    referralCode: { code: string } | null;
  };
  tenants: {
    id: string;
    slug: string;
    portalHost: string;
    crmSubdomain: string;
    status: string;
    role: string;
  }[];
}

export interface DashboardOverview {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    crmReady: boolean;
    crmAccessLocked?: boolean;
    crmAccessReason?: string;
    crmAccessError?: string | null;
  };
  subscription: {
    productCode: string;
    status: string;
    isTrial?: boolean;
    endsAt: string;
    seatsIncluded: number;
    extraSeats: number;
  } | null;
  products: {
    crm: { isActive: boolean; activeUntil: string | null };
    gift: { isActive: boolean; isTrial: boolean; trialAvailable?: boolean; activeUntil: string | null };
    giftMax?: { isActive: boolean; isTrial: boolean; trialAvailable?: boolean; activeUntil: string | null };
    aiBusiness: {
      isActive: boolean;
      isTrial: boolean;
      trialAvailable?: boolean;
      activeUntil: string | null;
      includedSlots: number;
      extraSlots?: number;
      activeAccounts: number;
      limitedAccounts: number;
    };
    gramjs: { isActive: boolean; isTrial: boolean; trialAvailable?: boolean; activeUntil: string | null };
    max?: { isActive: boolean; isTrial: boolean; trialAvailable?: boolean; activeUntil: string | null };
    whatsapp: { isActive: boolean; isTrial: boolean; trialAvailable?: boolean; activeUntil: string | null };
    mailingBot: { isActive: boolean; isTrial: boolean; trialAvailable?: boolean; activeUntil: string | null };
    mailingAccounts: { isActive: boolean; isTrial: boolean; trialAvailable?: boolean; activeUntil: string | null };
    mailingStories: { isActive: boolean; isTrial: boolean; trialAvailable?: boolean; activeUntil: string | null };
  };
  accounts: {
    giftBots: number;
    giftMaxBots?: number;
    aiBusinessBots: number;
    gramjs: number;
    max?: number;
    whatsapp: number;
    agents: number;
  };
  traffic: {
    messages7d: number;
    messages30d: number;
    inbound7d: number;
    conversationsOpen: number;
    conversationsTotal: number;
    giftSubscribers: number;
    giftPhases: Record<string, number>;
    opportunitiesApprox: number;
  };
  money: {
    aiWalletRub: number;
    aiSpent30dRub: number;
    aiProviderCost30dRub?: number;
    aiTokens30d?: number;
    aiRequests30d: number;
    referralBalanceRub: number;
    referralEarnedRub: number;
    referralCode: string | null;
  };
}

export async function getServerSession(): Promise<MeResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get('voxly_token')?.value;
  if (!token) {
    redirect('/login');
  }

  const meRes = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!meRes.ok) {
    redirect('/login');
  }

  return meRes.json() as Promise<MeResponse>;
}

export async function getServerDashboard(): Promise<DashboardOverview> {
  const cookieStore = await cookies();
  const token = cookieStore.get('voxly_token')?.value;
  if (!token) {
    redirect('/login');
  }

  const res = await fetch(`${API_BASE}/api/tenant/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Не удалось загрузить дашборд');
  }

  return res.json() as Promise<DashboardOverview>;
}
