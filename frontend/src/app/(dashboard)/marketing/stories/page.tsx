"use client";

import React, { useState } from "react";
import { Send, Smartphone, Image as ImageIcon, Calendar, CheckCircle2, Clock, Eye, Heart } from "lucide-react";
import { cn } from "@/lib/utils";

interface StoryPost {
  id: string;
  channel: "telegram" | "max" | "whatsapp";
  text: string;
  media_url?: string;
  media_type: "image" | "video";
  status: "draft" | "scheduled" | "published" | "failed";
  views_count: number;
  reactions_count: number;
  scheduled_at?: string;
  created_at: string;
}

export default function MarketingStoriesPage() {
  const [channel, setChannel] = useState<"telegram" | "max" | "whatsapp">("telegram");
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [stories, setStories] = useState<StoryPost[]>([
    {
      id: "story-1",
      channel: "telegram",
      text: "🔥 Сезонная скидка на все услуги сервиса до конца недели!",
      media_type: "image",
      status: "published",
      views_count: 342,
      reactions_count: 28,
      created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    },
    {
      id: "story-2",
      channel: "max",
      text: "Новое поступление оригинальных запчастей на склад",
      media_type: "image",
      status: "scheduled",
      views_count: 0,
      reactions_count: 0,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    },
  ]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    setIsSubmitting(true);
    setSuccessMessage(null);

    // Эмуляция отправки по API /api/v1/stories
    setTimeout(() => {
      const newStory: StoryPost = {
        id: `story-${Date.now()}`,
        channel,
        text,
        media_type: "image",
        status: scheduledAt ? "scheduled" : "published",
        views_count: 0,
        reactions_count: 0,
        scheduled_at: scheduledAt || undefined,
        created_at: new Date().toISOString(),
      };

      setStories([newStory, ...stories]);
      setText("");
      setLinkUrl("");
      setLinkText("");
      setScheduledAt("");
      setIsSubmitting(false);
      setSuccessMessage(scheduledAt ? "История успешно запланирована!" : "История успешно опубликована в канале!");

      setTimeout(() => setSuccessMessage(null), 4000);
    }, 600);
  };

  return (
    <div className="flex-1 bg-white min-h-[calc(100vh-3rem)] text-[#111111] font-sans">
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-[16px] font-semibold text-[#000000] tracking-tight">Истории (Stories)</h1>
          <p className="text-[12px] text-[#666666] mt-0.5">
            Публикация и планирование мультиканальных историй в Telegram, MAX и WhatsApp
          </p>
        </div>

        {successMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            {successMessage}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Левая часть: Форма создания */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-[#e5e5e5] p-5 shadow-2xs">
            <h2 className="text-[13px] font-semibold text-[#000000] mb-3.5 flex items-center gap-2">
              <Send className="w-3.5 h-3.5 text-[#111111]" /> Создать публикацию
            </h2>

            <form onSubmit={handlePublish} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1.5">
                  Канал публикации
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setChannel("telegram")}
                    className={cn(
                      "h-8 px-2 text-[12px] font-medium rounded-lg border text-center transition-colors",
                      channel === "telegram"
                        ? "bg-[#f4f4f5] border-[#888888] text-[#000000]"
                        : "bg-white border-[#e5e5e5] text-[#666666] hover:bg-[#fafafa]",
                    )}
                  >
                    Telegram
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannel("max")}
                    className={cn(
                      "h-8 px-2 text-[12px] font-medium rounded-lg border text-center transition-colors",
                      channel === "max"
                        ? "bg-[#f4f4f5] border-[#888888] text-[#000000]"
                        : "bg-white border-[#e5e5e5] text-[#666666] hover:bg-[#fafafa]",
                    )}
                  >
                    MAX
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannel("whatsapp")}
                    className={cn(
                      "h-8 px-2 text-[12px] font-medium rounded-lg border text-center transition-colors",
                      channel === "whatsapp"
                        ? "bg-[#f4f4f5] border-[#888888] text-[#000000]"
                        : "bg-white border-[#e5e5e5] text-[#666666] hover:bg-[#fafafa]",
                    )}
                  >
                    WhatsApp
                  </button>
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
                  className="w-full text-[13px] rounded-lg border border-[#e5e5e5] p-2.5 focus:outline-none focus:border-[#888888] bg-white text-[#000000] placeholder:text-[#888888]"
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
                    placeholder="https://..."
                    className="h-8 w-full text-[13px] rounded-lg border border-[#e5e5e5] px-2.5 focus:outline-none focus:border-[#888888] bg-white text-[#000000] placeholder:text-[#888888]"
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
                    className="h-8 w-full text-[13px] rounded-lg border border-[#e5e5e5] px-2.5 focus:outline-none focus:border-[#888888] bg-white text-[#000000] placeholder:text-[#888888]"
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
                  className="h-8 w-full text-[13px] rounded-lg border border-[#e5e5e5] px-2.5 focus:outline-none focus:border-[#888888] bg-white text-[#000000]"
                />
              </div>

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || !text.trim()}
                  className="h-8 px-4 bg-[#111111] hover:bg-[#222222] text-white font-medium rounded-lg text-[13px] shadow-2xs transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
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

            <div className="w-[240px] h-[430px] bg-black rounded-[32px] p-2.5 shadow-md border-2 border-[#e5e5e5] relative flex flex-col overflow-hidden">
              <div className="w-full h-full rounded-[22px] bg-gradient-to-br from-indigo-950 to-slate-900 p-3.5 flex flex-col justify-between text-white relative overflow-hidden">
                <div className="flex items-center gap-2 z-10">
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white shadow-xs">
                    GV
                  </div>
                  <div className="text-xs">
                    <p className="font-medium text-[11px] leading-tight">GETVOXLY</p>
                    <p className="text-[9px] text-slate-400">Только что</p>
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
        <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden shadow-2xs">
          <div className="px-4 py-3 border-b border-[#e5e5e5]">
            <h3 className="text-[13px] font-semibold text-[#000000]">Журнал историй</h3>
          </div>
          <div className="divide-y divide-[#f0f0f0]">
            {stories.map((story) => (
              <div key={story.id} className="p-3.5 flex items-center justify-between hover:bg-[#fafafa] transition-colors">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-black/[0.05] text-[#333333]">
                      {story.channel}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-medium",
                        story.status === "published"
                          ? "bg-emerald-50 text-emerald-700"
                          : story.status === "scheduled"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-[#f4f4f5] text-[#666666]",
                      )}
                    >
                      {story.status === "published"
                        ? "Опубликовано"
                        : story.status === "scheduled"
                          ? "Запланировано"
                          : story.status}
                    </span>
                  </div>
                  <p className="text-[13px] text-[#111111] font-medium line-clamp-1">{story.text}</p>
                </div>

                <div className="flex items-center gap-3.5 text-xs text-[#888888]">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-[#888888]" /> {story.views_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="w-3.5 h-3.5 text-rose-500" /> {story.reactions_count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
