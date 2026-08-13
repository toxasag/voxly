import { defineFrontComponent } from 'twenty-sdk/define';
import { useColorScheme, useRecordId } from 'twenty-sdk/front-component';
import { useCallback, useEffect, useState } from 'react';

import { CUSTOMER_ACTIVITY_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { mailingApi, useMailingTheme } from 'src/lib/mailing-remote';

type ActivityRow = {
  id: string;
  kind: string;
  channel?: string | null;
  title: string;
  description?: string | null;
  meta?: Record<string, unknown> | null;
  twentyPersonId?: string | null;
  formLeadId?: string | null;
  occurredAt: string;
};

function kindLabel(kind: string): string {
  switch (kind) {
    case 'form_lead':
      return 'Заявка с сайта';
    case 'inbound_message':
      return 'Входящее сообщение';
    case 'enrichment':
      return 'Обогащение';
    case 'conversion':
      return 'Конверсия';
    case 'note':
      return 'Заметка';
    default:
      return kind;
  }
}

function channelLabel(channel?: string | null): string {
  switch (channel) {
    case 'tilda':
      return 'Tilda';
    case 'wordpress':
      return 'WordPress';
    case 'ai_tg':
      return 'Telegram';
    case 'ai_gramjs':
      return 'Telegram (личный)';
    case 'ai_wa':
      return 'WhatsApp';
    case 'ai_max':
      return 'MAX';
    case 'gift_bot':
      return 'Бот подарков';
    default:
      return channel || 'Сайт';
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CustomerActivityPanel() {
  const recordId = useRecordId();
  const dark = useColorScheme() === 'dark';
  const t = useMailingTheme(dark);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ActivityRow[]>([]);

  const load = useCallback(async () => {
    if (!recordId) return;
    setLoading(true);
    setError('');
    try {
      const data = await mailingApi.get<{
        activities?: ActivityRow[];
        error?: string;
      }>(`/s/customer-activity/${recordId}`);
      if (data?.error) throw new Error(data.error);
      setRows(data?.activities || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить историю');
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!recordId) {
    return (
      <div style={{ padding: 16, color: t.muted, fontSize: 13 }}>
        Нет записи для истории взаимодействия.
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 16,
        color: t.ink,
        background: t.panel,
        height: '100%',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <strong style={{ fontSize: 14 }}>История взаимодействия</strong>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            border: `1px solid ${t.border}`,
            background: t.soft,
            color: t.ink,
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Обновить
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: t.muted }}>Загрузка…</div>
      ) : error ? (
        <div style={{ fontSize: 13, color: t.danger }}>{error}</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: t.muted }}>Пока нет событий</div>
      ) : (
        <div
          style={{
            border: `1px solid ${t.border}`,
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          {rows.map((r, i) => (
            <div
              key={r.id}
              style={{
                padding: 12,
                borderTop: i === 0 ? 'none' : `1px solid ${t.border}`,
                display: 'grid',
                gap: 4,
                fontSize: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <strong>{r.title || kindLabel(r.kind)}</strong>
                <span
                  style={{
                    fontSize: 11,
                    color: t.accent,
                    border: `1px solid ${t.border}`,
                    borderRadius: 6,
                    padding: '1px 6px',
                  }}
                >
                  {kindLabel(r.kind)}
                </span>
                <span style={{ color: t.muted }}>{channelLabel(r.channel)}</span>
                <span style={{ color: t.muted, marginLeft: 'auto' }}>
                  {formatWhen(r.occurredAt)}
                </span>
              </div>
              {r.description ? (
                <div style={{ color: t.muted }}>{r.description}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default defineFrontComponent({
  universalIdentifier: CUSTOMER_ACTIVITY_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Voxly Customer Activity',
  description: 'Cross-channel interaction history timeline for a Person',
  component: CustomerActivityPanel,
});
