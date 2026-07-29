import type { CSSProperties } from 'react';

import {
  formatWhen,
  type BroadcastRow,
  type useMailingTheme,
} from 'src/lib/mailing-remote';
import { MailingPreview } from './mailing-preview';

type Theme = ReturnType<typeof useMailingTheme>;

export function broadcastStatusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return 'Черновик';
    case 'scheduled':
      return 'Запланировано';
    case 'sending':
      return 'Отправляется';
    case 'sent':
      return 'Отправлено';
    case 'failed':
      return 'Ошибка';
    case 'cancelled':
      return 'Отменено';
    default:
      return status;
  }
}

export function MailingHistoryList({
  t,
  rows,
  onEdit,
  onDuplicate,
  onDelete,
  emptyText = 'Пока пусто',
  limit = 25,
}: {
  t: Theme;
  rows: BroadcastRow[];
  onEdit: (row: BroadcastRow) => void;
  onDuplicate: (row: BroadcastRow) => void;
  onDelete?: (row: BroadcastRow) => void;
  emptyText?: string;
  limit?: number;
}) {
  const linkBtn = (color: string): CSSProperties => ({
    border: 'none',
    background: 'transparent',
    color,
    fontSize: 12,
    cursor: 'pointer',
    padding: 0,
  });

  if (!rows.length) {
    return <div style={{ fontSize: 13, color: t.muted }}>{emptyText}</div>;
  }

  return (
    <div
      style={{
        border: `1px solid ${t.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {rows.slice(0, limit).map((r, i) => {
        const canEdit = r.status === 'scheduled' || r.status === 'draft';
        const canDelete = canEdit && Boolean(onDelete);
        const delivered = Number(r.deliveredCount) || 0;
        const read = Number(r.readCount) || 0;
        const failed = Number(r.failedCount) || 0;
        return (
          <div
            key={r.id}
            style={{
              padding: '12px',
              borderTop: i === 0 ? 'none' : `1px solid ${t.border}`,
              fontSize: 12,
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong>{broadcastStatusLabel(r.status)}</strong>
              <span style={{ color: t.muted }}>
                {formatWhen(r.scheduledAt || r.createdAt)}
              </span>
              <span style={{ color: t.muted }}>
                {r.sentCount}/{r.totalCount}
              </span>
              {delivered > 0 || read > 0 || failed > 0 ? (
                <span style={{ color: t.muted }}>
                  · доставлено {delivered}
                  {read > 0 ? ` · прочитано ${read}` : ''}
                  {failed > 0 ? ` · ошибок ${failed}` : ''}
                </span>
              ) : null}
            </div>
            <MailingPreview
              text={r.text || ''}
              mediaUrl={r.mediaUrl}
              mediaType={r.mediaType}
              mediaPlaceholder={Boolean(r.telegramFileId) && !r.mediaUrl}
              style={{ maxWidth: 320 }}
            />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {canEdit ? (
                <button type="button" onClick={() => onEdit(r)} style={linkBtn(t.accent)}>
                  Изменить
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onDuplicate(r)}
                style={linkBtn(t.accent)}
              >
                Дублировать
              </button>
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete?.(r)}
                  style={linkBtn(t.danger)}
                >
                  Удалить
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
