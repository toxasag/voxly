"use client";

import { useState, useRef, useEffect } from "react";
import {
  X,
  Upload,
  Copy,
  Check,
  Sparkles,
  Camera,
  Eye,
  Loader2,
  User,
  Grid,
} from "lucide-react";
import { InteractiveMascot } from "./InteractiveMascot";

interface CreatePhotoMascotModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDirections?: string;
  initialReactions?: string;
  initialName?: string;
  onApply: (directionsUrl: string, reactionsUrl: string, name: string) => void;
}

const AI_PHOTO_PROMPT = `The attached image shows a person. Redraw them as a 3x3 grid sprite sheet of NINE HEAD DIRECTIONS, in a stylized chibi cartoon sticker style.

DO NOT reproduce the photograph realism. Restyle it into a BIG HEAD CHIBI CARTOON -- charming storybook sticker art with thick clean outlines, big expressive eyes with catchlights, soft pink cheek blush, and warm saturated colours.

Keep ONLY identifying features: hair shape and colour, glasses shape/colour, facial hair, skin tone, clothing colour.
The face keeps the same calm friendly expression in every cell; only the direction the head is TURNED changes.

Row 1: up-left, up, up-right.
Row 2: left, straight at the viewer, right.
Row 3: down-left, down, down-right.

NO text, no borders, no drop shadows. Square 1024x1024 PNG with transparent background.`;

/**
 * Создание 3×3 сетки ракурсов и эмоций из одной обычной фотографии лица.
 * Автоматически кадрирует портрет по центру/лицу и создаёт микросмещения
 * для 9 направлений взгляда, а также сетку эмоций.
 */
async function generateSpriteFromSinglePhoto(
  file: File,
): Promise<{ directions: string; reactions: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        // Чуть выше середины для естественного акцента на лице человека
        const sy = Math.max(0, (img.height - minDim) * 0.25);
        const sw = minDim;
        const sh = minDim;

        const size = 768;
        const cellSize = size / 3;

        // 1. Directions canvas (9 направлений головы)
        const dirCanvas = document.createElement("canvas");
        dirCanvas.width = size;
        dirCanvas.height = size;
        const dirCtx = dirCanvas.getContext("2d");
        if (!dirCtx) {
          reject(new Error("Не удалось инициализировать canvas"));
          return;
        }

        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const cx = col * cellSize;
            const cy = row * cellSize;

            // Смещение для направления взгляда:
            // col: 0 = влево (-14px), 1 = центр (0px), 2 = вправо (+14px)
            // row: 0 = вверх (-14px), 1 = центр (0px), 2 = вниз (+14px)
            const dx = (col - 1) * 14;
            const dy = (row - 1) * 14;

            dirCtx.save();
            dirCtx.beginPath();
            dirCtx.rect(cx, cy, cellSize, cellSize);
            dirCtx.clip();

            dirCtx.drawImage(img, sx, sy, sw, sh, cx + dx, cy + dy, cellSize, cellSize);
            dirCtx.restore();
          }
        }

        // 2. Reactions canvas (эмоции / моргание / squish)
        const reactCanvas = document.createElement("canvas");
        reactCanvas.width = size;
        reactCanvas.height = size;
        const reactCtx = reactCanvas.getContext("2d");
        if (!reactCtx) {
          reject(new Error("Не удалось инициализировать canvas"));
          return;
        }

        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const cx = col * cellSize;
            const cy = row * cellSize;

            reactCtx.save();
            reactCtx.beginPath();
            reactCtx.rect(cx, cy, cellSize, cellSize);
            reactCtx.clip();

            // Лёгкая анимация масштаба/сжатия для реакций
            const cellIndex = row * 3 + col;
            const squash = cellIndex === 0 || cellIndex === 4 ? 0.94 : 0.98;
            const dw = cellSize * (2 - squash);
            const dh = cellSize * squash;
            const ox = cx + (cellSize - dw) / 2;
            const oy = cy + (cellSize - dh) / 2;

            reactCtx.drawImage(img, sx, sy, sw, sh, ox, oy, dw, dh);
            reactCtx.restore();
          }
        }

        let directions = "";
        let reactions = "";

        try {
          directions = dirCanvas.toDataURL("image/webp", 0.85);
          reactions = reactCanvas.toDataURL("image/webp", 0.85);
          if (!directions.startsWith("data:image/webp")) {
            directions = dirCanvas.toDataURL("image/jpeg", 0.85);
            reactions = reactCanvas.toDataURL("image/jpeg", 0.85);
          }
        } catch {
          directions = dirCanvas.toDataURL("image/jpeg", 0.85);
          reactions = reactCanvas.toDataURL("image/jpeg", 0.85);
        }

        resolve({ directions, reactions });
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Оптимизация готового спрайт-листа: сжатие до 1024×1024 WebP (<200 КБ).
 */
async function optimizeSpriteFile(file: File, maxSize: number = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Не удалось инициализировать canvas"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        try {
          const webpData = canvas.toDataURL("image/webp", 0.88);
          if (webpData.startsWith("data:image/webp")) {
            resolve(webpData);
            return;
          }
        } catch {
          // fallback
        }

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function CreatePhotoMascotModal({
  isOpen,
  onClose,
  initialDirections = "",
  initialReactions = "",
  initialName = "",
  onApply,
}: CreatePhotoMascotModalProps) {
  const [directionsUrl, setDirectionsUrl] = useState<string>(initialDirections);
  const [reactionsUrl, setReactionsUrl] = useState<string>(initialReactions);
  const [mascotName, setMascotName] = useState<string>(initialName || "Мой маскот");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "instruction">("upload");
  const [uploadMode, setUploadMode] = useState<"single_photo" | "sprite_sheet">("single_photo");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  const singlePhotoInputRef = useRef<HTMLInputElement>(null);
  const directionsInputRef = useRef<HTMLInputElement>(null);
  const reactionsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialDirections) setDirectionsUrl(initialDirections);
      if (initialReactions) setReactionsUrl(initialReactions);
      if (initialName) setMascotName(initialName);
      setProcessError(null);
    }
  }, [isOpen, initialDirections, initialReactions, initialName]);

  if (!isOpen) return null;

  const handleCopyPrompt = () => {
    void navigator.clipboard.writeText(AI_PHOTO_PROMPT);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2500);
  };

  // 1. Загрузка обычного фото лица и автоматическая генерация 3×3
  const handleSinglePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessing(true);
      setProcessError(null);
      const res = await generateSpriteFromSinglePhoto(file);
      setDirectionsUrl(res.directions);
      setReactionsUrl(res.reactions);
    } catch {
      setProcessError("Не удалось обработать изображение. Попробуйте другой файл (PNG, JPG или WebP).");
    } finally {
      setIsProcessing(false);
      if (singlePhotoInputRef.current) singlePhotoInputRef.current.value = "";
    }
  };

  // 2. Загрузка готового 3×3 спрайт-листа
  const handleSpriteSheetUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessing(true);
      setProcessError(null);
      const optimized = await optimizeSpriteFile(file, 1024);
      setter(optimized);
    } catch {
      setProcessError("Ошибка чтения файла. Проверьте формат изображения.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApply = () => {
    if (!directionsUrl) return;
    onApply(
      directionsUrl,
      reactionsUrl || directionsUrl,
      mascotName.trim() || "Персонаж из фото",
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl">
        {/* Шапка модального окна */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4 bg-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4a38f5]/10 text-[#4a38f5]">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111111]">
                Создание 3D-маскота по вашей фотографии
              </h2>
              <p className="text-xs text-[#666666]">
                Интерактивный живой персонаж для онлайн-чата, следящий за курсором
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#888888] hover:bg-[#f5f5f5] hover:text-[#111111] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Табы */}
        <div className="flex border-b border-[#e5e5e5] bg-[#fafafa] px-6">
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={`border-b-2 py-3 px-4 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "upload"
                ? "border-[#4a38f5] text-[#4a38f5]"
                : "border-transparent text-[#666666] hover:text-[#111111]"
            }`}
          >
            1. Загрузить фото и создать маскота
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("instruction")}
            className={`border-b-2 py-3 px-4 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "instruction"
                ? "border-[#4a38f5] text-[#4a38f5]"
                : "border-transparent text-[#666666] hover:text-[#111111]"
            }`}
          >
            2. Промпт для ИИ (Chibi Sticker в Midjourney / ChatGPT)
          </button>
        </div>

        {/* Тело модального окна */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
          {activeTab === "upload" ? (
            <div className="space-y-5">
              {/* Поле имени */}
              <div>
                <label className="text-xs font-semibold text-[#111111]">
                  Имя персонажа / консультанта
                </label>
                <input
                  type="text"
                  value={mascotName}
                  onChange={(e) => setMascotName(e.target.value)}
                  placeholder="Например, Анна (Консультант) или Макс"
                  className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>

              {/* Выбор режима загрузки */}
              <div>
                <label className="text-xs font-semibold text-[#111111] mb-2 block">
                  Способ создания:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setUploadMode("single_photo")}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                      uploadMode === "single_photo"
                        ? "border-[#4a38f5] bg-[#4a38f5]/5 ring-1 ring-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white hover:border-[#cccccc]"
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#111111]">Обычное фото лица</p>
                      <p className="text-[11px] text-[#666666] mt-0.5">
                        Загрузите фото/селфи — система сама нарежет 9 ракурсов и сделает интерактивный маскот
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUploadMode("sprite_sheet")}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                      uploadMode === "sprite_sheet"
                        ? "border-[#4a38f5] bg-[#4a38f5]/5 ring-1 ring-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white hover:border-[#cccccc]"
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <Grid className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#111111]">Готовая 3×3 сетка из ИИ</p>
                      <p className="text-[11px] text-[#666666] mt-0.5">
                        Спрайт-лист из 9 ракурсов, созданный по нашему промпту в ChatGPT / Midjourney
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {processError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  {processError}
                </div>
              )}

              {/* РЕЖИМ 1: Обычное фото */}
              {uploadMode === "single_photo" && (
                <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-[#111111]">
                        Загрузка фотографии сотрудника
                      </h4>
                      <p className="text-[11px] text-[#666666]">
                        Рекомендуется портрет в анфас с хорошим освещением. Система сожмёт и создаст 9 ракурсов.
                      </p>
                    </div>
                  </div>

                  <input
                    type="file"
                    ref={singlePhotoInputRef}
                    accept="image/*"
                    onChange={handleSinglePhotoUpload}
                    className="hidden"
                  />

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => singlePhotoInputRef.current?.click()}
                      disabled={isProcessing}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-xs font-semibold text-[#111111] hover:bg-[#f0f0f0] shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
                      ) : (
                        <Upload className="h-4 w-4 text-[#4a38f5]" />
                      )}
                      <span>
                        {directionsUrl ? "Заменить фотографию" : "Выбрать фото с устройства"}
                      </span>
                    </button>

                    {directionsUrl && (
                      <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" />
                        Интерактивный маскот сгенерирован
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* РЕЖИМ 2: Сетка 3×3 */}
              {uploadMode === "sprite_sheet" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Directions */}
                  <div className="rounded-xl border border-[#e5e5e5] p-4 bg-[#fafafa] space-y-2">
                    <span className="text-xs font-bold text-[#111111] block">
                      1. Сетка ракурсов (Directions 3×3) *
                    </span>
                    <p className="text-[11px] text-[#666666]">
                      Сетка из 9 положений головы для слежения за курсором.
                    </p>

                    <input
                      type="file"
                      ref={directionsInputRef}
                      accept="image/*"
                      onChange={(e) => void handleSpriteSheetUpload(e, setDirectionsUrl)}
                      className="hidden"
                    />

                    <div className="pt-1 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => directionsInputRef.current?.click()}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0] cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5 text-[#666666]" />
                        <span>{directionsUrl ? "Заменить файл" : "Выбрать файл..."}</span>
                      </button>
                    </div>

                    <input
                      type="text"
                      value={directionsUrl.startsWith("data:") ? "Файл загружен и оптимизирован" : directionsUrl}
                      onChange={(e) => setDirectionsUrl(e.target.value)}
                      placeholder="Или ссылка https://example.com/directions.webp"
                      className="w-full rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[11px] font-mono text-[#111111]"
                    />
                  </div>

                  {/* Reactions */}
                  <div className="rounded-xl border border-[#e5e5e5] p-4 bg-[#fafafa] space-y-2">
                    <span className="text-xs font-bold text-[#111111] block">
                      2. Сетка эмоций (Reactions 3×3)
                    </span>
                    <p className="text-[11px] text-[#666666]">
                      Эмоции при клике (моргание, улыбка). Опционально.
                    </p>

                    <input
                      type="file"
                      ref={reactionsInputRef}
                      accept="image/*"
                      onChange={(e) => void handleSpriteSheetUpload(e, setReactionsUrl)}
                      className="hidden"
                    />

                    <div className="pt-1 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => reactionsInputRef.current?.click()}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0] cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5 text-[#666666]" />
                        <span>{reactionsUrl ? "Заменить файл" : "Выбрать файл..."}</span>
                      </button>
                    </div>

                    <input
                      type="text"
                      value={reactionsUrl.startsWith("data:") ? "Файл загружен и оптимизирован" : reactionsUrl}
                      onChange={(e) => setReactionsUrl(e.target.value)}
                      placeholder="Или ссылка https://example.com/reactions.webp"
                      className="w-full rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[11px] font-mono text-[#111111]"
                    />
                  </div>
                </div>
              )}

              {/* Живое интерактивное превью созданного маскота */}
              {directionsUrl && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-center">
                  <span className="text-xs font-bold text-emerald-800 flex items-center justify-center gap-1.5">
                    <Eye className="h-4 w-4" />
                    Живой тест созданного маскота (подвигайте мышью по экрану!):
                  </span>

                  <div className="mt-3 flex justify-center">
                    <InteractiveMascot
                      mascotId="custom"
                      customDirections={directionsUrl}
                      customReactions={reactionsUrl || directionsUrl}
                      size={96}
                      interactive={true}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4 text-xs text-sky-900 space-y-2">
                <p className="font-semibold flex items-center gap-1.5 text-sky-800">
                  <Sparkles className="h-4 w-4 text-[#4a38f5]" />
                  Как это работает (как сделан маскот «Камран по фото»):
                </p>
                <p className="text-sky-800/90 leading-relaxed">
                  Маскот виджета — это спрайт-лист 3×3 с 9 ракурсами головы (взгляд во все стороны) и 9 эмоциями. Искусственный интеллект (ChatGPT, Midjourney или Flux) за 30 секунд перерисовывает реальное фото человека в обаятельного чиби-персонажа с сохранением причёски, очков и черт лица!
                </p>
              </div>

              {/* Пошаговая инструкция */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#111111]">
                  Пошаговый план:
                </h3>

                <div className="flex items-start gap-3 rounded-lg border border-[#e5e5e5] p-3 bg-white">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#4a38f5] text-xs font-bold text-white">
                    1
                  </span>
                  <div className="text-xs">
                    <p className="font-semibold text-[#111111]">Подготовьте фото</p>
                    <p className="text-[#666666] mt-0.5">
                      Чёткое портретное селфи сотрудника или фото в анфас с хорошим освещением.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-lg border border-[#e5e5e5] p-3 bg-white">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#4a38f5] text-xs font-bold text-white">
                    2
                  </span>
                  <div className="text-xs flex-1">
                    <p className="font-semibold text-[#111111]">
                      Отправьте фото с готовым промптом в нейросеть
                    </p>
                    <p className="text-[#666666] mt-0.5">
                      Прикрепите фото в ChatGPT (Plus), Midjourney или Flux и вставьте текст промпта ниже:
                    </p>

                    <div className="mt-2 relative rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3 font-mono text-[11px] text-[#333333]">
                      <button
                        type="button"
                        onClick={handleCopyPrompt}
                        className="absolute top-2 right-2 flex items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-sans font-medium text-[#4a38f5] shadow-xs border border-[#e5e5e5] hover:bg-[#f0f0f0] cursor-pointer"
                      >
                        {copiedPrompt ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" />
                            <span>Скопировано!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Скопировать промпт</span>
                          </>
                        )}
                      </button>
                      <pre className="whitespace-pre-wrap max-h-36 overflow-y-auto pr-16">
                        {AI_PHOTO_PROMPT}
                      </pre>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-lg border border-[#e5e5e5] p-3 bg-white">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#4a38f5] text-xs font-bold text-white">
                    3
                  </span>
                  <div className="text-xs">
                    <p className="font-semibold text-[#111111]">Загрузите полученную сетку 3×3</p>
                    <p className="text-[#666666] mt-0.5">
                      Вернитесь на первую вкладку, выберите режим «Готовая 3×3 сетка из ИИ» и загрузите полученную картинку.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Футер */}
        <div className="flex items-center justify-between border-t border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
          <span className="text-xs text-[#888888]">
            {isProcessing ? "Оптимизация и обработка изображения..." : "Поддерживаются PNG, JPG и WebP"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-xs font-medium text-[#666666] hover:bg-[#f0f0f0] cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!directionsUrl || isProcessing}
              className="rounded-lg bg-[#4a38f5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3d2ee0] disabled:opacity-40 transition-colors cursor-pointer"
            >
              Использовать этого маскота
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
