export type OpenCrmResult = {
  url: string | null;
  error: string | null;
};

/**
 * Opens the tenant CRM workspace via SSO popup.
 * Returns fallback URL / error so the caller can show a manual link.
 */
export async function openCrmWorkspace(): Promise<OpenCrmResult> {
  const token = localStorage.getItem('voxly_token');
  if (!token) {
    return { url: null, error: 'not_authenticated' };
  }

  const popup = window.open('about:blank', 'voxly_crm');
  if (popup) {
    try {
      popup.document.write(
        '<!doctype html><title>Voxly CRM</title><body style="font:14px system-ui;padding:24px;color:#333">Открываем CRM…</body>',
      );
      popup.document.close();
    } catch {
      /* ignore */
    }
  }

  try {
    const res = await fetch('/api/tenant/crm-login', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok || !json.url) {
      throw new Error(json.error || 'Не удалось открыть CRM');
    }
    const crmUrl =
      json.chatToken && typeof json.chatToken === 'string'
        ? `${json.url}${json.url.includes('#') ? '&' : '#'}voxlyChatToken=${encodeURIComponent(json.chatToken)}`
        : json.url;

    const navigated = window.open(crmUrl, 'voxly_crm');
    if (!navigated && !(popup && !popup.closed)) {
      return { url: crmUrl, error: 'Нажмите ссылку ниже, чтобы открыть CRM.' };
    }
    if (popup && !popup.closed && !navigated) {
      try {
        popup.location.replace(crmUrl);
      } catch {
        return { url: crmUrl, error: 'Нажмите ссылку ниже, чтобы открыть CRM.' };
      }
    }
    return { url: crmUrl, error: null };
  } catch (err) {
    try {
      popup?.close();
    } catch {
      /* ignore */
    }
    return {
      url: null,
      error: err instanceof Error ? err.message : 'Не удалось открыть CRM',
    };
  }
}
