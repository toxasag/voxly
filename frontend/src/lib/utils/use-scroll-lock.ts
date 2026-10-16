"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Единая механика оверлеев: блокировка прокрутки и закрытие по Escape.
//
// Дефект первый — прокрутка
// -------------------------
// До этого модуля **18 компонентов ставили `document.body.style.overflow`
// независимо друг от друга** — 33 обращения, пара «поставил / снял» в каждом.
// Каждый снимал блокировку безусловно, поэтому тот, кто закрывается первым,
// возвращал прокрутку фону у всех, кто ещё открыт.
//
// Живой сценарий: карточка контакта → «Удалить» → `ConfirmDialog` поверх;
// закрытие подтверждения возвращает прокрутку, хотя карточка открыта. На телефоне
// заметнее — фон уезжает под пальцем.
//
// Дефект второй — Escape
// ----------------------
// Найден тестом на первый: те же 18 компонентов вешали **каждый свой** слушатель
// `keydown` на `document`, поэтому Escape закрывал их все одновременно. В том же
// сценарии нажатие Escape над диалогом подтверждения убирало и диалог, и карточку
// под ним — пользователь терял контекст, хотя отменил только удаление.
//
// Оба дефекта — одной природы: несколько независимых претендентов на одно
// глобальное состояние. Поэтому и решение одно — стек открытых оверлеев.
// Прокрутка блокируется, пока стек не пуст; Escape получает только верхний.
//
// Почему стек в модуле, а не в React-контексте
// -------------------------------------------
// Провайдер пришлось бы поставить в корневой layout и протащить во все 18
// компонентов, часть из которых лежит в разных ветках дерева (`ui/sheet` внутри
// карточки, `ConfirmDialog` поверх неё). Состояние здесь не про рендер: оно
// описывает единственный `document.body` и единственную клавиатуру, то есть по
// природе своей глобально — ровно как сам DOM.
// ---------------------------------------------------------------------------

interface OverlayEntry {
  /** Вызывается по Escape, если оверлей верхний. `null` — закрытие запрещено. */
  onEscape: (() => void) | null;
}

/** Порядок соответствует порядку открытия: последний элемент — верхний оверлей. */
const stack: OverlayEntry[] = [];

/** Значение `overflow` до первой блокировки — возвращается при опустошении. */
let previousOverflow = "";

let keydownAttached = false;

/**
 * Escape получает только верхний оверлей.
 *
 * Слушатель один на модуль, а не по одному на компонент: 18 независимых
 * слушателей и были причиной того, что Escape закрывал всё разом.
 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;

  const top = stack[stack.length - 1];
  if (top === undefined) return;

  // `null` — оверлей занят (идёт отправка формы) и закрываться не должен. Событие
  // при этом не проваливается ниже: иначе Escape закрыл бы карточку под ним,
  // хотя верхний диалог отказался закрываться.
  if (top.onEscape === null) return;

  top.onEscape();
}

function acquire(entry: OverlayEntry): void {
  if (stack.length === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }

  stack.push(entry);

  if (!keydownAttached) {
    document.addEventListener("keydown", handleKeydown);
    keydownAttached = true;
  }

  notify();
}

function release(entry: OverlayEntry): void {
  const index = stack.lastIndexOf(entry);
  if (index !== -1) stack.splice(index, 1);

  if (stack.length === 0) {
    document.body.style.overflow = previousOverflow;
    previousOverflow = "";

    if (keydownAttached) {
      document.removeEventListener("keydown", handleKeydown);
      keydownAttached = false;
    }
  }

  notify();
}

/**
 * Сколько оверлеев открыто.
 *
 * Нужен не только для отладки: мобильный бар обязан скрываться, пока открыт хотя
 * бы один оверлей, иначе его кнопки висят поверх формы.
 */
export function openOverlayCount(): number {
  return stack.length;
}

/** Подписчики на изменение числа оверлеев — их уведомляет `notify()`. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Подписка на открытие и закрытие оверлеев.
 *
 * Нужна мобильному бару: без неё он опрашивал бы счётчик на каждом кадре
 * отрисовки, то есть перерисовывался бы 60 раз в секунду впустую.
 */
function subscribeOverlays(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Открыт ли хотя бы один оверлей.
 *
 * Серверный снимок — `false`: при SSR оверлеев нет по определению, и это не
 * догадка, а факт.
 */
export function useHasOpenOverlay(): boolean {
  return useSyncExternalStore(
    subscribeOverlays,
    () => stack.length > 0,
    () => false,
  );
}

export interface OverlayOptions {
  /**
   * Закрытие по Escape. `undefined` — не закрывать (оверлей всё равно занимает
   * место в стеке и блокирует прокрутку).
   */
  onEscape?: () => void;
  /**
   * Запрет закрытия, пока идёт операция: у форм с отправкой Escape посреди
   * запроса терял бы введённые данные при уже начатом сохранении.
   */
  disabled?: boolean;
}

/**
 * Регистрирует оверлей, пока `open` истинно.
 *
 * Единственный способ блокировать прокрутку и закрывать оверлей по Escape в
 * проекте: прямые обращения к `document.body.style.overflow` и собственные
 * слушатели `keydown` в компонентах и есть те два дефекта, которые хук закрывает.
 */
export function useOverlay(open: boolean, options: OverlayOptions = {}): void {
  const { onEscape, disabled = false } = options;

  // Своя запись в стеке, а не «верхняя»: над этим оверлеем мог открыться другой,
  // и обновление обработчика по позиции досталось бы чужой записи.
  const entryRef = useRef<OverlayEntry | null>(null);

  useEffect(() => {
    if (!open) return;

    // Свежий объект на каждое открытие: он же служит идентификатором записи в
    // стеке, поэтому два оверлея одного компонента не спутаются.
    const entry: OverlayEntry = { onEscape: null };
    entryRef.current = entry;
    acquire(entry);

    return () => {
      release(entry);
      if (entryRef.current === entry) entryRef.current = null;
    };
  }, [open]);

  // Обработчик обновляется отдельно от регистрации: иначе каждое изменение
  // `isPending` или пересоздание колбэка снимало бы оверлей со стека и ставило
  // обратно, а он оказывался бы наверху, обгоняя тех, кто открылся позже.
  useEffect(() => {
    const entry = entryRef.current;
    if (entry === null) return;

    entry.onEscape = disabled || onEscape === undefined ? null : onEscape;
  }, [open, onEscape, disabled]);
}

/**
 * Блокировка прокрутки без обработки Escape.
 *
 * Для оверлеев, которые закрываются иначе (по кнопке или по клику вне), и для
 * тех, у кого своя обработка клавиатуры.
 */
export function useScrollLock(open: boolean): void {
  useOverlay(open);
}
