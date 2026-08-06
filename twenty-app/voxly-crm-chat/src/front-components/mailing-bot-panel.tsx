import { defineFrontComponent } from 'twenty-sdk/define';
import { enqueueSnackbar, useColorScheme } from 'twenty-sdk/front-component';
import { useCallback, useEffect, useState } from 'react';

import { MAILING_BOT_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import {
  MailingComposer,
  type MailingComposerValue,
} from 'src/front-components/mailing/mailing-composer';
import { MailingHistoryList } from 'src/front-components/mailing/mailing-history';
import {
  accountLabel,
  fieldStyle,
  labelStyle,
  mailingApi,
  openMailingPayment,
  toLocalInputValue,
  useMailingTheme,
  type AccountRow,
  type BillingProduct,
  type BroadcastRow,
} from 'src/lib/mailing-remote';

type FunnelPhase = '' | 'started' | 'awaiting_sub' | 'gifted' | 'not_gifted';

const emptyComposer = (): MailingComposerValue => ({
  text: '',
  mediaUrl: '',
  mediaType: '',
  scheduledAt: '',
});

function MailingBotPanel() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const t = useMailingTheme(dark);
  const fs = fieldStyle(t);
  const ls = labelStyle(t);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bots, setBots] = useState<AccountRow[]>([]);
  const [botId, setBotId] = useState('');
  const [billing, setBilling] = useState<BillingProduct | null>(null);
  const [segment, setSegment] = useState<'gifted' | 'not_gifted' | 'all'>('not_gifted');
  const [funnelPhase, setFunnelPhase] = useState<FunnelPhase>('');
  const [composer, setComposer] = useState<MailingComposerValue>(emptyComposer);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);
  const [rows, setRows] = useState<BroadcastRow[]>([]);

  const loadContext = useCallback(async () => {
    const data = await mailingApi.get<{
      giftBots?: AccountRow[];
      bots?: AccountRow[];
      billing?: {
        trialDays?: number;
        products?: { mailing_bot?: BillingProduct };
      };
      error?: string;
    }>('/s/mailing/context');
    if (data?.error) throw new Error(data.error);
    const list = data?.giftBots || data?.bots || [];
    setBots(list);
    setBilling(data?.billing?.products?.mailing_bot || null);
    setBotId((prev) =>
      prev && list.some((b) => b.id === prev) ? prev : list[0]?.id || '',
    );
  }, []);

  const loadBroadcasts = useCallback(async (id: string) => {
    if (!id) {
      setRows([]);
      return;
    }
    const data = await mailingApi.get<{ broadcasts?: BroadcastRow[]; error?: string }>(
      `/s/mailing/bots/${encodeURIComponent(id)}/broadcasts`,
    );
    if (data?.error) throw new Error(data.error);
    setRows(data?.broadcasts || []);
  }, []);

  useEffect(() => {
    void loadContext()
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [loadContext]);

  useEffect(() => {
    if (!botId) return;
    void loadBroadcasts(botId).catch((e) =>
      setError(e instanceof Error ? e.message : 'Ошибка истории'),
    );
  }, [botId, loadBroadcasts]);

  const billingOk = Boolean(billing?.isActive);
  const selected = bots.find((b) => b.id === botId) || null;
  const canSave =
    billingOk &&
    Boolean(botId) &&
    Boolean(selected?.hasGiftCampaign) &&
    composer.text.trim().length > 0 &&
    !busy;

  const resetForm = () => {
    setEditingId(null);
    setComposer(emptyComposer());
    setSegment('not_gifted');
    setFunnelPhase('');
  };

  const startEdit = (row: BroadcastRow) => {
    if (row.status !== 'scheduled' && row.status !== 'draft') return;
    setEditingId(row.id);
    setSegment((row.segment as 'gifted' | 'not_gifted' | 'all') || 'all');
    setFunnelPhase((row.funnelPhase as FunnelPhase) || '');
    setComposer({
      text: row.text || '',
      mediaUrl: row.mediaUrl || '',
      mediaType: (row.mediaType as 'photo' | 'video') || '',
      scheduledAt: toLocalInputValue(row.scheduledAt),
    });
  };

  const duplicate = (row: BroadcastRow) => {
    setEditingId(null);
    setSegment((row.segment as 'gifted' | 'not_gifted' | 'all') || 'all');
    setFunnelPhase((row.funnelPhase as FunnelPhase) || '');
    setComposer({
      text: row.text || '',
      mediaUrl: row.mediaUrl || '',
      mediaType: (row.mediaType as 'photo' | 'video') || '',
      scheduledAt: toLocalInputValue(row.scheduledAt) || '',
    });
  };

  const remove = async (row: BroadcastRow) => {
    if (!botId) return;
    setBusy(true);
    setError('');
    try {
      const data = await mailingApi.request<{ error?: string }>(
        'DELETE',
        `/s/mailing/bots/${encodeURIComponent(botId)}/broadcasts/${encodeURIComponent(row.id)}`,
      );
      if (data?.error) throw new Error(data.error);
      enqueueSnackbar({ message: 'Удалено', variant: 'success' });
      if (editingId === row.id) resetForm();
      await loadBroadcasts(botId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалено');
    } finally {
      setBusy(false);
    }
  };

  const startTrial = async () => {
    setTrialBusy(true);
    try {
      const data = await mailingApi.post<{ error?: string }>('/s/mailing/start-trial', {
        type: 'mailing_bot',
      });
      if (data?.error) throw new Error(data.error);
      await loadContext();
      enqueueSnackbar({ message: 'Пробный период включён', variant: 'success' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setTrialBusy(false);
    }
  };

  const save = async () => {
    if (!canSave || !botId) return;
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = { text: composer.text.trim() };
      if (composer.mediaUrl.trim()) body.mediaUrl = composer.mediaUrl.trim();
      if (composer.mediaType) body.mediaType = composer.mediaType;
      body.segment = segment;
      if (funnelPhase) body.funnelPhase = funnelPhase;
      if (composer.scheduledAt) {
        const d = new Date(composer.scheduledAt);
        if (!Number.isNaN(d.getTime())) body.scheduledAt = d.toISOString();
      }
      const path = editingId
        ? `/s/mailing/bots/${encodeURIComponent(botId)}/broadcasts/${encodeURIComponent(editingId)}`
        : `/s/mailing/bots/${encodeURIComponent(botId)}/broadcasts`;
      const data = editingId
        ? await mailingApi.patch<{ error?: string; queued?: number }>(path, body)
        : await mailingApi.post<{ error?: string; queued?: number }>(path, body);
      if (data?.error) throw new Error(data.error);
      enqueueSnackbar({
        message: editingId ? 'Обновлено' : `Сохранено (${data?.queued ?? '—'})`,
        variant: 'success',
      });
      resetForm();
      await loadBroadcasts(botId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не сохранено');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: t.muted }}>Загрузка…</div>;
  }

  return (
    <div
      style={{
        height: '100%',
        minHeight: 480,
        padding: 20,
        background: t.panel,
        color: t.ink,
        overflow: 'auto',
        boxSizing: 'border-box',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 650 }}>Рассылка ботом</div>
      <div style={{ fontSize: 13, color: t.muted, marginBottom: 14 }}>
        GramJS / WhatsApp → открытые диалоги. Фильтры стадии CRM и gift-бота, превью,
        правка / дубликат / удаление.
      </div>
      {error ? (
        <div style={{ color: t.danger, marginBottom: 10, fontSize: 13 }}>{error}</div>
      ) : null}

      {!billingOk ? (
        <div style={{ marginBottom: 14, padding: 12, background: t.soft, borderRadius: 10 }}>
          {billing?.trialAvailable ? (
            <button
              type="button"
              disabled={trialBusy}
              onClick={() => void startTrial()}
              style={{
                border: 'none',
                background: t.accent,
                color: '#fff',
                borderRadius: 8,
                padding: '8px 12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Пробный период
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openMailingPayment('mailing_bot')}
              style={{
                border: 'none',
                background: t.accent,
                color: '#fff',
                borderRadius: 8,
                padding: '8px 12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Оплатить {billing?.price || 500} ₽/мес
            </button>
          )}
        </div>
      ) : null}


      {!bots.length ? (
        <div style={{ fontSize: 13, color: t.muted }}>
          Нет gift-ботов
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
          <div>
            <label style={ls}>Бот</label>
            <select
              value={botId}
              disabled={Boolean(editingId)}
              onChange={(e) => setBotId(e.target.value)}
              style={fs}
            >
              {bots.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={ls}>Сегмент</label>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value as 'gifted' | 'not_gifted' | 'all')}
                style={fs}
              >
                <option value="not_gifted">Без подарка</option>
                <option value="gifted">С подарком</option>
                <option value="all">Все</option>
              </select>
            </div>
            <div>
              <label style={ls}>Этап воронки бота</label>
              <select
                value={funnelPhase}
                onChange={(e) => setFunnelPhase(e.target.value as FunnelPhase)}
                style={fs}
              >
                <option value="">Любой</option>
                <option value="started">Старт (/start)</option>
                <option value="awaiting_sub">Ждёт подписку</option>
                <option value="gifted">Подарок выдан</option>
                <option value="not_gifted">Без подарка</option>
              </select>
            </div>
          </div>

          <MailingComposer
            t={t}
            value={composer}
            onChange={setComposer}
            showMediaUrl
            botName={selected ? accountLabel(selected) : undefined}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void save()}
              style={{
                border: 'none',
                background: canSave ? t.ink : t.muted,
                color: t.panel,
                borderRadius: 10,
                padding: '10px 16px',
                fontWeight: 600,
                cursor: canSave ? 'pointer' : 'default',
              }}
            >
              {busy ? '…' : editingId ? 'Сохранить' : 'Сохранить'}
            </button>
            {editingId ? (
              <button type="button" onClick={resetForm} style={{ ...fs, width: 'auto' }}>
                Отмена
              </button>
            ) : null}
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>История</div>
            <MailingHistoryList
              t={t}
              rows={rows}
              onEdit={startEdit}
              onDuplicate={duplicate}
              onDelete={(r) => void remove(r)}
              limit={20}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default defineFrontComponent({
  universalIdentifier: MAILING_BOT_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Voxly Mailing Bot',
  description: 'Gift-bot scheduled mailing',
  component: MailingBotPanel,
});
