---
name: 21st-shadcn
description: Регламент и стандарты создания UI-компонентов на базе shadcn/ui, Tailwind CSS и Lucide Icons
---

# Навык: 21st.dev & shadcn/ui Best Practices

При создании любых UI-компонентов, секций лендинга или дашбордов строго следуй этим правилам:

## 1. Базовые правила верстки
- Используй **Tailwind CSS** для всех стилей. Никаких кастомных `.css` файлов или инлайн-стилей `style={{}}`.
- Все интерактивные компоненты Next.js с хуками (`useState`, `useEffect`, `useForm`) должны начинаться с `"use client";`.
- Для иконок используй исключительно библиотеку **`lucide-react`**.
- Для слияния классов всегда используй утилиту `cn()` из `@/lib/utils` (на базе `clsx` и `tailwind-merge`).

## 2. Цветовая палитра и темы (Dark Theme First)
- Основной фон страницы: `bg-slate-950` или `bg-zinc-950`.
- Карточки и модальные окна: `bg-slate-900/80` с рамкой `border border-slate-800`.
- Акцентный цвет (CTA кнопки, активные статусы, фокусы): `amber-500` / `orange-400`.
- Текст: основной `text-slate-100`, вторичный/пояснения `text-slate-400`.
- Статусы: успех `emerald-500`, ошибка `rose-500`, внимание `amber-500`, информация `blue-500`.

## 3. Архитектура и доступность (a11y)
- Используй семантические теги HTML5: `<section>`, `<header>`, `<main>`, `<article>`, `<aside>`.
- Все формы должны оборачиваться в `React Hook Form` и валидироваться через `Zod`.
- Все кнопки должны иметь состояния `hover:`, `active:`, `disabled:opacity-50` и `focus-visible:ring-2`.
- Анимации должны быть плавными и быстрыми: `transition-all duration-200 ease-in-out`.

## 4. Структура импортов компонентов
- Примитивы shadcn импортируются из `@/components/ui/[component]`.
- Составные блоки лендинга хранятся в `@/components/landing/[BlockName].tsx`.
- Блоки авторизации хранятся в `@/components/auth/[FormName].tsx`.