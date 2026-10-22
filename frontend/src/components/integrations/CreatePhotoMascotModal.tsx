"use client";

import { useState, useRef } from "react";
import {
  X,
  Upload,
  Copy,
  Check,
  Sparkles,
  Camera,
  Eye,
} from "lucide-react";
import { InteractiveMascot } from "./InteractiveMascot";

interface CreatePhotoMascotModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export function CreatePhotoMascotModal({
  isOpen,
  onClose,
  onApply,
}: CreatePhotoMascotModalProps) {
  const [directionsUrl, setDirectionsUrl] = useState<string>("");
  const [reactionsUrl, setReactionsUrl] = useState<string>("");
  const [mascotName, setMascotName] = useState<string>("Мой аватар");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [activeTab, setActiveTab] = useState<"instruction" | "upload">("instruction");

  const directionsInputRef = useRef<HTMLInputElement>(null);
  const reactionsInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(AI_PHOTO_PROMPT);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2500);
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setter(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleApply = () => {
    if (!directionsUrl) return;
    // Если reactionsUrl не задан, используем directionsUrl как базовый
    onApply(directionsUrl, reactionsUrl || directionsUrl, mascotName.trim() || "Персонаж из фото");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl">
        {/* Шапка модального окна */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4a38f5]/10 text-[#4a38f5]">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111111]">
                Создание 3D-маскота по вашей фотографии
              </h2>
              <p className="text-xs text-[#666666]">
                Как превратить фото сотрудника в интерактивного живого персонажа для виджета
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#888888] hover:bg-[#f5f5f5] hover:text-[#111111]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Табы */}
        <div className="flex border-b border-[#e5e5e5] bg-[#fafafa] px-6">
          <button
            type="button"
            onClick={() => setActiveTab("instruction")}
            className={`border-b-2 py-3 px-4 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "instruction"
                ? "border-[#4a38f5] text-[#4a38f5]"
                : "border-transparent text-[#666666] hover:text-[#111111]"
            }`}
          >
            1. Инструкция и промпт для ИИ
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={`border-b-2 py-3 px-4 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "upload"
                ? "border-[#4a38f5] text-[#4a38f5]"
                : "border-transparent text-[#666666] hover:text-[#111111]"
            }`}
          >
            2. Загрузить спрайты и протестировать
          </button>
        </div>

        {/* Тело модального окна */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
          {activeTab === "instruction" ? (
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
                        className="absolute top-2 right-2 flex items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-sans font-medium text-[#4a38f5] shadow-xs border border-[#e5e5e5] hover:bg-[#f0f0f0]"
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
                      Перейдите на вкладку «2. Загрузить спрайты» и прикрепите полученную картинку. Маскот сразу оживёт в виджете!
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setActiveTab("upload")}
                  className="rounded-lg bg-[#4a38f5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3d2ee0] transition-colors"
                >
                  Перейти к загрузке спрайтов →
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Имя маскота */}
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

              {/* Загрузка двух спрайтов */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Directions */}
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
                    onChange={(e) => handleFileUpload(e, setDirectionsUrl)}
                    className="hidden"
                  />

                  <div className="pt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => directionsInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0]"
                    >
                      <Upload className="h-3.5 w-3.5 text-[#666666]" />
                      <span>{directionsUrl ? "Заменить файл" : "Выбрать файл..."}</span>
                    </button>
                  </div>

                  <input
                    type="text"
                    value={directionsUrl.startsWith("data:") ? "Файл загружен локально" : directionsUrl}
                    onChange={(e) => setDirectionsUrl(e.target.value)}
                    placeholder="Или ссылка https://example.com/directions.webp"
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[11px] font-mono text-[#111111]"
                  />
                </div>

                {/* 2. Reactions */}
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
                    onChange={(e) => handleFileUpload(e, setReactionsUrl)}
                    className="hidden"
                  />

                  <div className="pt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => reactionsInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0]"
                    >
                      <Upload className="h-3.5 w-3.5 text-[#666666]" />
                      <span>{reactionsUrl ? "Заменить файл" : "Выбрать файл..."}</span>
                    </button>
                  </div>

                  <input
                    type="text"
                    value={reactionsUrl.startsWith("data:") ? "Файл загружен локально" : reactionsUrl}
                    onChange={(e) => setReactionsUrl(e.target.value)}
                    placeholder="Или ссылка https://example.com/reactions.webp"
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[11px] font-mono text-[#111111]"
                  />
                </div>
              </div>

              {/* Живое интерактивное превью созданного маскота */}
              {directionsUrl && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-center">
                  <span className="text-xs font-bold text-emerald-800 flex items-center justify-center gap-1.5">
                    <Eye className="h-4 w-4" />
                    Живой тест созданного маскота (подвигайте мышью!):
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
          )}
        </div>

        {/* Футер */}
        <div className="flex items-center justify-between border-t border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
          <span className="text-xs text-[#888888]">
            Поддерживаются PNG и WebP с прозрачным фоном.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-xs font-medium text-[#666666] hover:bg-[#f0f0f0]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!directionsUrl}
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
