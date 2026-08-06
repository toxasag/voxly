import { useRef, type CSSProperties } from 'react';

import {
  fieldStyle,
  labelStyle,
  type useMailingTheme,
} from 'src/lib/mailing-remote';
import { TELEGRAM_CLIENT_MD_HINT, wrapSelection } from './mailing-md';
import { MailingPreview } from './mailing-preview';

type Theme = ReturnType<typeof useMailingTheme>;

const FORMAT_ITEMS = [
  { label: 'Жирный', before: '**', after: '**' },
  { label: 'Курсив', before: '__', after: '__' },
  { label: 'Зачёркнутый', before: '~~', after: '~~' },
  { label: 'Спойлер', before: '||', after: '||' },
  { label: 'Код', before: '`', after: '`' },
] as const;

export type MailingComposerValue = {
  text: string;
  mediaUrl: string;
  mediaType: 'photo' | 'video' | '';
  scheduledAt: string;
  /** Gift bot: Telegram file_id from media upload */
  telegramFileId?: string;
};

export function MailingComposer({
  t,
  value,
  onChange,
  showSchedule = true,
  showMediaUrl = true,
  mediaRequired = false,
  allowTelegramFileId = false,
  botName,
  previewLabel = 'Превью',
}: {
  t: Theme;
  value: MailingComposerValue;
  onChange: (next: MailingComposerValue) => void;
  showSchedule?: boolean;
  showMediaUrl?: boolean;
  mediaRequired?: boolean;
  allowTelegramFileId?: boolean;
  botName?: string;
  previewLabel?: string;
}) {
  const fs = fieldStyle(t);
  const ls = labelStyle(t);
  const selRef = useRef({ start: 0, end: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);

  const syncSelection = (el: {
    selectionStart: number | null;
    selectionEnd: number | null;
  }) => {
    selRef.current = {
      start: el.selectionStart ?? 0,
      end: el.selectionEnd ?? 0,
    };
  };

  const applyFormat = (before: string, after: string) => {
    const { start, end } = selRef.current;
    const next = wrapSelection(value.text, start, end, before, after);
    onChange({ ...value, text: next.text });
    selRef.current = { start: next.nextStart, end: next.nextEnd };
  };

  const btnStyle: CSSProperties = {
    border: `1px solid ${t.border}`,
    background: t.soft,
    color: t.ink,
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 11,
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <label style={ls}>Текст</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {FORMAT_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              style={btnStyle}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFormat(item.before, item.after)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <textarea
          value={value.text}
          rows={5}
          placeholder={TELEGRAM_CLIENT_MD_HINT}
          onChange={(e) => {
            syncSelection(e.target);
            onChange({ ...value, text: e.target.value });
          }}
          onSelect={(e) => syncSelection(e.currentTarget)}
          onKeyUp={(e) => syncSelection(e.currentTarget)}
          onClick={(e) => syncSelection(e.currentTarget)}
          onContextMenu={(e) => {
            e.preventDefault();
            const menu = menuRef.current;
            if (!menu) return;
            menu.style.display = 'block';
            menu.style.left = `${e.clientX}px`;
            menu.style.top = `${e.clientY}px`;
          }}
          style={{ ...fs, resize: 'vertical', minHeight: 100 }}
        />
        <div
          ref={menuRef}
          style={{
            display: 'none',
            position: 'fixed',
            zIndex: 50,
            background: t.panel,
            border: `1px solid ${t.border}`,
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}
          onMouseLeave={() => {
            if (menuRef.current) menuRef.current.style.display = 'none';
          }}
        >
          {FORMAT_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: t.ink,
                padding: '6px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
              onClick={() => {
                applyFormat(item.before, item.after);
                if (menuRef.current) menuRef.current.style.display = 'none';
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: t.muted, marginTop: 4 }}>
          {TELEGRAM_CLIENT_MD_HINT}
        </div>
      </div>

      {showMediaUrl ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <label style={ls}>
              Медиа URL (HTTPS{mediaRequired ? ', обязательно' : ', опционально'})
            </label>
            <input
              value={value.mediaUrl}
              onChange={(e) => {
                const url = e.target.value;
                let mediaType = value.mediaType;
                if (!mediaType && url) {
                  mediaType = /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'photo';
                }
                onChange({
                  ...value,
                  mediaUrl: url,
                  mediaType,
                  telegramFileId: allowTelegramFileId ? undefined : value.telegramFileId,
                });
              }}
              style={fs}
              placeholder="https://..."
            />
          </div>
          {value.mediaUrl || value.telegramFileId ? (
            <div>
              <label style={ls}>Тип медиа</label>
              <select
                value={value.mediaType || 'photo'}
                onChange={(e) =>
                  onChange({
                    ...value,
                    mediaType: e.target.value as 'photo' | 'video',
                  })
                }
                style={fs}
              >
                <option value="photo">Фото</option>
                <option value="video">Видео</option>
              </select>
            </div>
          ) : null}
        </div>
      ) : null}

      {showSchedule ? (
        <div>
          <label style={ls}>Дата и время отправки</label>
          <input
            type="datetime-local"
            value={value.scheduledAt}
            onChange={(e) => onChange({ ...value, scheduledAt: e.target.value })}
            style={fs}
          />
          <div style={{ fontSize: 11, color: t.muted, marginTop: 4 }}>
            Пусто = отправить сразу (сканер ~15с). Иначе — в указанное время.
          </div>
        </div>
      ) : null}

      <div>
        <div style={{ ...ls, marginBottom: 8 }}>{previewLabel}</div>
        <MailingPreview
          text={value.text}
          mediaUrl={value.mediaUrl || null}
          mediaType={value.mediaType || 'photo'}
          mediaPlaceholder={Boolean(value.telegramFileId) && !value.mediaUrl}
          botName={botName}
        />
      </div>
    </div>
  );
}
