'use client';

import { useState } from 'react';
import { LEGAL } from '@/lib/legal';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

export function CustomDevCta({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [task, setTask] = useState('');
  const [sent, setSent] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(`Voxly custom-dev: ${name.trim() || 'заявка'}`);
    const body = encodeURIComponent(
      `Имя: ${name.trim()}\nКонтакт: ${contact.trim()}\n\nЗадача:\n${task.trim()}`,
    );
    window.location.href = `${LEGAL.emailHref}?subject=${subject}&body=${body}`;
    setSent(true);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" className={className || 'friendly-btn touch-manipulation'}>
          Обсудить мою задачу
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Индивидуальная доработка</SheetTitle>
          <SheetDescription>
            Оценка сроков и стоимости — за 24 часа. Напишите задачу — ответим на {LEGAL.email}.
          </SheetDescription>
        </SheetHeader>
        {sent ? (
          <p className="mt-6 text-sm text-slate-600">
            Открыли почтовый клиент. Если письмо не открылось — напишите на{' '}
            <a className="text-blue-600 underline" href={LEGAL.emailHref}>
              {LEGAL.email}
            </a>
            .
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Имя" value={name} onChange={setName} required autoComplete="name" />
            <Field
              label="Телефон или Telegram"
              value={contact}
              onChange={setContact}
              required
              autoComplete="tel"
            />
            <label className="block text-sm font-medium text-slate-800">
              Описание задачи
              <textarea
                required
                rows={5}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                className="friendly-input mt-1.5 w-full resize-y"
              />
            </label>
            <button type="submit" className="friendly-btn w-full touch-manipulation">
              Отправить заявку
            </button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block text-sm font-medium text-slate-800">
      {label}
      <input
        type="text"
        required={required}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="friendly-input mt-1.5 w-full"
      />
    </label>
  );
}
