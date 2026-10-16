"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Minus, Plus, X } from "lucide-react";
import {
  AvatarError,
  encodeAvatar,
  MAX_ZOOM,
  MIN_ZOOM,
  releaseImage,
  type CropArea,
} from "@/lib/utils/avatar";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

// ---------------------------------------------------------------------------
// Кадрирование аватара: зум и перетаскивание.
//
// Реализовано на canvas без `react-easy-crop`: библиотека весит ~300 КБ и
// закрывает один экран, тогда как здесь нужны только квадратная рамка, масштаб и
// сдвиг. Проверено, что версия 6.2.3 совместима с React 19, — отказ не из-за
// несовместимости, а из-за несоразмерности зависимости задаче.
//
// Модель состояния: `zoom` и `center` в координатах *исходного* изображения, а не
// экрана. Экранные координаты зависят от размера окна, и при его изменении рамка
// «прыгала» бы.
//
// Геометрия «cover», а не «contain»: рамка обрезки — квадрат, а фотографии обычно
// прямоугольные. Прежняя версия считала сторону окна как
// `min(width, height) / zoom` и ограничивала центр по обеим осям одинаково. Для
// снимка 900×400 это давало по вертикали диапазон нулевой ширины: центр
// «прилипал» к середине, вертикальное перетаскивание не работало вовсе.
// Здесь окно определяется независимо по каждой оси, поэтому короткая сторона
// всегда заполняет рамку целиком, а двигать можно вдоль длинной.
// ---------------------------------------------------------------------------

/** Сторона области предпросмотра в CSS-пикселях. */
const VIEWPORT = 288;

interface AvatarCropModalProps {
  open: boolean;
  image: HTMLImageElement | null;
  /** objectURL для показа; освобождается при закрытии. */
  imageUrl: string | null;
  onCancel: () => void;
  onApply: (dataUri: string) => void | Promise<void>;
  isPending: boolean;
}

export function AvatarCropModal({
  open,
  image,
  imageUrl,
  onCancel,
  onApply,
  isPending,
}: AvatarCropModalProps) {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  // Центр рамки в координатах исходного изображения.
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dragStart = useRef<{ pointerX: number; pointerY: number; centerX: number; centerY: number } | null>(
    null,
  );

  /**
   * Сторона видимой области в пикселях исходника.
   *
   * При зуме 1 равна короткой стороне: квадрат вписан в изображение так, что
   * пустого фона нет ни с одной стороны (cover). Дальше делится на зум.
   */
  const cropSize = useMemo(() => {
    if (image === null) return 0;
    return Math.min(image.naturalWidth, image.naturalHeight) / zoom;
  }, [image, zoom]);

  /**
   * Во сколько экранных пикселей превращается один пиксель исходника.
   *
   * Вынесено из разметки, потому что участвует и в переводе сдвига мыши: там и
   * тут должен использоваться один и тот же масштаб, иначе перетаскивание
   * «убегает» от курсора.
   */
  const displayScale = useMemo(() => {
    if (image === null || cropSize === 0) return 1;
    return VIEWPORT / cropSize;
  }, [image, cropSize]);

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onCancel, disabled: isPending });

  // Сброс при открытии нового файла: иначе прошлый зум применился бы к другому
  // изображению и рамка оказалась бы не там, где пользователь её оставил.
  useEffect(() => {
    if (!open || image === null) return;

    setZoom(MIN_ZOOM);
    setCenter({ x: image.naturalWidth / 2, y: image.naturalHeight / 2 });
    setError(null);
  }, [open, image]);


  /**
   * Держит рамку внутри изображения, не давая пустому фону попасть в обрезку.
   *
   * Ограничение считается по каждой оси отдельно. Если по оси изображение короче
   * рамки (это возможно только из-за округлений при zoom = 1), центр
   * фиксируется по середине: подвинуть его некуда, и попытка «поджать» к краю
   * втянула бы в кадр пустоту.
   */
  const clampCenter = useCallback(
    (next: { x: number; y: number }, size: number): { x: number; y: number } => {
      if (image === null) return next;

      const half = size / 2;

      const limit = (value: number, extent: number): number => {
        if (extent <= size) return extent / 2;
        return Math.max(half, Math.min(value, extent - half));
      };

      return {
        x: limit(next.x, image.naturalWidth),
        y: limit(next.y, image.naturalHeight),
      };
    },
    [image],
  );

  /**
   * Изменение масштаба с сохранением точки фокуса.
   *
   * Центр рамки остаётся на том же месте изображения, поэтому при зуме картинка
   * «раздвигается» вокруг выбранного фрагмента, а не съезжает. Поджатие к
   * границам выполняется здесь же, в одном обновлении со зумом: прежняя версия
   * делала это отдельным `useEffect` после рендера, и кадр успевал мигнуть с
   * пустым фоном по краю.
   */
  const applyZoom = useCallback(
    (next: number) => {
      if (image === null) return;

      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      const nextCrop = Math.min(image.naturalWidth, image.naturalHeight) / clampedZoom;

      setZoom(clampedZoom);
      setCenter((previous) => clampCenter(previous, nextCrop));
    },
    [image, clampCenter],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (image === null || isPending) return;

      // setPointerCapture: перетаскивание продолжается, даже когда курсор вышел
      // за пределы области, иначе рамка «залипала» на границе.
      event.currentTarget.setPointerCapture(event.pointerId);

      dragStart.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        centerX: center.x,
        centerY: center.y,
      };
      setIsDragging(true);
    },
    [image, isPending, center],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStart.current;
      if (start === null || image === null || cropSize === 0) return;

      // Перевод экранного сдвига в пиксели исходника: рамка VIEWPORT на экране
      // показывает cropSize пикселей изображения. Один и тот же `displayScale`
      // используется и при отрисовке — иначе картинка отставала бы от курсора.
      const next = {
        x: start.centerX - (event.clientX - start.pointerX) / displayScale,
        y: start.centerY - (event.clientY - start.pointerY) / displayScale,
      };

      setCenter(clampCenter(next, cropSize));
    },
    [image, cropSize, displayScale, clampCenter],
  );

  const handlePointerUp = useCallback(() => {
    dragStart.current = null;
    setIsDragging(false);
  }, []);

  /** Колесо мыши меняет масштаб — привычнее, чем только ползунок. */
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (isPending) return;
      event.preventDefault();

      // Множитель, а не сложение: шаг зума пропорционален текущему масштабу,
      // иначе у большого приближения колесо почти не даёт эффекта, а у малого
      // проскакивает предел с одного щелчка.
      applyZoom(zoom * Math.exp(-event.deltaY * 0.0015));
    },
    [isPending, applyZoom, zoom],
  );

  const handleApply = useCallback(async () => {
    if (image === null) return;

    try {
      const crop: CropArea = {
        x: center.x - cropSize / 2,
        y: center.y - cropSize / 2,
        size: cropSize,
      };

      await onApply(encodeAvatar(image, crop));
    } catch (caught) {
      setError(caught instanceof AvatarError ? caught.message : "Не удалось обработать изображение");
    }
  }, [image, center, cropSize, onApply]);

  const handleCancel = useCallback(() => {
    if (imageUrl !== null) releaseImage(imageUrl);
    onCancel();
  }, [imageUrl, onCancel]);

  if (!open || image === null || imageUrl === null) return null;

  // Размеры изображения на экране. `displayScale` общий с обработчиком
  // перетаскивания, поэтому сдвиг курсора и сдвиг картинки совпадают точно.
  const displayWidth = image.naturalWidth * displayScale;
  const displayHeight = image.naturalHeight * displayScale;

  // Сдвиг так, чтобы выбранный центр оказался в середине области.
  const left = VIEWPORT / 2 - center.x * displayScale;
  const top = VIEWPORT / 2 - center.y * displayScale;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 id="crop-title" className="text-sm font-semibold text-slate-100">
            Выберите область фото
          </h2>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isPending}
            aria-label="Закрыть"
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {/* Область предпросмотра с круглой рамкой */}
          <div
            className={cn(
              "relative mx-auto overflow-hidden rounded-lg bg-slate-950 select-none",
              isDragging ? "cursor-grabbing" : "cursor-grab",
            )}
            style={{ width: VIEWPORT, height: VIEWPORT }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          >
            {/*
              maxWidth/maxHeight: "none" — обязательно.

              Preflight Tailwind объявляет `img { max-width: 100% }`, и это
              правило перебивало инлайновую ширину: у снимка 900×400 при зуме 1
              вместо 648 px изображение рисовалось шириной 288 px, то есть
              сжималось по горизонтали вдвое. Пропорции ломались, а
              перетаскивание выглядело неработающим, потому что картинка была не
              того размера, из которого исходил расчёт. Проверено в браузере:
              инлайновый width 842px против вычисленного 288px.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element -- objectURL локального файла: next/image требует внешний URL */}
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              className="absolute origin-top-left"
              style={{
                width: displayWidth,
                height: displayHeight,
                maxWidth: "none",
                maxHeight: "none",
                left,
                top,
              }}
            />

            {/*
              Затемнение вне круга. Реализовано box-shadow с огромным разлётом
              внутрь: это один элемент вместо четырёх накладок, и он не
              перехватывает события указателя.
            */}
            <div
              className="pointer-events-none absolute inset-0 rounded-full border-2 border-amber-500/80"
              style={{ boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.72)" }}
            />
          </div>

          {/* Масштаб */}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => applyZoom(zoom - 0.2)}
              disabled={isPending || zoom <= MIN_ZOOM}
              aria-label="Уменьшить"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30"
            >
              <Minus className="h-4 w-4" />
            </button>

            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={isPending}
              onChange={(event) => applyZoom(Number(event.target.value))}
              aria-label="Масштаб"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-amber-500 disabled:opacity-40"
            />

            <button
              type="button"
              onClick={() => applyZoom(zoom + 0.2)}
              disabled={isPending || zoom >= MAX_ZOOM}
              aria-label="Увеличить"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-2 text-center text-xs text-slate-500">
            Перетащите фото мышью, масштаб — ползунком или колесом
          </p>

          {error !== null && (
            <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-400">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Сохраняем...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Применить
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
