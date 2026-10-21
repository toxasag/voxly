"use client";

import React, { useState } from "react";
import {
  Send,
  Smartphone,
  Calendar,
  Eye,
  Heart,
  Loader2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useStories,
  useCreateStory,
  usePublishStory,
  useDeleteStory,
  type StoryChannel,
} from "@/lib/api/use-stories";
import { toast } from "sonner";

export default function MarketingStoriesPage() {
  const [channel, setChannel] = useState<StoryChannel>("telegram");
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState(
    "https://storage.getvoxly.ru/stories/promo-banner.jpg",
  );
  const [mediaType, setMediaType] = useState<"photo" | "video">("photo");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  const { data, isLoading } = useStories();
  const createMutation = useCreateStory();
  const publishMutation = usePublishStory();
  const deleteMutation = useDeleteStory();

  const stories = data?.items ?? [];

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    try {
      await createMutation.mutateAsync({
        channel,
        mediaUrl: mediaUrl.trim() || "https://storage.getvoxly.ru/stories/promo-banner.jpg",
        mediaType,
        text,
        linkUrl: linkUrl.trim() || null,
        linkText: linkText.trim() || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });

      setText("");
      setLinkUrl("");
      setLinkText("");
      setScheduledAt("");
      toast.success(
        scheduledAt
          ? "История успешно запланирована!"
          : "История успешно опубликована в канале!",
      );
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось опубликовать историю",
      );
    }
  };

  const handleImmediatePublish = async (id: string) => {
    try {
      await publishMutation.mutateAsync(id);
      toast.success("История отправлена на публикацию");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Ошибка публикации истории",
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("История удалена");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось удалить историю",
      );
    }
  };

  return (
    <div className="flex-1 bg-white min-h-[calc(100vh-3rem)] text-[#111111] font-sans">
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-[16px] font-semibold text-[#000000] tracking-tight">
            Истории (Stories)
          </h1>
          <p className="text-[12px] text-[#666666] mt-0.5">
            Публикация и планирование мультимедийных историй в Telegram (MTProto), MAX и WhatsApp
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Левая часть: Форма создания */}
          <div className="lg:col-span-7 bg-white rounded-[8px] border border-[#e5e5e5] p-5 shadow-2xs">
            <h2 className="text-[13px] font-semibold text-[#000000] mb-3.5 flex items-center gap-2">
              <Send className="w-3.5 h-3.5 text-[#111111]" /> Создать публикацию
            </h2>

            <form onSubmit={handlePublish} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1.5">
                  Канал публикации
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(["telegram", "max", "whatsapp"] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannel(ch)}
                      className={cn(
                        "h-8 px-2 text-[12px] font-medium rounded-[8px] border text-center transition-colors",
                        channel === ch
                          ? "bg-[#4a38f5] border-[#4a38f5] text-white"
                          : "bg-white border-[#e5e5e5] text-[#666666] hover:bg-[#fafafa]",
                      )}
                    >
                      {ch === "telegram"
                        ? "Telegram"
                        : ch === "max"
                          ? "MAX"
                          : "WhatsApp"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1">
                  Медиафайл (URL фото или видео)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder="https://.../photo.jpg"
                    className="h-8 flex-1 text-[13px] rounded-[8px] border border-[#e5e5e5] px-2.5 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 bg-white text-[#111111] placeholder:text-[#888888]"
                    required
                  />
                  <select
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value as "photo" | "video")}
                    className="h-8 text-[12px] rounded-[8px] border border-[#e5e5e5] px-2 bg-white text-[#111111]"
                  >
                    <option value="photo">Фото</option>
                    <option value="video">Видео</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1">
                  Текст истории
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  placeholder="Введите текст истории или призыв к действию..."
                  className="w-full text-[13px] rounded-[8px] border border-[#e5e5e5] p-2.5 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 bg-white text-[#111111] placeholder:text-[#888888]"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1">
                    Ссылка перехода (URL)
                  </label>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://getvoxly.ru/promo"
                    className="h-8 w-full text-[13px] rounded-[8px] border border-[#e5e5e5] px-2.5 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 bg-white text-[#111111] placeholder:text-[#888888]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1">
                    Текст кнопки
                  </label>
                  <input
                    type="text"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    placeholder="Подробнее / Записаться"
                    className="h-8 w-full text-[13px] rounded-[8px] border border-[#e5e5e5] px-2.5 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 bg-white text-[#111111] placeholder:text-[#888888]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#888888]" /> Отложенная публикация
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="h-8 w-full text-[13px] rounded-[8px] border border-[#e5e5e5] px-2.5 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 bg-white text-[#111111]"
                />
              </div>

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={createMutation.isPending || !text.trim()}
                  className="h-8 px-4 bg-[#4a38f5] hover:bg-[#3d2ee0] text-white font-medium rounded-[8px] text-[13px] shadow-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  {scheduledAt ? "Запланировать историю" : "Опубликовать сейчас"}
                </button>
              </div>
            </form>
          </div>

          {/* Правая часть: Мобильное превью 9:16 */}
          <div className="lg:col-span-5 flex flex-col items-center">
            <div className="text-[11px] font-medium text-[#888888] uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-[#888888]" /> Предпросмотр (9:16)
            </div>

            <div className="w-[240px] h-[430px] bg-black rounded-[32px] p-2.5 shadow-md border border-[#e5e5e5] relative flex flex-col overflow-hidden">
              <div className="w-full h-full rounded-[22px] bg-gradient-to-br from-[#4a38f5] to-[#1e1b4b] p-3.5 flex flex-col justify-between text-white relative overflow-hidden">
                <div className="flex items-center gap-2 z-10">
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white shadow-xs">
                    GV
                  </div>
                  <div className="text-xs">
                    <p className="font-medium text-[11px] leading-tight">GETVOXLY</p>
                    <p className="text-[9px] text-white/70">Только что</p>
                  </div>
                </div>

                <div className="my-auto z-10 text-center py-4 px-1">
                  <p className="text-[12px] font-medium leading-relaxed drop-shadow-sm">
                    {text || "Ваш текст истории будет отображаться здесь..."}
                  </p>
                </div>

                {linkUrl && (
                  <div className="z-10 pb-1 flex justify-center">
                    <span className="px-3 py-1 bg-white text-black rounded-full text-[11px] font-medium shadow-xs">
                      {linkText || "Перейти"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Список опубликованных историй */}
        <div className="bg-white rounded-[8px] border border-[#e5e5e5] overflow-hidden shadow-2xs">
          <div className="px-4 py-3 border-b border-[#e5e5e5] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-[#111111]">Журнал историй</h3>
            <span className="text-xs text-[#888888]">{stories.length} записей</span>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-xs text-[#888888] flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#4a38f5]" />
              Загрузка историй...
            </div>
          ) : stories.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#888888]">
              Истории ещё не публиковались. Создайте первую публикацию выше.
            </div>
          ) : (
            <div className="divide-y divide-[#f0f0f0]">
              {stories.map((story) => (
                <div
                  key={story.id}
                  className="p-3.5 flex items-center justify-between hover:bg-[#fafafa] transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-black/[0.05] text-[#333333]">
                        {story.channel}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-full font-medium",
                          story.status === "published"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : story.status === "scheduled"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : story.status === "failed"
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-[#f4f4f5] text-[#666666]",
                        )}
                      >
                        {story.status === "published"
                          ? "Опубликовано"
                          : story.status === "scheduled"
                            ? "Запланировано"
                            : story.status === "failed"
                              ? "Ошибка отправки"
                              : story.status}
                      </span>
                      {story.scheduledAt && (
                        <span className="text-[11px] text-[#888888]">
                          {new Date(story.scheduledAt).toLocaleString("ru-RU")}
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-[#111111] font-medium line-clamp-1">
                      {story.text}
                    </p>
                  </div>

                  <div className="flex items-center gap-3.5 text-xs text-[#888888]">
                    <span className="flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5 text-[#888888]" /> {story.viewsCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5 text-rose-500" /> {story.reactionsCount}
                    </span>

                    {story.status !== "published" && (
                      <button
                        onClick={() => handleImmediatePublish(story.id)}
                        disabled={publishMutation.isPending}
                        className="px-2 py-1 text-[11px] bg-[#4a38f5] hover:bg-[#3d2ee0] text-white rounded-[4px] transition-colors"
                        title="Опубликовать сейчас"
                      >
                        Опубликовать
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(story.id)}
                      disabled={deleteMutation.isPending}
                      className="p-1 hover:text-rose-600 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
