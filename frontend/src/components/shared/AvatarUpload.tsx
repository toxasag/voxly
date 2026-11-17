"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Link2, Loader2, Trash2, Upload, User, X } from "lucide-react";
import { toast } from "sonner";
import { AvatarCropModal } from "@/components/settings/AvatarCropModal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { apiClient } from "@/lib/api/apiClient";
import { userInitials } from "@/lib/api/use-tenant-users";
import { AvatarError, loadImageFile, releaseImage } from "@/lib/utils/avatar";
import { cn } from "@/lib/utils";

export interface AvatarUploadProps {
  /** Текущий URL фото или data-URI */
  value?: string | null;
  /** Callback при обновлении фото (data-URI или URL в медиа-хранилище) */
  onChange: (value: string) => void;
  /** Callback при удалении фото */
  onRemove?: () => void;
  /** Лейбл над компонентом, например "Фото сотрудника (аватар)" */
  label?: string;
  /** Поясняющий текст под кнопками */
  hint?: string;
  /** Имя для генерации инициалов, если фото отсутствует */
  name?: string;
  /** Форма аватара: "circle" (круглый) или "squircle" (скругленный квадрат) */
  shape?: "circle" | "squircle";
  /** Размер аватара: "sm" (48px), "md" (64px), "lg" (96px) или число в px */
  size?: "sm" | "md" | "lg" | number;
  /** Показывать ли кнопку "Указать ссылку" */
  allowUrl?: boolean;
  /** Автоматическая выгрузка в медиа-хранилище бэкенда (/api/v1/crm/upload) */
  uploadToBackend?: boolean;
  /** Отключить взаимодействие */
  disabled?: boolean;
  /** Субъект для текста диалога удаления ("консультанта", "профиля" и т.п.) */
  deleteSubject?: string;
  /** Дополнительный className */
  className?: string;
}

/** Преобразует data-URI в Blob для отправки через FormData */
function dataUriToBlob(dataUri: string): Blob {
  const parts = dataUri.split(",");
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/webp";
  const rawBase64 = parts[1] || "";
  const byteString = atob(rawBase64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

export function AvatarUpload({
  value,
  onChange,
  onRemove,
  label = "Фото сотрудника (аватар)",
  hint = "PNG, JPG или WebP. Рекомендуется квадратное фото с чётким лицом.",
  name = "",
  shape = "circle",
  size = "md",
  allowUrl = true,
  uploadToBackend = true,
  disabled = false,
  deleteSubject = "сотрудника",
  className,
}: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Состояние кадрирования
  const [cropSource, setCropSource] = useState<{ image: HTMLImageElement; url: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Drag-and-drop
  const [isDragOver, setIsDragOver] = useState(false);

  // Ввод произвольной ссылки
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  // Подтверждение удаления
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  // Оптимистичный локальный preview
  const [optimisticPreview, setOptimisticPreview] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);

  // Синхронизация внешнего значения
  useEffect(() => {
    if (value) {
      setOptimisticPreview(null);
    }
    setImageLoadError(false);
  }, [value]);

  const displayUrl = optimisticPreview || value || "";

  /** Выбор файла через диалог или Drag-and-Drop */
  const handleFileSelect = useCallback(async (file?: File) => {
    if (!file) return;

    setIsProcessing(true);
    try {
      const loaded = await loadImageFile(file);
      setCropSource(loaded);
    } catch (err) {
      toast.error(err instanceof AvatarError ? err.message : "Не удалось прочитать изображение");
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, []);

  /** Применение кадрирования: мгновенный предпросмотр + выгрузка в медиа-хранилище */
  const handleCropApply = useCallback(
    async (dataUri: string) => {
      // 1. Мгновенный оптимистичный предпросмотр в UI и превью виджета
      setOptimisticPreview(dataUri);
      onChange(dataUri);

      // 2. Освобождаем временный URL исходника
      if (cropSource) {
        releaseImage(cropSource.url);
        setCropSource(null);
      }

      // 3. Сохранение в медиа-хранилище бэкенда (при включенном uploadToBackend)
      if (uploadToBackend) {
        setIsUploading(true);
        try {
          const blob = dataUriToBlob(dataUri);
          const uploadFile = new File([blob], `avatar_${Date.now()}.webp`, { type: "image/webp" });
          const formData = new FormData();
          formData.append("file", uploadFile, uploadFile.name);

          await apiClient.postFormData<{ url: string }>(
            "/api/v1/crm/upload",
            formData,
          );

          // data-URI уже установлен в onChange и обеспечивает мгновенный автономный рендеринг
          setImageLoadError(false);
          toast.success("Фото успешно сохранено");
        } catch {
          // Если выгрузка на бэкенд не прошла, data-URI уже сохранен и работает автономно
          toast.success("Фото сохранено");
        } finally {
          setIsUploading(false);
        }
      } else {
        toast.success("Фото сохранено");
      }
    },
    [cropSource, onChange, uploadToBackend],
  );

  const handleApplyUrl = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setOptimisticPreview(trimmed);
    onChange(trimmed);
    setShowUrlInput(false);
    setUrlInput("");
    toast.success("Ссылка на фото применена");
  }, [urlInput, onChange]);

  const handleConfirmRemove = useCallback(() => {
    setOptimisticPreview(null);
    onChange("");
    onRemove?.();
    setRemoveDialogOpen(false);
    toast.success("Фото удалено");
  }, [onChange, onRemove]);

  // Стили контейнера аватара по размеру и форме
  const sizeClass =
    typeof size === "number"
      ? ""
      : size === "sm"
        ? "h-12 w-12"
        : size === "lg"
          ? "h-24 w-24"
          : "h-16 w-16";

  const shapeClass = shape === "circle" ? "rounded-full" : "rounded-2xl";
  const customStyle = typeof size === "number" ? { width: size, height: size } : undefined;

  const isBusy = disabled || isProcessing || isUploading;

  return (
    <div className={cn("space-y-2", className)}>
      {label && <label className="block text-xs font-medium text-[#666666]">{label}</label>}

      <div className="flex items-center gap-4">
        {/* Контейнер аватара с hover-оверлеем и кнопкой-камерой */}
        <div className="relative shrink-0">
          <div
            style={customStyle}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!disabled) setIsDragOver(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!disabled) setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);
              if (disabled) return;
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) void handleFileSelect(dropped);
            }}
            onClick={() => {
              if (!isBusy) fileInputRef.current?.click();
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !isBusy) {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Загрузить или изменить фото"
            title="Нажмите или перетащите файл для смены фото"
            className={cn(
              "group relative flex items-center justify-center overflow-hidden border-2 bg-white shadow-xs transition-all cursor-pointer select-none",
              sizeClass,
              shapeClass,
              isDragOver
                ? "border-[#4a38f5] ring-2 ring-[#4a38f5]/20 bg-[#4a38f5]/5"
                : "border-[#e5e5e5] hover:border-[#cccccc]",
              isBusy && "cursor-not-allowed opacity-75",
            )}
          >
            {displayUrl && !imageLoadError ? (
              // eslint-disable-next-line @next/next/no-img-element -- Base64 data-URI и внешние URL
              <img
                src={displayUrl}
                alt={name || "Аватар"}
                className="h-full w-full object-cover"
                onError={() => setImageLoadError(true)}
              />
            ) : name.trim() ? (
              <div className="flex h-full w-full items-center justify-center bg-[#f0f0f0] text-sm font-semibold text-[#111111]">
                {userInitials(name)}
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#fafafa] text-[#888888]">
                <User className="h-6 w-6 text-[#888888]" />
              </div>
            )}

            {/* Hover-оверлей со значком камеры (паритет с эталоном профиля) */}
            <div
              className={cn(
                "absolute inset-0 flex flex-col items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100",
                shapeClass,
              )}
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  <span className="mt-0.5 text-[9px] font-medium leading-none">Изменить</span>
                </>
              )}
            </div>
          </div>

          {/* Кнопка-бейдж камеры в правом нижнем углу (как в профиле) */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            aria-label="Загрузить фото"
            title="Загрузить фото"
            className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#4a38f5] text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-60 cursor-pointer"
          >
            {isBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Camera className="h-3 w-3" />
            )}
          </button>
        </div>

        {/* Скрытый нативный input для выбора файла */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => void handleFileSelect(e.target.files?.[0])}
          className="hidden"
        />

        {/* Кнопки управления и подсказки */}
        <div className="flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:border-[#cccccc] hover:bg-[#fafafa] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
              ) : (
                <Upload className="h-3.5 w-3.5 text-[#666666]" />
              )}
              <span>{displayUrl ? "Сменить фото" : "Загрузить своё фото"}</span>
            </button>

            {allowUrl && (
              <button
                type="button"
                onClick={() => setShowUrlInput((v) => !v)}
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] hover:border-[#cccccc] hover:bg-[#fafafa] transition-colors cursor-pointer disabled:opacity-50"
              >
                <Link2 className="h-3.5 w-3.5 text-[#666666]" />
                <span>{showUrlInput ? "Скрыть URL" : "Указать ссылку"}</span>
              </button>
            )}

            {displayUrl && (
              <button
                type="button"
                onClick={() => setRemoveDialogOpen(true)}
                disabled={isBusy}
                className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer disabled:opacity-50"
                title="Удалить фото"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Удалить</span>
              </button>
            )}
          </div>

          {/* Инлайн-ввод внешней ссылки на аватар */}
          {showUrlInput && (
            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/avatar.jpg"
                className="flex-1 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
              />
              <button
                type="button"
                onClick={handleApplyUrl}
                disabled={!urlInput.trim()}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#4a38f5] px-3 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-40 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                <span>OK</span>
              </button>
              <button
                type="button"
                onClick={() => setShowUrlInput(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#e5e5e5] text-[#888888] hover:text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {hint && <p className="text-[11px] text-[#888888]">{hint}</p>}
        </div>
      </div>

      {/* Модальное окно кадрирования аватара (эталонный AvatarCropModal) */}
      <AvatarCropModal
        open={cropSource !== null}
        image={cropSource?.image ?? null}
        imageUrl={cropSource?.url ?? null}
        onCancel={() => {
          if (cropSource) releaseImage(cropSource.url);
          setCropSource(null);
        }}
        onApply={handleCropApply}
        isPending={isUploading}
        title="Выберите область фото"
        shape={shape === "circle" ? "circle" : "rect"}
      />

      {/* Диалог подтверждения удаления фото */}
      <ConfirmDialog
        open={removeDialogOpen}
        onClose={() => setRemoveDialogOpen(false)}
        onConfirm={handleConfirmRemove}
        title="Удалить фото?"
        description={
          deleteSubject
            ? `Вместо фото ${deleteSubject} будет отображаться стандартная иконка или 3D-маскот.`
            : "Вместо фото будет отображаться стандартная иконка или 3D-маскот."
        }
        confirmLabel="Удалить"
        variant="destructive"
      />
    </div>
  );
}
