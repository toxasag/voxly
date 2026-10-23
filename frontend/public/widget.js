(function () {
  'use strict';

  // 1. Вспомогательная функция телеметрии для диагностики в реальном времени
  function sendTelemetry(step, detail) {
    try {
      var img = new Image();
      var d = detail ? '&d=' + encodeURIComponent(String(detail).slice(0, 200)) : '';
      img.src = 'https://api.getvoxly.ru/api/v1/public/chat/debug?step=' + encodeURIComponent(step) + d + '&t=' + Date.now();
    } catch (e) {}
  }

  // Сигнал о старте выполнения скрипта в браузере
  sendTelemetry('script_loaded', typeof document !== 'undefined' ? document.readyState : 'no_doc');

  // 2. Безопасная работа с хранилищем (защита от крашей в Incognito / Private Browsing / Cookie Blockers)
  var memStorage = {};
  var safeStorage = {
    getItem: function (key) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key);
        }
      } catch (e) {}
      return memStorage[key] || null;
    },
    setItem: function (key, value) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value);
          return;
        }
      } catch (e) {}
      memStorage[key] = String(value);
    },
  };

  var memSessionStorage = {};
  var safeSessionStorage = {
    getItem: function (key) {
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          return window.sessionStorage.getItem(key);
        }
      } catch (e) {}
      return memSessionStorage[key] || null;
    },
    setItem: function (key, value) {
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem(key, value);
          return;
        }
      } catch (e) {}
      memSessionStorage[key] = String(value);
    },
  };

  // Вспомогательная функция для cookies с защитой от SecurityError
  function getCookie(name) {
    try {
      if (typeof document === 'undefined' || !document.cookie) return null;
      var match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (e) {
      return null;
    }
  }

  // 3. Отказоустойчивый поиск ID канала (только стандартные селекторы CSS2)
  function getChannelAccountId() {
    // 3.1. Прямой поиск script[data-account-id]
    try {
      var s1 = document.querySelector('script[data-account-id]');
      if (s1) {
        var id1 = s1.getAttribute('data-account-id');
        if (id1 && id1.trim()) return id1.trim();
      }
    } catch (e) {}

    // 3.2. Прямой поиск script[data-channel-id]
    try {
      var s2 = document.querySelector('script[data-channel-id]');
      if (s2) {
        var id2 = s2.getAttribute('data-channel-id');
        if (id2 && id2.trim()) return id2.trim();
      }
    } catch (e) {}

    // 3.3. Проверка document.currentScript
    try {
      if (document.currentScript) {
        var idCur =
          document.currentScript.getAttribute('data-account-id') ||
          document.currentScript.getAttribute('data-channel-id');
        if (idCur && idCur.trim()) return idCur.trim();
      }
    } catch (e) {}

    // 3.4. Итерация по всем script-тегам на странице
    try {
      var allScripts = document.getElementsByTagName('script');
      for (var i = 0; i < allScripts.length; i++) {
        var tag = allScripts[i];
        var idAttr = tag.getAttribute('data-account-id') || tag.getAttribute('data-channel-id');
        if (idAttr && idAttr.trim()) return idAttr.trim();
      }
    } catch (e) {}

    return '';
  }

  function getScriptElement() {
    try {
      return (
        document.querySelector('script[data-account-id]') ||
        document.querySelector('script[data-channel-id]') ||
        document.currentScript ||
        null
      );
    } catch (e) {
      return document.currentScript || null;
    }
  }

  // 4. Стили виджета с поддержкой мобильных устройств и safe-area
  var styles = `
    .getvoxly-widget-wrapper {
      position: fixed !important;
      bottom: calc(20px + env(safe-area-inset-bottom, 0px)) !important;
      right: calc(20px + env(safe-area-inset-right, 0px)) !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
      direction: ltr !important;
      pointer-events: auto !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .getvoxly-widget-wrapper.position-left {
      right: auto !important;
      left: calc(20px + env(safe-area-inset-left, 0px)) !important;
    }
    .getvoxly-widget-wrapper * {
      box-sizing: border-box !important;
    }

    @keyframes getvoxlyPulse {
      0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(74, 56, 245, 0.45); }
      70% { transform: scale(1.04); box-shadow: 0 0 0 14px rgba(74, 56, 245, 0); }
      100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(74, 56, 245, 0); }
    }

    .getvoxly-widget-bubble {
      width: 60px !important;
      height: 60px !important;
      min-width: 60px !important;
      min-height: 60px !important;
      border-radius: 50% !important;
      background: #4a38f5 !important;
      box-shadow: 0 8px 24px rgba(74, 56, 245, 0.35) !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: relative !important;
      animation: getvoxlyPulse 2.4s infinite !important;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s !important;
      user-select: none !important;
      border: none !important;
      outline: none !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .getvoxly-widget-bubble:hover {
      animation: none !important;
      transform: scale(1.06) !important;
      box-shadow: 0 12px 30px rgba(74, 56, 245, 0.45) !important;
    }
    .getvoxly-widget-bubble.is-photo {
      padding: 2px !important;
      overflow: visible !important;
      background: #ffffff !important;
      border: 2px solid #ffffff !important;
    }
    .getvoxly-bubble-photo-img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      border-radius: 50% !important;
      display: block !important;
    }
    .getvoxly-bubble-dot {
      position: absolute !important;
      bottom: 1px !important;
      right: 1px !important;
      width: 14px !important;
      height: 14px !important;
      background: #10b981 !important;
      border: 2px solid #ffffff !important;
      border-radius: 50% !important;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.6) !important;
      z-index: 2 !important;
    }
    .getvoxly-widget-bubble.is-mascot {
      background: transparent !important;
      box-shadow: none !important;
      animation: none !important;
      overflow: visible !important;
      width: 66px !important;
      height: 66px !important;
      min-width: 66px !important;
      min-height: 66px !important;
    }
    .getvoxly-mascot-wrap {
      width: 66px !important;
      height: 66px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: relative !important;
      filter: drop-shadow(0 10px 22px rgba(0, 0, 0, 0.35)) !important;
      transition: transform 0.15s ease-out !important;
    }
    .getvoxly-mascot-wrap:hover {
      transform: scale(1.08) !important;
    }
    .getvoxly-mascot-wrap.squashing {
      animation: getvoxly-squash 0.35s ease-out !important;
    }
    .getvoxly-mascot-sprite {
      width: 64px !important;
      height: 64px !important;
      background-repeat: no-repeat !important;
      background-size: 300% 300% !important;
      background-position: 50% 50% !important;
      background-color: rgba(74, 56, 245, 0.12) !important;
      image-rendering: -webkit-optimize-contrast !important;
      user-select: none !important;
      -webkit-user-drag: none !important;
      pointer-events: none !important;
      border-radius: 50% !important;
      transition: background-position 0.05s ease-out !important;
    }
    @keyframes getvoxly-squash {
      0% { transform: scale(1, 1); }
      30% { transform: scale(1.18, 0.82); }
      60% { transform: scale(0.92, 1.08); }
      100% { transform: scale(1, 1); }
    }

    .getvoxly-chat-badge {
      position: absolute !important;
      right: 74px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      background: var(--badge-color, #4a38f5) !important;
      color: #ffffff !important;
      padding: 7px 14px !important;
      font-size: 13px !important;
      border-radius: 10px !important;
      font-weight: 600 !important;
      white-space: nowrap !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25) !important;
      pointer-events: auto !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      transition: opacity 0.25s, transform 0.25s !important;
      line-height: 1.3 !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .position-left .getvoxly-chat-badge {
      right: auto !important;
      left: 74px !important;
    }
    .getvoxly-chat-badge::after {
      content: '' !important;
      position: absolute !important;
      top: 50% !important;
      right: -6px !important;
      transform: translateY(-50%) !important;
      border-width: 6px 0 6px 6px !important;
      border-style: solid !important;
      border-color: transparent transparent transparent var(--badge-color, #4a38f5) !important;
    }
    .position-left .getvoxly-chat-badge::after {
      right: auto !important;
      left: -6px !important;
      border-width: 6px 6px 6px 0 !important;
      border-color: transparent var(--badge-color, #4a38f5) transparent transparent !important;
    }

    .getvoxly-widget-window {
      position: fixed !important;
      bottom: calc(88px + env(safe-area-inset-bottom, 0px)) !important;
      right: calc(20px + env(safe-area-inset-right, 0px)) !important;
      width: 380px !important;
      max-width: calc(100vw - 32px) !important;
      height: 580px !important;
      max-height: calc(100vh - 120px) !important;
      background: #090d16 !important;
      color: #f8fafc !important;
      border-radius: 16px !important;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.45) !important;
      border: 1px solid #1e293b !important;
      display: none;
      flex-direction: column !important;
      overflow: hidden !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      box-sizing: border-box !important;
      direction: ltr !important;
    }
    .getvoxly-widget-window * {
      box-sizing: border-box !important;
    }
    .getvoxly-widget-window.position-left {
      right: auto !important;
      left: calc(20px + env(safe-area-inset-left, 0px)) !important;
    }

    @media (max-width: 480px) {
      .getvoxly-chat-badge {
        display: none !important;
      }
      .getvoxly-widget-window {
        right: 10px !important;
        left: 10px !important;
        width: calc(100vw - 20px) !important;
        max-width: calc(100vw - 20px) !important;
        bottom: calc(84px + env(safe-area-inset-bottom, 0px)) !important;
        height: calc(100vh - 110px) !important;
        max-height: calc(100vh - 110px) !important;
      }
    }

    .getvoxly-header {
      background: #0f172a;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #1e293b;
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
    }
    .getvoxly-header-close {
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 20px;
      padding: 0;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      transition: background 0.15s, color 0.15s;
    }
    .getvoxly-header-close:hover {
      background: #1e293b;
      color: #f8fafc;
    }

    .getvoxly-messenger-container {
      border-bottom: 1px solid #1e293b;
    }
    .getvoxly-msg-banner-single {
      padding: 8px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
    }
    .getvoxly-msg-banner-single.is-telegram {
      background: rgba(2, 132, 199, 0.12);
      color: #38bdf8;
    }
    .getvoxly-msg-banner-single.is-whatsapp {
      background: rgba(22, 163, 74, 0.12);
      color: #4ade80;
    }
    .getvoxly-msg-banner-single.is-max {
      background: rgba(99, 102, 241, 0.12);
      color: #818cf8;
    }
    .getvoxly-msg-btn-pill {
      color: #ffffff !important;
      padding: 4px 10px;
      border-radius: 6px;
      font-weight: 500;
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      text-decoration: none;
      transition: transform 0.1s ease, opacity 0.1s ease;
      cursor: pointer;
    }
    .getvoxly-msg-btn-pill:hover {
      transform: scale(1.04);
      opacity: 0.95;
    }
    .getvoxly-msg-btn-pill.btn-telegram { background: #0284c7; }
    .getvoxly-msg-btn-pill.btn-whatsapp { background: #16a34a; }
    .getvoxly-msg-btn-pill.btn-max { background: #6366f1; }

    .getvoxly-msg-bar-multi {
      padding: 7px 12px;
      background: rgba(255, 255, 255, 0.04);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .getvoxly-msg-bar-title {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.75;
      white-space: nowrap;
    }
    .getvoxly-msg-buttons-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .getvoxly-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #090d16;
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
      background: #4a38f5;
      color: #ffffff;
      font-weight: 500;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .getvoxly-input-area {
      padding: 10px 14px 4px;
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
      border-color: #4a38f5;
    }
    .getvoxly-send-btn {
      background: #4a38f5;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-weight: bold;
      transition: background 0.15s, opacity 0.15s;
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
    .getvoxly-consent {
      background: #0f172a;
      font-size: 10px;
      color: #64748b;
      text-align: center;
      padding: 2px 14px 8px;
      line-height: 1.25;
      user-select: none;
    }
  `;

  // 5. Функция монтирования виджета
  function mount(channelAccountId) {
    if (document.getElementById('getvoxly-bubble')) {
      return;
    }

    sendTelemetry('mount_started', channelAccountId);

    var currentScript = getScriptElement();
    var apiUrl = (
      (currentScript && currentScript.getAttribute('data-api-url')) ||
      'https://api.getvoxly.ru'
    ).replace(/\/$/, '');
    var telegramBot = (currentScript && currentScript.getAttribute('data-telegram-bot')) || '';
    var proactiveEnabled = (currentScript && currentScript.getAttribute('data-proactive')) !== 'false';
    var proactiveDelay = parseInt((currentScript && currentScript.getAttribute('data-proactive-delay')) || '30000', 10);

    var ymUid = getCookie('_ym_uid') || null;
    var gaId = getCookie('_ga') || null;

    // UTM-метки
    var STORAGE_KEY_UTM = 'getvoxly_utm_tags';
    var utmTags = {};
    try {
      utmTags = JSON.parse(safeStorage.getItem(STORAGE_KEY_UTM) || '{}');
    } catch (e) {
      utmTags = {};
    }

    try {
      var searchParams = new URLSearchParams(window.location.search);
      var detectedUtm = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (param) {
        if (searchParams.has(param)) {
          detectedUtm[param] = searchParams.get(param);
        }
      });
      if (Object.keys(detectedUtm).length > 0) {
        utmTags = Object.assign({}, utmTags, detectedUtm);
        safeStorage.setItem(STORAGE_KEY_UTM, JSON.stringify(utmTags));
      }
    } catch (e) {}

    // Идентификация посетителя
    var STORAGE_KEY_VISITOR = 'getvoxly_visitor_' + channelAccountId;
    var visitorId = safeStorage.getItem(STORAGE_KEY_VISITOR) || '';
    if (!visitorId) {
      visitorId = ymUid ? 'ym_' + ymUid : 'usr_' + Math.random().toString(36).substring(2, 11);
      safeStorage.setItem(STORAGE_KEY_VISITOR, visitorId);
    }

    // Счётчик визитов
    var STORAGE_KEY_VISIT_COUNT = 'getvoxly_visit_count';
    var visitCount = parseInt(safeStorage.getItem(STORAGE_KEY_VISIT_COUNT) || '0', 10);
    if (!safeSessionStorage.getItem('getvoxly_session_active')) {
      visitCount += 1;
      safeStorage.setItem(STORAGE_KEY_VISIT_COUNT, String(visitCount));
      safeSessionStorage.setItem('getvoxly_session_active', 'true');
    }

    // История страниц
    var STORAGE_KEY_PAGE_HISTORY = 'getvoxly_page_history';
    var pageHistory = [];
    try {
      pageHistory = JSON.parse(safeSessionStorage.getItem(STORAGE_KEY_PAGE_HISTORY) || '[]');
    } catch (e) {
      pageHistory = [];
    }

    try {
      var currentUrl = window.location.href;
      var currentTime = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      if (pageHistory.length === 0 || pageHistory[pageHistory.length - 1].url !== currentUrl) {
        pageHistory.push({ step: pageHistory.length + 1, time: currentTime, url: currentUrl });
        if (pageHistory.length > 10) pageHistory.shift();
        safeSessionStorage.setItem(STORAGE_KEY_PAGE_HISTORY, JSON.stringify(pageHistory));
      }
    } catch (e) {}

    var isOpen = false;
    var sessionInitialized = false;
    var lastDraft = '';
    var sentDrafts = {};
    var messageBuffer = [];
    var sendTimer = null;

    if (!document.getElementById('getvoxly-styles')) {
      var styleEl = document.createElement('style');
      styleEl.id = 'getvoxly-styles';
      styleEl.textContent = styles;
      (document.head || document.body).appendChild(styleEl);
    }

    // Создание DOM-структуры виджета
    var wrapper = document.createElement('div');
    wrapper.className = 'getvoxly-widget-wrapper';
    wrapper.id = 'getvoxly-wrapper';
    wrapper.innerHTML = `
      <div class="getvoxly-chat-badge" id="getvoxly-badge">Задайте вопрос</div>
      <div class="getvoxly-widget-bubble" id="getvoxly-bubble">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
        </svg>
      </div>
    `;

    var win = document.createElement('div');
    win.className = 'getvoxly-widget-window';
    win.id = 'getvoxly-window';
    win.innerHTML = `
      <div class="getvoxly-header">
        <div class="getvoxly-header-title">
          <span class="getvoxly-status-dot"></span>
          <span id="getvoxly-bot-title">Онлайн-консультант</span>
        </div>
        <button class="getvoxly-header-close" id="getvoxly-close">&times;</button>
      </div>
      <div class="getvoxly-messenger-container" id="getvoxly-messenger-container" style="display: none;"></div>
      <div class="getvoxly-messages" id="getvoxly-messages"></div>
      <div class="getvoxly-typing" id="getvoxly-typing">Ассистент печатает ответ...</div>
      <div class="getvoxly-input-area">
        <textarea class="getvoxly-textarea" id="getvoxly-input" placeholder="Введите ваш вопрос..."></textarea>
        <button class="getvoxly-send-btn" id="getvoxly-send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
          </svg>
        </button>
      </div>
      <div class="getvoxly-consent">
        Нажимая «Отправить», вы даете согласие на обработку персональных данных.
      </div>
    `;

    document.body.appendChild(wrapper);
    document.body.appendChild(win);

    sendTelemetry('dom_appended', 'bubble_ready');

    var bubble = document.getElementById('getvoxly-bubble');
    var badge = document.getElementById('getvoxly-badge');
    var messagesContainer = document.getElementById('getvoxly-messages');
    var inputEl = document.getElementById('getvoxly-input');
    var sendBtn = document.getElementById('getvoxly-send');
    var closeBtn = document.getElementById('getvoxly-close');
    var typingIndicator = document.getElementById('getvoxly-typing');
    var botTitle = document.getElementById('getvoxly-bot-title');
    var msgContainer = document.getElementById('getvoxly-messenger-container');

    // Локальная история сообщений
    var STORAGE_KEY_CHAT_HISTORY = 'getvoxly_chat_history_' + channelAccountId;
    function getLocalHistory() {
      try {
        return JSON.parse(safeStorage.getItem(STORAGE_KEY_CHAT_HISTORY) || '[]');
      } catch (e) {
        return [];
      }
    }

    function appendMessageToUI(text, isUser) {
      if (!messagesContainer) return;
      var el = document.createElement('div');
      el.className = 'getvoxly-msg ' + (isUser ? 'getvoxly-msg-user' : 'getvoxly-msg-bot');
      el.textContent = text;
      messagesContainer.appendChild(el);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function saveAndRenderMessage(text, isUser) {
      appendMessageToUI(text, isUser);
      var hist = getLocalHistory();
      hist.push({ text: text, isUser: isUser, timestamp: Date.now() });
      try {
        safeStorage.setItem(STORAGE_KEY_CHAT_HISTORY, JSON.stringify(hist));
      } catch (e) {}
    }

    var existingHistory = getLocalHistory();
    if (existingHistory.length > 0) {
      existingHistory.forEach(function (m) {
        appendMessageToUI(m.text, m.isUser);
      });
    }

    function openWidget() {
      isOpen = true;
      win.style.display = 'flex';
      badge.style.display = 'none';
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
      if (inputEl && typeof inputEl.focus === 'function') {
        inputEl.focus();
      }
      initSession();
    }

    function closeWidget() {
      isOpen = false;
      win.style.display = 'none';
    }

    function toggleWidget() {
      if (isOpen) {
        closeWidget();
      } else {
        openWidget();
      }
    }

    if (bubble) bubble.addEventListener('click', toggleWidget);
    if (badge) badge.addEventListener('click', openWidget);
    if (closeBtn) closeBtn.addEventListener('click', closeWidget);

    // Фоновая инициализация сессии на сервере
    initSession();

    if (proactiveEnabled && existingHistory.length === 0) {
      setTimeout(function () {
        if (!isOpen && getLocalHistory().length === 0) {
          openWidget();
        }
      }, proactiveDelay);
    }

    async function initSession() {
      if (sessionInitialized) return;
      try {
        sendTelemetry('init_fetch_start', channelAccountId);

        var res = await fetch(apiUrl + '/api/v1/public/chat/init/' + channelAccountId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId: visitorId || undefined }),
        });

        if (res.ok) {
          sessionInitialized = true;
          var data = (await res.json()).data;
          sendTelemetry('init_success', data.mascotId || 'none');

          if (data.visitorId) {
            visitorId = data.visitorId;
            safeStorage.setItem(STORAGE_KEY_VISITOR, visitorId);
          }

          botTitle.textContent = data.title || (data.tenantName + ' (' + data.botName + ')');

          if (data.accentColor) {
            bubble.style.background = data.accentColor;
            bubble.style.boxShadow = '0 8px 24px ' + data.accentColor + '55';
            sendBtn.style.background = data.accentColor;
            badge.style.background = data.accentColor;
            badge.style.setProperty('--badge-color', data.accentColor);
          }

          // Поддержка 3D-маскота или фото консультанта
          if (data.avatarType === 'mascot' || (!data.avatarType && (data.customMascotDirections || data.mascotId === 'custom'))) {
            bubble.classList.add('is-mascot');

            var assetBaseUrl = 'https://getvoxly.ru';
            var MASCOT_MAP = {
              voxly_robot: 'drone',
              friendly_fox: 'fox',
              smart_cat: 'cat',
              cyber_owl: 'scout',
              happy_alien: 'crt',
              friendly_panda: 'otter',
              tech_ninja: 'kamran',
            };

            var resolvedId = data.mascotId || 'drone';
            if (MASCOT_MAP[resolvedId]) {
              resolvedId = MASCOT_MAP[resolvedId];
            }

            var directionsUrl = assetBaseUrl + '/mascots/' + resolvedId + '-directions.webp';
            var reactionsUrl = assetBaseUrl + '/mascots/' + resolvedId + '-reactions.webp';

            if (resolvedId === 'custom' || data.customMascotDirections) {
              directionsUrl = data.customMascotDirections || directionsUrl;
              reactionsUrl = data.customMascotReactions || data.customMascotDirections || directionsUrl;
            }

            var mascotEl = document.createElement('div');
            mascotEl.className = 'getvoxly-mascot-wrap';
            mascotEl.id = 'getvoxly-mascot-el';

            var spriteEl = document.createElement('div');
            spriteEl.className = 'getvoxly-mascot-sprite';
            spriteEl.id = 'getvoxly-mascot-sprite';
            spriteEl.style.backgroundImage = 'url("' + directionsUrl + '")';

            var dot = document.createElement('span');
            dot.className = 'getvoxly-bubble-dot';

            mascotEl.appendChild(spriteEl);
            mascotEl.appendChild(dot);

            bubble.innerHTML = '';
            bubble.appendChild(mascotEl);

            var isBooped = false;
            var boopTimer = null;

            function setMascotCell(row, col) {
              if (!spriteEl) return;
              var x = col === 0 ? '0%' : col === 1 ? '50%' : '100%';
              var y = row === 0 ? '0%' : row === 1 ? '50%' : '100%';
              spriteEl.style.backgroundPosition = x + ' ' + y;
            }

            if (typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches && spriteEl) {
              window.addEventListener('pointermove', function (e) {
                if (isBooped) return;
                var b = bubble.getBoundingClientRect();
                var cx = b.left + b.width / 2;
                var cy = b.top + b.height / 2;
                var dx = e.clientX - cx;
                var dy = e.clientY - cy;
                var dist = Math.hypot(dx, dy);

                if (dist < 35) {
                  setMascotCell(1, 1);
                  return;
                }

                var angle = Math.atan2(dy, dx) * (180 / Math.PI);
                if (angle >= -22.5 && angle < 22.5) {
                  setMascotCell(1, 2);
                } else if (angle >= 22.5 && angle < 67.5) {
                  setMascotCell(2, 2);
                } else if (angle >= 67.5 && angle < 112.5) {
                  setMascotCell(2, 1);
                } else if (angle >= 112.5 && angle < 157.5) {
                  setMascotCell(2, 0);
                } else if (angle >= 157.5 || angle < -157.5) {
                  setMascotCell(1, 0);
                } else if (angle >= -157.5 && angle < -112.5) {
                  setMascotCell(0, 0);
                } else if (angle >= -112.5 && angle < -67.5) {
                  setMascotCell(0, 1);
                } else if (angle >= -67.5 && angle < -22.5) {
                  setMascotCell(0, 2);
                }
              }, { passive: true });
            }

            if (bubble) {
              bubble.addEventListener('pointerdown', function () {
                if (!spriteEl) return;
                isBooped = true;
                spriteEl.style.backgroundImage = 'url("' + reactionsUrl + '")';
                setMascotCell(1, 1);
                if (mascotEl) mascotEl.classList.add('squashing');

                clearTimeout(boopTimer);
                boopTimer = setTimeout(function () {
                  isBooped = false;
                  spriteEl.style.backgroundImage = 'url("' + directionsUrl + '")';
                  if (mascotEl) mascotEl.classList.remove('squashing');
                  setMascotCell(1, 1);
                }, 600);
              });
            }
          } else if (data.avatarType === 'photo' && data.consultantAvatar) {
            if (bubble) {
              bubble.classList.add('is-photo');
              bubble.innerHTML = '<img class="getvoxly-bubble-photo-img" src="' + data.consultantAvatar + '" alt="Консультант"><span class="getvoxly-bubble-dot"></span>';
            }
          }

          if (data.position === 'bottom-left') {
            wrapper.classList.add('position-left');
            win.classList.add('position-left');
          }

          if (data.placeholder) {
            inputEl.placeholder = data.placeholder;
          }

          if ((!messagesContainer.children || messagesContainer.children.length === 0) && data.greeting) {
            saveAndRenderMessage(data.greeting, false);
          }

          var buttons = data.messengerButtons || [];
          if (buttons.length === 0 && (telegramBot || data.telegramBot) && data.showTelegramBanner !== false) {
            var tb = (telegramBot || data.telegramBot).replace(/^@/, '');
            buttons.push({
              type: 'telegram',
              label: 'Telegram',
              url: 'https://t.me/' + tb,
              handle: '@' + tb,
            });
          }

          if (msgContainer && buttons.length > 0 && data.showMessengerBanner !== false && data.showTelegramBanner !== false) {
            msgContainer.style.display = 'block';

            if (buttons.length === 1) {
              var b = buttons[0];
              var linkHref = b.url + (b.type === 'telegram' ? '?start=site_' + visitorId : '');
              var iconSvg = '';
              var actionText = 'Перейти';

              if (b.type === 'telegram') {
                iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>';
              } else if (b.type === 'whatsapp') {
                actionText = 'Написать';
                iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19.01L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.34C9.36 7.34 9.09 7.4 8.87 7.65C8.65 7.89 8.02 8.49 8.02 9.71C8.02 10.93 8.91 12.11 9.03 12.27C9.15 12.44 10.74 14.98 13.23 15.96C15.3 16.77 15.72 16.61 16.17 16.57C16.62 16.53 17.62 15.98 17.83 15.4C18.04 14.81 18.04 14.31 17.98 14.21C17.92 14.1 17.76 14.04 17.51 13.92C17.27 13.79 16.07 13.2 15.85 13.12C15.63 13.04 15.46 13 15.3 13.25C15.13 13.49 14.66 14.04 14.52 14.21C14.38 14.37 14.24 14.4 14 14.27C13.75 14.15 12.96 13.89 12.03 13.06C11.3 12.41 10.81 11.61 10.67 11.36C10.53 11.12 10.65 10.99 10.78 10.86C10.89 10.75 11.03 10.57 11.16 10.42C11.28 10.27 11.32 10.16 11.41 9.99C11.49 9.83 11.45 9.68 11.39 9.56C11.33 9.44 10.83 8.21 10.62 7.71C10.42 7.22 10.21 7.29 10.06 7.28C9.92 7.27 9.75 7.27 9.58 7.27"/></svg>';
              } else if (b.type === 'max') {
                iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
              }

              msgContainer.innerHTML = '<div class="getvoxly-msg-banner-single is-' + b.type + '">' +
                '<div style="display:flex;align-items:center;gap:6px;min-width:0;">' +
                  iconSvg +
                  '<span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Продолжить в ' + b.label + '</span>' +
                '</div>' +
                '<a href="' + linkHref + '" target="_blank" rel="noopener noreferrer" class="getvoxly-msg-btn-pill btn-' + b.type + '">' +
                  actionText +
                '</a>' +
              '</div>';
            } else {
              var buttonsHtml = '';
              for (var j = 0; j < buttons.length; j++) {
                var btn = buttons[j];
                var href = btn.url + (btn.type === 'telegram' ? '?start=site_' + visitorId : '');
                var icon = '';
                if (btn.type === 'telegram') {
                  icon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>';
                } else if (btn.type === 'whatsapp') {
                  icon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19.01L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.34C9.36 7.34 9.09 7.4 8.87 7.65C8.65 7.89 8.02 8.49 8.02 9.71C8.02 10.93 8.91 12.11 9.03 12.27C9.15 12.44 10.74 14.98 13.23 15.96C15.3 16.77 15.72 16.61 16.17 16.57C16.62 16.53 17.62 15.98 17.83 15.4C18.04 14.81 18.04 14.31 17.98 14.21C17.92 14.1 17.76 14.04 17.51 13.92C17.27 13.79 16.07 13.2 15.85 13.12C15.63 13.04 15.46 13 15.3 13.25C15.13 13.49 14.66 14.04 14.52 14.21C14.38 14.37 14.24 14.4 14 14.27C13.75 14.15 12.96 13.89 12.03 13.06C11.3 12.41 10.81 11.61 10.67 11.36C10.53 11.12 10.65 10.99 10.78 10.86C10.89 10.75 11.03 10.57 11.16 10.42C11.28 10.27 11.32 10.16 11.41 9.99C11.49 9.83 11.45 9.68 11.39 9.56C11.33 9.44 10.83 8.21 10.62 7.71C10.42 7.22 10.21 7.29 10.06 7.28C9.92 7.27 9.75 7.27 9.58 7.27"/></svg>';
                } else if (btn.type === 'max') {
                  icon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
                }
                buttonsHtml += '<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="getvoxly-msg-btn-pill btn-' + btn.type + '">' + icon + ' ' + btn.label + '</a>';
              }

              msgContainer.innerHTML = '<div class="getvoxly-msg-bar-multi">' +
                '<span class="getvoxly-msg-bar-title">Продолжить в:</span>' +
                '<div class="getvoxly-msg-buttons-row">' +
                  buttonsHtml +
                '</div>' +
              '</div>';
            }
          } else if (msgContainer) {
            msgContainer.style.display = 'none';
          }
        } else {
          sendTelemetry('init_failed_status', res.status);
        }
      } catch (e) {
        sendTelemetry('init_exception', e && e.message);
        console.warn('[GetVoxly] Failed to init chat session', e);
      }
    }

    messageBuffer = [];
    sendTimer = null;

    function flushMessageBuffer() {
      if (messageBuffer.length === 0) return;
      var combinedText = messageBuffer.join('\n\n');
      messageBuffer = [];
      executeSendMessage(combinedText);
    }

    function handleUserSubmit() {
      var text = inputEl.value.trim();
      if (!text) return;

      inputEl.value = '';
      inputEl.style.height = '38px';
      lastDraft = '';

      saveAndRenderMessage(text, true);
      messageBuffer.push(text);

      clearTimeout(sendTimer);
      typingIndicator.style.display = 'block';
      sendTimer = setTimeout(flushMessageBuffer, 2500);
    }

    async function executeSendMessage(fullText, isDraft) {
      try {
        var payload = {
          visitorId: visitorId,
          text: fullText,
          pageUrl: window.location.href,
          utmTags: utmTags,
          ymUid: ymUid || undefined,
          gaId: gaId || undefined,
          visitCount: visitCount,
          pageHistory: pageHistory,
          isDraft: Boolean(isDraft),
        };

        var res = await fetch(apiUrl + '/api/v1/public/chat/message/' + channelAccountId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        typingIndicator.style.display = 'none';

        if (isDraft) return;

        if (res.ok) {
          var result = (await res.json()).data;
          if (result.replies && result.replies.length > 0) {
            for (var i = 0; i < result.replies.length; i++) {
              var replyText = result.replies[i];
              var typingDelay = Math.min(Math.max(replyText.length * 25, 700), 2200);

              typingIndicator.style.display = 'block';
              await new Promise(function (resolve) { setTimeout(resolve, typingDelay); });
              typingIndicator.style.display = 'none';

              saveAndRenderMessage(replyText, false);
            }
          } else if (result.status === 'operator_needed') {
            saveAndRenderMessage('Спасибо за обращение! Мы зафиксировали заявку в CRM. Специалист свяжется с вами в ближайшее время.', false);
          }
        } else {
          saveAndRenderMessage('Не удалось доставить сообщение. Пожалуйста, попробуйте еще раз позже.', false);
        }
      } catch (e) {
        typingIndicator.style.display = 'none';
        if (!isDraft) {
          saveAndRenderMessage('Ошибка связи с сервером. Проверьте интернет-соединение.', false);
        }
      }
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', handleUserSubmit);
    }

    lastDraft = '';
    sentDrafts = {};

    if (inputEl) {
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleUserSubmit();
        }
      });

      inputEl.addEventListener('input', function (e) {
        var current = e.target.value.trim();
        if (current === '' && lastDraft.length > 3 && !sentDrafts[lastDraft]) {
          sentDrafts[lastDraft] = true;
          executeSendMessage(lastDraft, true);
          lastDraft = '';
          return;
        }
        if (current.length > 3) {
          lastDraft = current;
        }
      });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', function () {
        if (lastDraft.length > 3 && !sentDrafts[lastDraft]) {
          sentDrafts[lastDraft] = true;
          var payload = JSON.stringify({
            visitorId: visitorId,
            text: lastDraft,
            pageUrl: window.location.href,
            utmTags: utmTags,
            ymUid: ymUid || undefined,
            gaId: gaId || undefined,
            visitCount: visitCount,
            pageHistory: pageHistory,
            isDraft: true,
          });

          if (navigator.sendBeacon) {
            navigator.sendBeacon(apiUrl + '/api/v1/public/chat/message/' + channelAccountId, new Blob([payload], { type: 'application/json' }));
          }
        }
      });
    }
  }

  // 6. Отказоустойчивый загрузчик (Bootloader)
  var bootAttempts = 0;
  function boot() {
    try {
      if (window.__getvoxly_mounted__ || document.getElementById('getvoxly-bubble')) {
        return;
      }

      var accountId = getChannelAccountId();
      if (!accountId) {
        bootAttempts++;
        if (bootAttempts < 50) {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
          } else {
            setTimeout(boot, 100);
          }
        } else {
          sendTelemetry('accountId_not_found', 'attempts_exhausted');
          console.warn('[GetVoxly] Webchat script is missing data-account-id or data-channel-id attribute.');
        }
        return;
      }

      if (!document.body) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', boot, { once: true });
        } else {
          setTimeout(boot, 30);
        }
        return;
      }

      window.__getvoxly_mounted__ = true;
      mount(accountId);
    } catch (err) {
      sendTelemetry('boot_exception', err && err.message);
      console.error('[GetVoxly] Boot error:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
