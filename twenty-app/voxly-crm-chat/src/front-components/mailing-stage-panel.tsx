import { defineFrontComponent } from 'twenty-sdk/define';
import { enqueueSnackbar, useColorScheme } from 'twenty-sdk/front-component';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { MAILING_STAGE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import {
  MailingComposer,
  type MailingComposerValue,
} from 'src/front-components/mailing/mailing-composer';
import { MailingPreview } from 'src/front-components/mailing/mailing-preview';
import {
  accountLabel,
  fieldStyle,
  labelStyle,
  mailingApi,
  openMailingPayment,
  useMailingTheme,
  type AccountRow,
  type BillingProduct,
} from 'src/lib/mailing-remote';

type StageOpt = { value: string; label: string };
type StageChannel = 'gift' | 'gramjs' | 'wa';
type StageRule = {
  id: string;
  botId: string;
  channel?: string;
  name: string;
  stageValue: string;
  text: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  enabled: boolean;
  updatedAt?: string;
};

const emptyComposer = (): MailingComposerValue => ({
  text: '',
  mediaUrl: '',
  mediaType: '',
  scheduledAt: '',
});

function channelLabel(c: string | undefined): string {
  if (c === 'gramjs') return 'GramJS';
  if (c === 'wa') return 'WhatsApp';
  return 'Бот';
}

function MailingStagePanel() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const t = useMailingTheme(dark);
  const fs = fieldStyle(t);
  const ls = labelStyle(t);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [giftBots, setGiftBots] = useState<AccountRow[]>([]);
  const [gramjs, setGramjs] = useState<AccountRow[]>([]);
  const [wa, setWa] = useState<AccountRow[]>([]);
  const [stages, setStages] = useState<StageOpt[]>([]);
  const [billing, setBilling] = useState<BillingProduct | null>(null);
  const [rules, setRules] = useState<StageRule[]>([]);
  const [channel, setChannel] = useState<StageChannel>('gift');
  const [botId, setBotId] = useState('');
  const [stageValue, setStageValue] = useState('');
  const [name, setName] = useState('');
  const [composer, setComposer] = useState<MailingComposerValue>(emptyComposer);
  const [enabled, setEnabled] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);

  const senders = useMemo(() => {
    if (channel === 'gramjs') return gramjs;
    if (channel === 'wa') return wa;
    return giftBots;
  }, [channel, giftBots, gramjs, wa]);

  const reload = useCallback(async () => {
    const [ctx, rulesRes] = await Promise.all([
      mailingApi.get<{
        giftBots?: AccountRow[];
        bots?: AccountRow[];
        gramjsAccounts?: AccountRow[];
        waAccounts?: AccountRow[];
        stages?: StageOpt[];
        billing?: { products?: { mailing_bot?: BillingProduct } };
        error?: string;
      }>('/s/mailing/context'),
      mailingApi.get<{
        rules?: StageRule[];
        stages?: StageOpt[];
        error?: string;
      }>('/s/mailing/stage-rules'),
    ]);
    if (ctx?.error) throw new Error(ctx.error);
    if (rulesRes?.error) throw new Error(rulesRes.error);
    setGiftBots(ctx?.giftBots || ctx?.bots || []);
    setGramjs(ctx?.gramjsAccounts || []);
    setWa(ctx?.waAccounts || []);
    setBilling(ctx?.billing?.products?.mailing_bot || null);
    setStages(rulesRes?.stages || ctx?.stages || []);
    setRules(rulesRes?.rules || []);
    setStageValue((prev) => {
      const opts = rulesRes?.stages || ctx?.stages || [];
      if (prev && opts.some((s) => s.value === prev)) return prev;
      return opts[0]?.value || '';
    });
  }, []);

  useEffect(() => {
    void reload()
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    setBotId((prev) =>
      prev && senders.some((b) => b.id === prev) ? prev : senders[0]?.id || '',
    );
  }, [senders]);

  const billingOk = Boolean(billing?.isActive);
  const selected = senders.find((b) => b.id === botId) || null;
  const canSave =
    billingOk &&
    Boolean(botId) &&
    Boolean(stageValue) &&
    composer.text.trim().length > 0 &&
    !busy;

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setComposer(emptyComposer());
    setEnabled(true);
  };

  const startEdit = (r: StageRule) => {
    setEditingId(r.id);
    setChannel(
      r.channel === 'gramjs' || r.channel === 'wa' ? r.channel : 'gift',
    );
    setBotId(r.botId);
    setStageValue(r.stageValue);
    setName(r.name || '');
    setComposer({
      text: r.text || '',
      mediaUrl: r.mediaUrl || '',
      mediaType: (r.mediaType as 'photo' | 'video') || '',
      scheduledAt: '',
    });
    setEnabled(r.enabled !== false);
  };

  const duplicate = (r: StageRule) => {
    setEditingId(null);
    setChannel(
      r.channel === 'gramjs' || r.channel === 'wa' ? r.channel : 'gift',
    );
    setBotId(r.botId);
    setStageValue(r.stageValue);
    setName(r.name ? `${r.name} (копия)` : '');
    setComposer({
      text: r.text || '',
      mediaUrl: r.mediaUrl || '',
      mediaType: (r.mediaType as 'photo' | 'video') || '',
      scheduledAt: '',
    });
    setEnabled(true);
  };

  const startTrial = async () => {
    setTrialBusy(true);
    try {
      const data = await mailingApi.post<{ error?: string }>('/s/mailing/start-trial', {
        type: 'mailing_bot',
      });
      if (data?.error) throw new Error(data.error);
      await reload();
      enqueueSnackbar({ message: 'Trial включён', variant: 'success' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setTrialBusy(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        botId,
        channel,
        stageValue,
        text: composer.text.trim(),
        name: name.trim(),
        enabled,
        mediaUrl: composer.mediaUrl.trim() || null,
        mediaType: composer.mediaType || null,
      };
      if (editingId) body.id = editingId;
      const data = await mailingApi.post<{ error?: string; rule?: StageRule }>(
        '/s/mailing/stage-rules',
        body,
      );
      if (data?.error) throw new Error(data.error);
      enqueueSnackbar({
        message: editingId ? 'Правило обновлено' : 'Правило сохранено',
        variant: 'success',
      });
      resetForm();
      await reload();
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
      <div style={{ fontSize: 18, fontWeight: 650 }}>По этапу сделки</div>
      <div style={{ fontSize: 13, color: t.muted, marginBottom: 14 }}>
        Вход Opportunity в этап → авто-отправка с gift-бота, GramJS или WhatsApp.
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
              Пробный период (mailing_bot)
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
              Оплатить рассылку ботом
            </button>
          )}
        </div>
      ) : null}

      {!senders.length && channel === 'gift' ? (
        <div style={{ fontSize: 13, color: t.muted }}>Нет gift-ботов</div>
      ) : (
        <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
          <div>
            <label style={ls}>Название правила</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={fs} />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['gift', 'gramjs', 'wa'] as StageChannel[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChannel(c)}
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
                {channelLabel(c)}
              </button>
            ))}
          </div>

          <div>
            <label style={ls}>Отправитель</label>
            {!senders.length ? (
              <div style={{ fontSize: 13, color: t.muted }}>Нет аккаунтов для канала</div>
            ) : (
              <select
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
                style={fs}
              >
                {senders.map((b) => (
                  <option key={b.id} value={b.id}>
                    {accountLabel(b)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label style={ls}>Этап сделки (Opportunity)</label>
            <select
              value={stageValue}
              onChange={(e) => setStageValue(e.target.value)}
              style={fs}
            >
              {stages.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} ({s.value})
                </option>
              ))}
            </select>
          </div>

          <MailingComposer
            t={t}
            value={composer}
            onChange={setComposer}
            showSchedule={false}
            showMediaUrl={channel !== 'gift'}
            botName={selected ? accountLabel(selected) : undefined}
          />

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Правило включено
          </label>

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
              {busy ? '…' : 'Сохранить правило'}
            </button>
            {editingId ? (
              <button type="button" onClick={resetForm} style={{ ...fs, width: 'auto' }}>
                Отмена
              </button>
            ) : null}
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Правила</div>
            {rules.length === 0 ? (
              <div style={{ fontSize: 13, color: t.muted }}>Пока нет</div>
            ) : (
              rules.map((r) => (
                <div
                  key={r.id}
                  style={{
                    borderTop: `1px solid ${t.border}`,
                    padding: '10px 0',
                    fontSize: 12,
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div>
                    <strong>{r.name || 'Без названия'}</strong>
                    {r.enabled ? '' : ' · выкл'} · {channelLabel(r.channel)}
                  </div>
                  <div style={{ color: t.muted }}>этап {r.stageValue}</div>
                  <MailingPreview
                    text={r.text || ''}
                    mediaUrl={r.mediaUrl}
                    mediaType={r.mediaType}
                    style={{ maxWidth: 280 }}
                  />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: t.accent,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicate(r)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: t.accent,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Дублировать
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default defineFrontComponent({
  universalIdentifier: MAILING_STAGE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Voxly Mailing Stage Trigger',
  description: 'Auto-send on Opportunity stage enter',
  component: MailingStagePanel,
});
