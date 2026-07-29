import { defineFrontComponent } from 'twenty-sdk/define';
import { enqueueSnackbar, useColorScheme } from 'twenty-sdk/front-component';
import { useCallback, useEffect, useState } from 'react';

import { MAILING_ACCOUNTS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
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
  type StageOpt,
} from 'src/lib/mailing-remote';

type Channel = 'gramjs' | 'wa';
type GiftStarted = 'any' | 'yes' | 'no';
type FunnelPhase = '' | 'started' | 'awaiting_sub' | 'gifted' | 'not_gifted';
type ReadStatus = 'any' | 'read' | 'unread';

const emptyComposer = (): MailingComposerValue => ({
  text: '',
  mediaUrl: '',
  mediaType: '',
  scheduledAt: '',
});

function MailingAccountsPanel() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const t = useMailingTheme(dark);
  const fs = fieldStyle(t);
  const ls = labelStyle(t);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState<Channel>('gramjs');
  const [gramjs, setGramjs] = useState<AccountRow[]>([]);
  const [wa, setWa] = useState<AccountRow[]>([]);
  const [stages, setStages] = useState<StageOpt[]>([]);
  const [botId, setBotId] = useState('');
  const [billing, setBilling] = useState<BillingProduct | null>(null);
  const [opportunityStage, setOpportunityStage] = useState('');
  const [giftStarted, setGiftStarted] = useState<GiftStarted>('any');
  const [funnelPhase, setFunnelPhase] = useState<FunnelPhase>('');
  const [readStatus, setReadStatus] = useState<ReadStatus>('any');
  const [composer, setComposer] = useState<MailingComposerValue>(emptyComposer);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);
  const [rows, setRows] = useState<BroadcastRow[]>([]);

  const accounts = channel === 'gramjs' ? gramjs : wa;

  const loadContext = useCallback(async () => {
    const data = await mailingApi.get<{
      gramjsAccounts?: AccountRow[];
      waAccounts?: AccountRow[];
      stages?: StageOpt[];
      billing?: {
        trialDays?: number;
        products?: { mailing_accounts?: BillingProduct };
      };
      error?: string;
    }>('/s/mailing/context');
    if (data?.error) throw new Error(data.error);
    setGramjs(data?.gramjsAccounts || []);
    setWa(data?.waAccounts || []);
    setStages(data?.stages || []);
    setBilling(data?.billing?.products?.mailing_accounts || null);
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
    setRows((data?.broadcasts || []).filter((b) => b.channel !== 'story'));
  }, []);

  useEffect(() => {
    void loadContext()
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [loadContext]);

  useEffect(() => {
    const list = channel === 'gramjs' ? gramjs : wa;
    setBotId((prev) =>
      prev && list.some((a) => a.id === prev) ? prev : list[0]?.id || '',
    );
  }, [channel, gramjs, wa]);

  useEffect(() => {
    if (!botId) return;
    void loadBroadcasts(botId).catch((e) =>
      setError(e instanceof Error ? e.message : 'Ошибка истории'),
    );
  }, [botId, loadBroadcasts]);

  const billingOk = Boolean(billing?.isActive);
  const selected = accounts.find((a) => a.id === botId) || null;
  const canSave =
    billingOk && Boolean(botId) && composer.text.trim().length > 0 && !busy;

  const resetForm = () => {
    setEditingId(null);
    setComposer(emptyComposer());
    setOpportunityStage('');
    setGiftStarted('any');
    setFunnelPhase('');
    setReadStatus('any');
  };

  const startEdit = (row: BroadcastRow) => {
    if (row.status !== 'scheduled' && row.status !== 'draft') return;
    setEditingId(row.id);
    setOpportunityStage(row.opportunityStage || '');
    setGiftStarted((row.giftStarted as GiftStarted) || 'any');
    setFunnelPhase((row.funnelPhase as FunnelPhase) || '');
    setReadStatus((row.readStatus as ReadStatus) || 'any');
    setComposer({
      text: row.text || '',
      mediaUrl: row.mediaUrl || '',
      mediaType: (row.mediaType as 'photo' | 'video') || '',
      scheduledAt: toLocalInputValue(row.scheduledAt),
    });
  };

  const duplicate = (row: BroadcastRow) => {
    setEditingId(null);
    setOpportunityStage(row.opportunityStage || '');
    setGiftStarted((row.giftStarted as GiftStarted) || 'any');
    setFunnelPhase((row.funnelPhase as FunnelPhase) || '');
    setReadStatus((row.readStatus as ReadStatus) || 'any');
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
        type: 'mailing_accounts',
      });
      if (data?.error) throw new Error(data.error);
      await loadContext();
      enqueueSnackbar({ message: 'Trial аккаунтов включён', variant: 'success' });
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
      if (opportunityStage) body.opportunityStage = opportunityStage;
      if (giftStarted !== 'any') body.giftStarted = giftStarted;
      if (funnelPhase) body.funnelPhase = funnelPhase;
      if (readStatus !== 'any') body.readStatus = readStatus;
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
      <div style={{ fontSize: 18, fontWeight: 650 }}>Рассылка с аккаунтов</div>
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
              onClick={() => openMailingPayment('mailing_accounts')}
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['gramjs', 'wa'] as Channel[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setChannel(c);
              resetForm();
            }}
            style={{
              border: `1px solid ${t.border}`,
              background: channel === c ? t.ink : t.soft,
              color: channel === c ? t.panel : t.ink,
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {c === 'gramjs' ? 'GramJS' : 'WhatsApp'}
          </button>
        ))}
      </div>

      {!accounts.length ? (
        <div style={{ fontSize: 13, color: t.muted }}>
          Нет аккаунтов. Подключите в кабинете (AI → GramJS / WhatsApp).
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
          <div>
            <label style={ls}>Аккаунт</label>
            <select
              value={botId}
              disabled={Boolean(editingId)}
              onChange={(e) => setBotId(e.target.value)}
              style={fs}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={ls}>Стадия сделки (CRM)</label>
              <select
                value={opportunityStage}
                onChange={(e) => setOpportunityStage(e.target.value)}
                style={fs}
              >
                <option value="">Любая / все диалоги</option>
                {stages.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={ls}>Запустил gift-бота</label>
              <select
                value={giftStarted}
                onChange={(e) => setGiftStarted(e.target.value as GiftStarted)}
                style={fs}
              >
                <option value="any">Не важно</option>
                <option value="yes">Да</option>
                <option value="no">Нет</option>
              </select>
            </div>
            <div>
              <label style={ls}>Фаза gift-воронки</label>
              <select
                value={funnelPhase}
                onChange={(e) => setFunnelPhase(e.target.value as FunnelPhase)}
                style={fs}
              >
                <option value="">Любая</option>
                <option value="started">Старт (/start)</option>
                <option value="awaiting_sub">Ждёт подписку</option>
                <option value="gifted">Подарок выдан</option>
                <option value="not_gifted">Без подарка</option>
              </select>
            </div>
            <div>
              <label style={ls}>Прочитано (фильтр)</label>
              <select
                value={readStatus}
                onChange={(e) => setReadStatus(e.target.value as ReadStatus)}
                style={fs}
              >
                <option value="any">Любые</option>
                <option value="read">Прочитано</option>
                <option value="unread">Не прочитано</option>
              </select>
              <div style={{ fontSize: 11, color: t.muted, marginTop: 4 }}>
                Receipts для WA/GramJS — после отправки; gift-бот read не отдаёт.
              </div>
            </div>
          </div>

          <MailingComposer
            t={t}
            value={composer}
            onChange={setComposer}
            showMediaUrl={channel === 'wa'}
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
  universalIdentifier: MAILING_ACCOUNTS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Voxly Mailing Accounts',
  description: 'GramJS/WA scheduled mailing',
  component: MailingAccountsPanel,
});
