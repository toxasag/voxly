(function () {
  'use strict';

  // Поиск скрипта и параметров конфигурации
  const currentScript = document.currentScript || document.querySelector('script[data-channel-id]');
  if (!currentScript) {
    console.warn('[GetVoxly] Webchat script is missing data-channel-id attribute.');
    return;
  }

  const channelAccountId = currentScript.getAttribute('data-channel-id');
  const apiUrl = (currentScript.getAttribute('data-api-url') || 'https://api.getvoxly.ru').replace(/\/$/, '');
  const telegramBot = currentScript.getAttribute('data-telegram-bot') || '';

  // Ключи локального хранилища
  const STORAGE_KEY_VISITOR = `getvoxly_visitor_${channelAccountId}`;
  let visitorId = localStorage.getItem(STORAGE_KEY_VISITOR) || '';

  // Стили виджета (темная тема GETVOXLY slate-950/amber-500)
  const styles = `
    .getvoxly-widget-bubble {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #f59e0b;
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.35);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
    }
    .getvoxly-widget-bubble:hover {
      transform: scale(1.06);
      box-shadow: 0 12px 30px rgba(245, 158, 11, 0.45);
    }
    .getvoxly-widget-window {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      height: 580px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 120px);
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f1f5f9;
      animation: getvoxlySlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes getvoxlySlideUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .getvoxly-header {
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .getvoxly-header-title {
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .getvoxly-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      display: inline-block;
      box-shadow: 0 0 8px #10b981;
    }
    .getvoxly-header-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      padding: 4px;
    }
    .getvoxly-header-close:hover {
      color: #f1f5f9;
    }
    .getvoxly-telegram-banner {
      background: #0b1e36;
      border-bottom: 1px solid #1e3a5f;
      padding: 8px 14px;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #38bdf8;
    }
    .getvoxly-telegram-btn {
      background: #0284c7;
      color: #ffffff;
      padding: 4px 10px;
      border-radius: 6px;
      font-weight: 500;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
    }
    .getvoxly-telegram-btn:hover {
      background: #0369a1;
    }
    .getvoxly-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .getvoxly-msg {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.45;
      word-break: break-word;
    }
    .getvoxly-msg-bot {
      background: #1e293b;
      color: #f8fafc;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .getvoxly-msg-user {
      background: #f59e0b;
      color: #020617;
      font-weight: 500;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .getvoxly-input-area {
      padding: 12px 14px;
      background: #0f172a;
      border-top: 1px solid #1e293b;
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .getvoxly-textarea {
      flex: 1;
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #f1f5f9;
      padding: 8px 12px;
      font-size: 13px;
      font-family: inherit;
      resize: none;
      height: 38px;
      max-height: 90px;
      outline: none;
      line-height: 1.35;
    }
    .getvoxly-textarea:focus {
      border-color: #f59e0b;
    }
    .getvoxly-send-btn {
      background: #f59e0b;
      color: #020617;
      border: none;
      border-radius: 8px;
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-weight: bold;
    }
    .getvoxly-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .getvoxly-typing {
      font-size: 11px;
      color: #94a3b8;
      font-style: italic;
      padding: 0 16px 8px;
      display: none;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  // Создание элементов DOM
  const bubble = document.createElement('div');
  bubble.className = 'getvoxly-widget-bubble';
  bubble.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#020617" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
    </svg>
  `;

  const win = document.createElement('div');
  win.className = 'getvoxly-widget-window';
  win.innerHTML = `
    <div class="getvoxly-header">
      <div class="getvoxly-header-title">
        <span class="getvoxly-status-dot"></span>
        <span id="getvoxly-bot-title">Онлайн-консультант</span>
      </div>
      <button class="getvoxly-header-close" id="getvoxly-close">&times;</button>
    </div>
    <div class="getvoxly-telegram-banner" id="getvoxly-tg-banner" style="display: none;">
      <span>Удобнее в Telegram?</span>
      <a href="#" target="_blank" class="getvoxly-telegram-btn" id="getvoxly-tg-link">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
        </svg>
        Перейти
      </a>
    </div>
    <div class="getvoxly-messages" id="getvoxly-messages">
      <div class="getvoxly-msg getvoxly-msg-bot">
        Здравствуйте! Чем я могу вам помочь? Напишите ваш вопрос, и я сразу отвечу.
      </div>
    </div>
    <div class="getvoxly-typing" id="getvoxly-typing">Ассистент печатает ответ...</div>
    <div class="getvoxly-input-area">
      <textarea class="getvoxly-textarea" id="getvoxly-input" placeholder="Введите ваш вопрос..."></textarea>
      <button class="getvoxly-send-btn" id="getvoxly-send">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
        </svg>
      </button>
    </div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(win);

  const messagesContainer = win.querySelector('#getvoxly-messages');
  const inputEl = win.querySelector('#getvoxly-input');
  const sendBtn = win.querySelector('#getvoxly-send');
  const closeBtn = win.querySelector('#getvoxly-close');
  const typingIndicator = win.querySelector('#getvoxly-typing');
  const botTitle = win.querySelector('#getvoxly-bot-title');
  const tgBanner = win.querySelector('#getvoxly-tg-banner');
  const tgLink = win.querySelector('#getvoxly-tg-link');

  // Переключение окна
  let isOpen = false;
  function toggleWidget() {
    isOpen = !isOpen;
    win.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) {
      inputEl.focus();
      initSession();
    }
  }

  bubble.addEventListener('click', toggleWidget);
  closeBtn.addEventListener('click', toggleWidget);

  // Инициализация сессии на сервере
  async function initSession() {
    try {
      const res = await fetch(`${apiUrl}/api/v1/public/chat/init/${channelAccountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: visitorId || undefined }),
      });
      if (res.ok) {
        const data = (await res.json()).data;
        visitorId = data.visitorId;
        localStorage.setItem(STORAGE_KEY_VISITOR, visitorId);
        botTitle.textContent = `${data.tenantName} (${data.botName})`;

        // Настройка Telegram deep-link
        const botName = telegramBot || data.telegramBot;
        if (botName) {
          tgBanner.style.display = 'flex';
          tgLink.href = `https://t.me/${botName}?start=site_${visitorId}`;
        }
      }
    } catch (e) {
      console.warn('[GetVoxly] Failed to init chat session', e);
    }
  }

  // Добавление сообщения в UI
  function appendMessage(text, isUser) {
    const el = document.createElement('div');
    el.className = `getvoxly-msg ${isUser ? 'getvoxly-msg-user' : 'getvoxly-msg-bot'}`;
    el.textContent = text;
    messagesContainer.appendChild(el);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Отправка сообщения
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    inputEl.style.height = '38px';
    appendMessage(text, true);

    typingIndicator.style.display = 'block';
    sendBtn.disabled = true;

    try {
      const res = await fetch(`${apiUrl}/api/v1/public/chat/message/${channelAccountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: visitorId || `visitor_${Math.random().toString(36).substring(2, 9)}`,
          text: text,
          pageUrl: window.location.href,
        }),
      });

      typingIndicator.style.display = 'none';
      sendBtn.disabled = false;

      if (res.ok) {
        const result = (await res.json()).data;
        if (result.replies && result.replies.length > 0) {
          result.replies.forEach((msg, idx) => {
            setTimeout(() => appendMessage(msg, false), idx * 600);
          });
        } else if (result.status === 'operator_needed') {
          appendMessage('Спасибо за сообщение! Мы зафиксировали заявку в CRM. Оператор скоро подключится к диалогу.', false);
        }
      } else {
        appendMessage('Извините, не удалось доставить сообщение. Попробуйте еще раз позже.', false);
      }
    } catch (e) {
      typingIndicator.style.display = 'none';
      sendBtn.disabled = false;
      appendMessage('Ошибка связи с сервером. Проверьте интернет-соединение.', false);
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
})();
