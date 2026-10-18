"use client";

import React, { useState } from "react";
import {
  MessageSquare,
  Search,
  Filter,
  Send,
  Paperclip,
  Check,
  CheckCheck,
  Clock,
  User,
  Phone,
  Briefcase,
  ChevronRight,
  Sparkles,
} from "lucide-react";

interface InboxThread {
  id: string;
  dealId: string;
  contactName: string;
  contactPhone: string;
  channel: "telegram" | "whatsapp" | "max" | "webchat";
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  dealTitle: string;
  stageName: string;
  budget: number;
}

interface ThreadMessage {
  id: string;
  source: "client" | "manager" | "ai";
  senderName: string;
  content: string;
  createdAt: string;
  deliveryStatus: "pending" | "sent" | "delivered" | "read";
}

const INITIAL_THREADS: InboxThread[] = [
  {
    id: "thread-1",
    dealId: "deal-101",
    contactName: "Алексей Смирнов",
    contactPhone: "+7 (916) 123-45-67",
    channel: "telegram",
    lastMessage: "Здравствуйте, подскажите статус готовности заказа?",
    lastMessageAt: "10:42",
    unreadCount: 1,
    dealTitle: "Ремонт MacBook Pro 16",
    stageName: "В работе",
    budget: 24500,
  },
  {
    id: "thread-2",
    dealId: "deal-102",
    contactName: "Елена Васильева",
    contactPhone: "+7 (925) 987-65-43",
    channel: "whatsapp",
    lastMessage: "Спасибо, оплату отправила по ссылке!",
    lastMessageAt: "Вчера",
    unreadCount: 0,
    dealTitle: "Замена экрана iPhone 15",
    stageName: "Согласование",
    budget: 18000,
  },
  {
    id: "thread-3",
    dealId: "deal-103",
    contactName: "Дмитрий Ковалев",
    contactPhone: "+7 (903) 555-12-34",
    channel: "webchat",
    lastMessage: "Добрый день! Работаете ли вы в выходные дни?",
    lastMessageAt: "18 окт",
    unreadCount: 0,
    dealTitle: "Диагностика системного блока",
    stageName: "Новый лид",
    budget: 0,
  },
];

export default function InboxPage() {
  const [threads, setThreads] = useState<InboxThread[]>(INITIAL_THREADS);
  const [selectedThreadId, setSelectedThreadId] = useState<string>("thread-1");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const [messagesByThread, setMessagesByThread] = useState<Record<string, ThreadMessage[]>>({
    "thread-1": [
      {
        id: "m-1",
        source: "client",
        senderName: "Алексей Смирнов",
        content: "Добрый день! Сдал вчера ноутбук на замену термопасты и чистку.",
        createdAt: "10:30",
        deliveryStatus: "read",
      },
      {
        id: "m-2",
        source: "manager",
        senderName: "Менеджер",
        content: "Здравствуйте, Алексей! Мастер уже завершил профилактику и сейчас проводит стресс-тесты.",
        createdAt: "10:35",
        deliveryStatus: "read",
      },
      {
        id: "m-3",
        source: "client",
        senderName: "Алексей Смирнов",
        content: "Здравствуйте, подскажите статус готовности заказа?",
        createdAt: "10:42",
        deliveryStatus: "read",
      },
    ],
  });

  const activeThread = threads.find((t) => t.id === selectedThreadId) ?? threads[0];
  const activeMessages = activeThread ? (messagesByThread[activeThread.id] ?? []) : [];

  const filteredThreads = threads.filter((t) => {
    if (channelFilter !== "all" && t.channel !== channelFilter) return false;
    if (unreadOnly && t.unreadCount === 0) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        t.contactName.toLowerCase().includes(q) ||
        t.dealTitle.toLowerCase().includes(q) ||
        t.lastMessage.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeThread) return;

    setIsSending(true);
    const newMessage: ThreadMessage = {
      id: `msg-${Date.now()}`,
      source: "manager",
      senderName: "Менеджер",
      content: inputText.trim(),
      createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      deliveryStatus: "sent",
    };

    setMessagesByThread((prev) => ({
      ...prev,
      [activeThread.id]: [...(prev[activeThread.id] ?? []), newMessage],
    }));

    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThread.id
          ? { ...t, lastMessage: inputText.trim(), lastMessageAt: newMessage.createdAt, unreadCount: 0 }
          : t,
      ),
    );

    setInputText("");
    setIsSending(false);
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] bg-white font-sans text-slate-900 overflow-hidden">
      {/* Шапка раздела */}
      <div className="h-14 border-b border-slate-200 px-6 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-blue-600" />
          <h1 className="text-base font-semibold text-slate-900">Входящие (Inbox)</h1>
          <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-medium">
            Омниканальный чат
          </span>
        </div>
      </div>

      {/* 3-колоночный рабочий стол */}
      <div className="flex-1 flex min-h-0">
        {/* Левая колонка: Список диалогов */}
        <div className="w-80 md:w-96 border-r border-slate-200 flex flex-col shrink-0 bg-slate-50/50">
          {/* Поиск и фильтры */}
          <div className="p-3 border-b border-slate-200 space-y-2 bg-white">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Поиск диалогов или сделок..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-200 pl-9 pr-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <button
                type="button"
                onClick={() => setChannelFilter("all")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                  channelFilter === "all"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                }`}
              >
                Все каналы
              </button>
              <button
                type="button"
                onClick={() => setChannelFilter("telegram")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                  channelFilter === "telegram"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                }`}
              >
                Telegram
              </button>
              <button
                type="button"
                onClick={() => setChannelFilter("whatsapp")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                  channelFilter === "whatsapp"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                }`}
              >
                WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setChannelFilter("max")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                  channelFilter === "max"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                }`}
              >
                MAX
              </button>
            </div>
          </div>

          {/* Список бесед */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredThreads.map((thread) => {
              const isSelected = thread.id === selectedThreadId;
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedThreadId(thread.id)}
                  className={`w-full p-3.5 text-left transition-colors flex items-start gap-3 ${
                    isSelected ? "bg-blue-50/60 border-l-4 border-l-blue-600" : "hover:bg-slate-100/60"
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-medium text-xs shrink-0">
                    {thread.contactName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold text-slate-900 truncate">{thread.contactName}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{thread.lastMessageAt}</span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mb-1">{thread.dealTitle}</p>
                    <p className="text-xs text-slate-700 truncate line-clamp-1">{thread.lastMessage}</p>
                  </div>
                  {thread.unreadCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      {thread.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Центральная колонка: Чат */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {activeThread ? (
            <>
              {/* Шапка беседы */}
              <div className="h-14 border-b border-slate-200 px-6 flex items-center justify-between shrink-0 bg-white">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold text-xs">
                    {activeThread.contactName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xs font-semibold text-slate-900 leading-tight">
                      {activeThread.contactName}
                    </h2>
                    <p className="text-[11px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      Канал: <span className="font-medium text-slate-600">{activeThread.channel}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium border border-slate-200">
                    {activeThread.stageName}
                  </span>
                </div>
              </div>

              {/* Сообщения */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30">
                {activeMessages.map((msg) => {
                  const isManager = msg.source === "manager";
                  const isAi = msg.source === "ai";
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isManager || isAi ? "items-end" : "items-start"}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 px-1">
                        <span className="text-[11px] font-medium text-slate-500">{msg.senderName}</span>
                        <span className="text-[10px] text-slate-400">{msg.createdAt}</span>
                      </div>
                      <div
                        className={`max-w-lg rounded-2xl p-3.5 text-xs leading-relaxed shadow-sm ${
                          isManager
                            ? "bg-blue-600 text-white rounded-br-none"
                            : isAi
                              ? "bg-indigo-600 text-white rounded-br-none"
                              : "bg-white text-slate-900 border border-slate-200 rounded-bl-none"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Поле ввода */}
              <div className="p-4 border-t border-slate-200 bg-white shrink-0">
                <form onSubmit={handleSendMessage} className="flex items-center gap-3">
                  <button
                    type="button"
                    className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>

                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Написать ответ клиенту..."
                    className="flex-1 text-xs rounded-lg border border-slate-200 p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white placeholder:text-slate-400"
                  />

                  <button
                    type="submit"
                    disabled={isSending || !inputText.trim()}
                    className="py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-xs shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" /> Отправить
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
              Выберите диалог из списка слева
            </div>
          )}
        </div>

        {/* Правая колонка: Контекст клиента и сделки */}
        {activeThread && (
          <div className="w-72 border-l border-slate-200 p-5 bg-white shrink-0 space-y-6 hidden lg:block overflow-y-auto">
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Карточка сделки
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-slate-400">Название</label>
                  <p className="text-xs font-medium text-slate-800">{activeThread.dealTitle}</p>
                </div>
                <div>
                  <label className="text-[11px] text-slate-400">Бюджет</label>
                  <p className="text-xs font-semibold text-slate-900">
                    {activeThread.budget.toLocaleString("ru-RU")} ₽
                  </p>
                </div>
                <div>
                  <label className="text-[11px] text-slate-400">Этап воронки</label>
                  <span className="inline-block mt-0.5 text-xs px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium border border-blue-200">
                    {activeThread.stageName}
                  </span>
                </div>
              </div>
            </div>

            <hr className="border-slate-100" />

            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Контактные данные
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-2 text-slate-700">
                  <User className="w-4 h-4 text-slate-400" /> {activeThread.contactName}
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <Phone className="w-4 h-4 text-slate-400" /> {activeThread.contactPhone}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
