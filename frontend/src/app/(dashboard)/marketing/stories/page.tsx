"use client";

import React, { useState } from "react";
import { Send, Smartphone, Image as ImageIcon, Calendar, CheckCircle2, Clock, Eye, Heart } from "lucide-react";

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
      const newPost: StoryPost = {
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
      setStories([newPost, ...stories]);
      setText("");
      setLinkUrl("");
      setLinkText("");
      setScheduledAt("");
      setIsSubmitting(false);
      setSuccessMessage(scheduledAt ? "История запланирована к публикации!" : "История успешно опубликована!");
    }, 400);
  };

  return (
    <div className="flex-1 p-6 bg-slate-50 min-h-screen text-slate-900 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Истории (Stories)</h1>
          <p className="text-sm text-slate-500 mt-1">
            Публикация и планирование мультиканальных историй в Telegram, MAX и WhatsApp
          </p>
        </div>

        {successMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            {successMessage}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Левая часть: Форма создания */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Send className="w-4 h-4 text-blue-600" /> Создать публикацию
            </h2>

            <form onSubmit={handlePublish} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                  Канал публикации
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setChannel("telegram")}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-center transition-colors ${
                      channel === "telegram"
                        ? "bg-blue-50 border-blue-500 text-blue-700 shadow-sm"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Telegram
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannel("max")}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-center transition-colors ${
                      channel === "max"
                        ? "bg-blue-50 border-blue-500 text-blue-700 shadow-sm"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    MAX
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannel("whatsapp")}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-center transition-colors ${
                      channel === "whatsapp"
                        ? "bg-blue-50 border-blue-500 text-blue-700 shadow-sm"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    WhatsApp
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                  Текст истории
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  placeholder="Введите текст истории или призыв к действию..."
                  className="w-full text-sm rounded-lg border border-slate-200 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white placeholder:text-slate-400"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                    Ссылка перехода (URL)
                  </label>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full text-sm rounded-lg border border-slate-200 p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                    Текст кнопки
                  </label>
                  <input
                    type="text"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    placeholder="Подробнее / Записаться"
                    className="w-full text-sm rounded-lg border border-slate-200 p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Отложенная публикация
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full text-sm rounded-lg border border-slate-200 p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || !text.trim()}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  {scheduledAt ? "Запланировать историю" : "Опубликовать сейчас"}
                </button>
              </div>
            </form>
          </div>

          {/* Правая часть: Мобильное превью 9:16 */}
          <div className="lg:col-span-5 flex flex-col items-center">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-slate-400" /> Предпросмотр (9:16)
            </div>

            <div className="w-[280px] h-[500px] bg-slate-900 rounded-[36px] p-3 shadow-xl border-4 border-slate-800 relative flex flex-col overflow-hidden">
              <div className="w-full h-full rounded-[24px] bg-gradient-to-br from-indigo-900 to-slate-900 p-4 flex flex-col justify-between text-white relative overflow-hidden">
                <div className="flex items-center gap-2 z-10">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white shadow">
                    GV
                  </div>
                  <div className="text-xs">
                    <p className="font-semibold leading-tight">GETVOXLY</p>
                    <p className="text-[10px] text-slate-300">Только что</p>
                  </div>
                </div>

                <div className="my-auto z-10 text-center py-6 px-2">
                  <p className="text-sm font-medium leading-relaxed drop-shadow-md">
                    {text || "Ваш текст истории будет отображаться здесь..."}
                  </p>
                </div>

                {linkUrl && (
                  <div className="z-10 pb-2 flex justify-center">
                    <span className="px-4 py-1.5 bg-white text-slate-900 rounded-full text-xs font-semibold shadow hover:bg-slate-100 transition-colors">
                      {linkText || "Перейти"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Список опубликованных историй */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">Журнал историй</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {stories.map((story) => (
              <div key={story.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {story.channel}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        story.status === "published"
                          ? "bg-emerald-50 text-emerald-700"
                          : story.status === "scheduled"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {story.status === "published"
                        ? "Опубликовано"
                        : story.status === "scheduled"
                          ? "Запланировано"
                          : story.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800 font-medium line-clamp-1">{story.text}</p>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-slate-400" /> {story.views_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="w-3.5 h-3.5 text-rose-400" /> {story.reactions_count}
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
