'use client';

import { FolderPlus, Loader2, Plus, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export interface ProjectItem {
  id: string;
  name: string;
  channelUsername: string | null;
  isActive: boolean;
}

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
}) {
  return (
    <div className="space-y-5">
      {projects.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-secondary/30 px-5 py-10 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <FolderPlus className="h-5 w-5" aria-hidden />
          </div>
          <p className="text-sm font-medium text-foreground">Пока нет проектов</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Создайте первый — или сохраните воронку ниже.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2.5" role="list" aria-label="Проекты бота">
          {projects.map((p) => {
            const selected = p.id === selectedId;
            const toggling = busy === `toggle-${p.id}`;
            return (
              <li key={p.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(p.id);
                    }
                  }}
                  className={cn(
                    'group relative cursor-pointer overflow-hidden rounded-xl border bg-card p-4 pl-4',
                    'transition-[border-color,box-shadow,background-color] duration-[var(--duration-default)] ease-[var(--ease-out)]',
                    'hover:border-foreground/20 hover:shadow-[var(--elevation-1)]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    selected
                      ? 'border-foreground/25 shadow-[var(--elevation-1)] ring-1 ring-foreground/10'
                      : 'border-border',
                    !p.isActive && !selected && 'opacity-90',
                  )}
                >
                  {/* Status rail — active vs paused (skill: clear status without color-only) */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-0 left-0 w-[3px] transition-colors duration-[var(--duration-default)]',
                      p.isActive ? 'bg-emerald-600' : selected ? 'bg-foreground/35' : 'bg-transparent',
                    )}
                  />

                  <div className="flex items-start justify-between gap-4 pl-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[15px] font-semibold tracking-tight">{p.name}</p>
                        {selected && (
                          <span className="rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
                            редактируется
                          </span>
                        )}
                        {p.isActive && (
                          <span className="rounded-md bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                            активен
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                        <Radio
                          className={cn(
                            'h-3 w-3 shrink-0',
                            p.isActive ? 'text-emerald-600' : 'text-muted-foreground/45',
                          )}
                          aria-hidden
                        />
                        <span>
                          {p.channelUsername
                            ? `@${p.channelUsername.replace(/^@/, '')}`
                            : 'канал не задан'}
                        </span>
                        <span className="text-border" aria-hidden>
                          ·
                        </span>
                        {p.isActive ? (
                          <span className="font-medium text-emerald-800">принимает лидов</span>
                        ) : (
                          <span>на паузе</span>
                        )}
                      </p>
                    </div>

                    <div
                      className="flex shrink-0 flex-col items-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <div className="flex min-h-11 items-center gap-2.5">
                        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
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
                      <p className="max-w-[10rem] text-right text-[10px] leading-snug text-muted-foreground">
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

      <div className="rounded-xl border border-border bg-secondary/25 p-4">
        <Label
          htmlFor="new-project-name"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Новый проект
        </Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            id="new-project-name"
            placeholder="Подарок август"
            value={newProjectName}
            onChange={(e) => onNewProjectNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newProjectName.trim()) {
                e.preventDefault();
                onCreate();
              }
            }}
            className="bg-card"
            disabled={busy === 'create-project'}
          />
          <Button
            type="button"
            variant="solid"
            onClick={onCreate}
            disabled={busy === 'create-project' || !newProjectName.trim()}
            className="shrink-0"
          >
            {busy === 'create-project' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            {busy === 'create-project' ? 'Создаём…' : 'Создать'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Новый проект сразу станет активным; текущий активный уйдёт на паузу.
        </p>
      </div>

      {selectedId && (
        <div>
          <Label htmlFor="selected-project-name">Название выбранного проекта</Label>
          <Input
            id="selected-project-name"
            className="mt-1.5"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Сохраняется с воронкой. Попадает в название сделки в CRM.
          </p>
        </div>
      )}
    </div>
  );
}
