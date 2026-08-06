'use client';

import { useState } from 'react';
import { FolderPlus, Loader2, Plus, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export interface ProjectItem {
  id: string;
  name: string;
  channelUsername: string | null;
  isActive: boolean;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
}

/** HTML datetime-local value from ISO (browser local tz). */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function datetimeLocalToIso(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatScheduleHint(p: ProjectItem): string | null {
  const start = p.scheduledStartAt ? new Date(p.scheduledStartAt) : null;
  const end = p.scheduledEndAt ? new Date(p.scheduledEndAt) : null;
  if (!start && !end) return null;
  const fmt = (d: Date) =>
    d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `с ${fmt(start)}`;
  return `до ${fmt(end!)}`;
}

const BTN_PRIMARY =
  'land-btn inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50';
const BTN_GHOST_SM =
  'land-btn-ghost inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50';

export function ProjectPicker({
  projects,
  selectedId,
  projectName,
  newProjectName,
  busy,
  onSelect,
  onToggleActive,
  onProjectNameChange,
  onNewProjectNameChange,
  onCreate,
  onSaveSchedule,
}: {
  projects: ProjectItem[];
  selectedId: string | null;
  projectName: string;
  newProjectName: string;
  busy: string;
  onSelect: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
  onProjectNameChange: (name: string) => void;
  onNewProjectNameChange: (name: string) => void;
  onCreate: () => void;
  onSaveSchedule?: (id: string, startIso: string | null, endIso: string | null) => void;
}) {
  const selected = projects.find((p) => p.id === selectedId) || null;

  return (
    <div className="space-y-5">
      {projects.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-5 py-10 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#f5a623]/25 text-black/55">
            <FolderPlus className="h-5 w-5" aria-hidden />
          </div>
          <p className="text-sm font-semibold text-black">Пока нет проектов</p>
          <p className="mt-1 max-w-xs text-sm text-black/55">
            Создайте первый — или сохраните воронку ниже.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2.5" role="list" aria-label="Проекты бота">
          {projects.map((p) => {
            const isSelected = p.id === selectedId;
            const toggling = busy === `toggle-${p.id}`;
            const scheduleHint = formatScheduleHint(p);
            return (
              <li key={p.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onSelect(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(p.id);
                    }
                  }}
                  className={cn(
                    'group relative cursor-pointer overflow-hidden rounded-xl border bg-white p-4 pl-4',
                    'transition-colors duration-200',
                    'hover:border-black/25',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20',
                    isSelected
                      ? 'border-[#f5a623] bg-[#fff8ec]'
                      : 'border-black/10',
                    !p.isActive && !isSelected && 'opacity-90',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-0 left-0 w-[3px] transition-colors duration-200',
                      p.isActive ? 'bg-[#f5a623]' : isSelected ? 'bg-[#f5a623]/40' : 'bg-transparent',
                    )}
                  />

                  <div className="flex items-start justify-between gap-4 pl-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[15px] font-semibold tracking-tight text-black">
                          {p.name}
                        </p>
                        {isSelected ? (
                          <span className="rounded-md bg-black px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            редактируется
                          </span>
                        ) : null}
                        {p.isActive ? (
                          <span className="rounded-full bg-[#f5a623]/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-black">
                            активен
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-black/55">
                        <Radio
                          className={cn(
                            'h-3 w-3 shrink-0',
                            p.isActive ? 'text-black' : 'text-black/40',
                          )}
                          aria-hidden
                        />
                        <span>
                          {p.channelUsername
                            ? `@${p.channelUsername.replace(/^@/, '')}`
                            : 'канал не задан'}
                        </span>
                        <span className="text-black/25" aria-hidden>
                          ·
                        </span>
                        {p.isActive ? (
                          <span className="font-medium text-black">принимает лидов</span>
                        ) : (
                          <span>на паузе</span>
                        )}
                      </p>
                      {scheduleHint ? (
                        <p className="mt-1 text-[11px] text-black/45">Расписание: {scheduleHint}</p>
                      ) : null}
                    </div>

                    <div
                      className="flex shrink-0 flex-col items-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <div className="flex min-h-11 items-center gap-2.5">
                        <span className="text-[11px] font-medium tabular-nums text-black/45">
                          {toggling ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : p.isActive ? (
                            'Активен'
                          ) : (
                            'Выкл'
                          )}
                        </span>
                        <Switch
                          checked={p.isActive}
                          disabled={toggling || busy.startsWith('toggle-')}
                          onCheckedChange={(checked) => onToggleActive(p.id, checked)}
                          aria-label={
                            p.isActive
                              ? `Выключить проект «${p.name}»`
                              : `Сделать «${p.name}» активным (остальные встанут на паузу)`
                          }
                        />
                      </div>
                      <p className="max-w-[10rem] text-right text-[10px] leading-snug text-black/45">
                        {p.isActive
                          ? 'Принимает лидов'
                          : 'Включите — остальные встанут на паузу'}
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected && onSaveSchedule ? (
        <ScheduleEditor
          key={selected.id}
          project={selected}
          busy={busy === `schedule-${selected.id}`}
          onSave={onSaveSchedule}
        />
      ) : null}

      <div className="rounded-xl border border-black/10 bg-[#faf8f5] p-4">
        <Label
          htmlFor="new-project-name"
          className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
        >
          Новый проект
        </Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            id="new-project-name"
            value={newProjectName}
            onChange={(e) => onNewProjectNameChange(e.target.value)}
            placeholder="Название проекта"
            className="border-black/15 bg-white sm:flex-1"
          />
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={onCreate}
            disabled={busy === 'create-project' || !newProjectName.trim()}
          >
            {busy === 'create-project' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Создать
          </button>
        </div>
      </div>

      {selectedId ? (
        <div>
          <Label htmlFor="project-name-edit">Имя выбранного проекта</Label>
          <Input
            id="project-name-edit"
            className="mt-1.5 border-black/15 bg-white"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}

function ScheduleEditor({
  project,
  busy,
  onSave,
}: {
  project: ProjectItem;
  busy: boolean;
  onSave: (id: string, startIso: string | null, endIso: string | null) => void;
}) {
  const [startLocal, setStartLocal] = useState(isoToDatetimeLocal(project.scheduledStartAt));
  const [endLocal, setEndLocal] = useState(isoToDatetimeLocal(project.scheduledEndAt));

  return (
    <div
      className="rounded-xl border border-black/10 bg-[#faf8f5] p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="font-semibold text-black">Расписание «{project.name}»</p>
      <p className="mt-1 text-xs leading-snug text-black/55">
        Автозапуск и остановка: день 1 — один проект, день 2 — другой. Пустые поля = только ручной
        переключатель. Одновременно активен один проект на бота.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`sched-start-${project.id}`} className="text-xs text-black/45">
            Старт
          </Label>
          <Input
            id={`sched-start-${project.id}`}
            type="datetime-local"
            className="mt-1.5 border-black/15 bg-white"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`sched-end-${project.id}`} className="text-xs text-black/45">
            Стоп
          </Label>
          <Input
            id={`sched-end-${project.id}`}
            type="datetime-local"
            className="mt-1.5 border-black/15 bg-white"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={busy}
          onClick={() =>
            onSave(project.id, datetimeLocalToIso(startLocal), datetimeLocalToIso(endLocal))
          }
        >
          {busy ? '…' : 'Сохранить расписание'}
        </button>
        <button
          type="button"
          className={BTN_GHOST_SM}
          disabled={busy}
          onClick={() => {
            setStartLocal('');
            setEndLocal('');
            onSave(project.id, null, null);
          }}
        >
          Сбросить
        </button>
      </div>
    </div>
  );
}
