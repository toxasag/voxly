(function () {
  'use strict';

  // 1. Поиск скрипта подключения и параметров
  function findScriptElement() {
    if (document.currentScript) return document.currentScript;
    return (
      document.querySelector('script[data-account-id]') ||
      document.querySelector('script[data-channel-id]') ||
      document.querySelector('script[src*="widget.js"]')
    );
  }

  const currentScript = findScriptElement();
  const channelAccountId =
    (currentScript && (currentScript.getAttribute('data-account-id') || currentScript.getAttribute('data-channel-id'))) ||
    '';

  if (!channelAccountId) {
    console.warn('[GetVoxly] Webchat script is missing data-account-id or data-channel-id attribute.');
    return;
  }

  const apiUrl = (
    (currentScript && currentScript.getAttribute('data-api-url')) ||
    'https://api.getvoxly.ru'
  ).replace(/\/$/, '');
  const telegramBot = (currentScript && currentScript.getAttribute('data-telegram-bot')) || '';
  const proactiveEnabled = (currentScript && currentScript.getAttribute('data-proactive')) !== 'false';
  const proactiveDelay = parseInt((currentScript && currentScript.getAttribute('data-proactive-delay')) || '30000', 10);

  // 2. Вспомогательные функции для cookies и хранилища
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  const ymUid = getCookie('_ym_uid') || null;
  const gaId = getCookie('_ga') || null;

  // 3. Захват и вечное хранение UTM-меток в localStorage
  const STORAGE_KEY_UTM = 'getvoxly_utm_tags';
  let utmTags = {};
  try {
    utmTags = JSON.parse(localStorage.getItem(STORAGE_KEY_UTM) || '{}');
  } catch (e) {
    utmTags = {};
  }

  const searchParams = new URLSearchParams(window.location.search);
  const detectedUtm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (param) {
    if (searchParams.has(param)) {
      detectedUtm[param] = searchParams.get(param);
    }
  });

  if (Object.keys(detectedUtm).length > 0) {
    utmTags = Object.assign({}, utmTags, detectedUtm);
    try {
      localStorage.setItem(STORAGE_KEY_UTM, JSON.stringify(utmTags));
    } catch (e) {}
  }

  // 4. Идентификация посетителя
  const STORAGE_KEY_VISITOR = 'getvoxly_visitor_' + channelAccountId;
  let visitorId = localStorage.getItem(STORAGE_KEY_VISITOR) || '';
  if (!visitorId) {
    visitorId = ymUid ? 'ym_' + ymUid : 'usr_' + Math.random().toString(36).substring(2, 11);
    try {
      localStorage.setItem(STORAGE_KEY_VISITOR, visitorId);
    } catch (e) {}
  }

  // 5. Счётчик визитов и сессий
  const STORAGE_KEY_VISIT_COUNT = 'getvoxly_visit_count';
  let visitCount = parseInt(localStorage.getItem(STORAGE_KEY_VISIT_COUNT) || '0', 10);
  if (!sessionStorage.getItem('getvoxly_session_active')) {
    visitCount += 1;
    try {
      localStorage.setItem(STORAGE_KEY_VISIT_COUNT, String(visitCount));
      sessionStorage.setItem('getvoxly_session_active', 'true');
    } catch (e) {}
  }

  // 6. История переходов по страницам сайта (последние 10 страниц)
  const STORAGE_KEY_PAGE_HISTORY = 'getvoxly_page_history';
  let pageHistory = [];
  try {
    pageHistory = JSON.parse(sessionStorage.getItem(STORAGE_KEY_PAGE_HISTORY) || '[]');
  } catch (e) {
    pageHistory = [];
  }

  const currentUrl = window.location.href;
  const currentTime = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (pageHistory.length === 0 || pageHistory[pageHistory.length - 1].url !== currentUrl) {
    pageHistory.push({ step: pageHistory.length + 1, time: currentTime, url: currentUrl });
    if (pageHistory.length > 10) pageHistory.shift();
    try {
      sessionStorage.setItem(STORAGE_KEY_PAGE_HISTORY, JSON.stringify(pageHistory));
    } catch (e) {}
  }

  // 7. Стили виджета
  const styles = `
    .getvoxly-widget-wrapper {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .getvoxly-widget-wrapper.position-left {
      right: auto;
      left: 24px;
    }

    @keyframes getvoxlyPulse {
      0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5); }
      70% { transform: scale(1.04); box-shadow: 0 0 0 14px rgba(245, 158, 11, 0); }
      100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
    }

    .getvoxly-widget-bubble {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #f59e0b;
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.35);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      animation: getvoxlyPulse 2.4s infinite;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
    }
    .getvoxly-widget-bubble:hover {
      animation: none;
      transform: scale(1.06);
      box-shadow: 0 12px 30px rgba(245, 158, 11, 0.45);
    }
    .getvoxly-widget-bubble.is-photo {
      padding: 2px;
      overflow: visible;
      background: #ffffff;
      border: 2px solid #ffffff;
    }
    .getvoxly-bubble-photo-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
      display: block;
    }
    .getvoxly-bubble-dot {
      position: absolute;
      bottom: 1px;
      right: 1px;
      width: 14px;
      height: 14px;
      background: #10b981;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
    }
    .getvoxly-widget-bubble.is-mascot {
      background: transparent !important;
      box-shadow: none !important;
      animation: none !important;
      overflow: visible;
      width: 66px;
      height: 66px;
    }
    .getvoxly-mascot-wrap {
      width: 66px;
      height: 66px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      filter: drop-shadow(0 10px 22px rgba(0, 0, 0, 0.35));
      transition: transform 0.15s ease-out;
    }
    .getvoxly-mascot-wrap:hover {
      transform: scale(1.08);
    }
    .getvoxly-mascot-wrap.squashing {
      animation: getvoxly-squash 0.35s ease-out;
    }
    .getvoxly-mascot-sprite {
      width: 64px;
      height: 64px;
      background-repeat: no-repeat;
      background-size: 300% 300%;
      background-position: 50% 50%;
      image-rendering: -webkit-optimize-contrast;
      user-select: none;
      -webkit-user-drag: none;
      pointer-events: none;
      transition: background-position 0.05s ease-out;
    }
    @keyframes getvoxly-squash {
      0% { transform: scale(1, 1); }
      30% { transform: scale(1.18, 0.82); }
      60% { transform: scale(0.92, 1.08); }
      100% { transform: scale(1, 1); }
    }

    .getvoxly-chat-badge {
      position: absolute;
      right: 74px;
      top: 50%;
      transform: translateY(-50%);
      background: #f59e0b;
      color: #020617;
      padding: 7px 14px;
      font-size: 13px;
      border-radius: 10px;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      pointer-events: auto;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: opacity 0.25s, transform 0.25s;
    }
    .position-left .getvoxly-chat-badge {
      right: auto;
      left: 74px;
    }
    .getvoxly-chat-badge::after {
      content: '';
      position: absolute;
      top: 50%;
      right: -6px;
      transform: translateY(-50%);
      border-width: 6px 0 6px 6px;
      border-style: solid;
      border-color: transparent transparent transparent #f59e0b;
    }
    .position-left .getvoxly-chat-badge::after {
      right: auto;
      left: -6px;
      border-width: 6px 6px 6px 0;
      border-color: transparent #f59e0b transparent transparent;
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
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f1f5f9;
      animation: getvoxlySlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .position-left .getvoxly-widget-window {
      right: auto;
      left: 24px;
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
    .getvoxly-messenger-container {
      font-size: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      overflow: hidden;
    }
    .getvoxly-widget-window.light .getvoxly-messenger-container {
      border-bottom: 1px solid #e5e5e5;
    }
    .getvoxly-msg-banner-single {
      padding: 8px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      text-decoration: none;
    }
    .getvoxly-msg-banner-single.is-telegram {
      background: #0284c718;
      color: #38bdf8;
    }
    .getvoxly-widget-window.light .getvoxly-msg-banner-single.is-telegram {
      background: #f0f9ff;
      color: #0369a1;
    }
    .getvoxly-msg-banner-single.is-whatsapp {
      background: #16a34a18;
      color: #4ade80;
    }
    .getvoxly-widget-window.light .getvoxly-msg-banner-single.is-whatsapp {
      background: #f0fdf4;
      color: #15803d;
    }
    .getvoxly-msg-banner-single.is-max {
      background: #6366f118;
      color: #818cf8;
    }
    .getvoxly-widget-window.light .getvoxly-msg-banner-single.is-max {
      background: #eef2ff;
      color: #4338ca;
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
    .getvoxly-widget-window.light .getvoxly-msg-bar-multi {
      background: #f8fafc;
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
      background: #f59e0b;
      color: #020617;
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

  // 8. Безопасное монтирование виджета в DOM
  function mount() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
      } else {
        window.addEventListener('load', mount, { once: true });
      }
      return;
    }

    if (document.getElementById('getvoxly-bubble')) {
      return;
    }

    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    (document.head || document.body).appendChild(styleEl);

    // Создание DOM-структуры виджета
    const wrapper = document.createElement('div');
  wrapper.className = 'getvoxly-widget-wrapper';
  wrapper.innerHTML = `
    <div class="getvoxly-chat-badge" id="getvoxly-badge">Задайте вопрос</div>
    <div class="getvoxly-widget-bubble" id="getvoxly-bubble">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#020617" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
      </svg>
    </div>
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

  const bubble = wrapper.querySelector('#getvoxly-bubble');
  const badge = wrapper.querySelector('#getvoxly-badge');
  const messagesContainer = win.querySelector('#getvoxly-messages');
  const inputEl = win.querySelector('#getvoxly-input');
  const sendBtn = win.querySelector('#getvoxly-send');
  const closeBtn = win.querySelector('#getvoxly-close');
  const typingIndicator = win.querySelector('#getvoxly-typing');
  const botTitle = win.querySelector('#getvoxly-bot-title');
  const msgContainer = win.querySelector('#getvoxly-messenger-container');

  // 9. Локальная история переписки
  const STORAGE_KEY_CHAT_HISTORY = 'getvoxly_chat_history_' + channelAccountId;
  function getLocalHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_CHAT_HISTORY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function appendMessageToUI(text, isUser) {
    const el = document.createElement('div');
    el.className = 'getvoxly-msg ' + (isUser ? 'getvoxly-msg-user' : 'getvoxly-msg-bot');
    el.textContent = text;
    messagesContainer.appendChild(el);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function saveAndRenderMessage(text, isUser) {
    appendMessageToUI(text, isUser);
    const hist = getLocalHistory();
    hist.push({ text: text, isUser: isUser, timestamp: Date.now() });
    try {
      localStorage.setItem(STORAGE_KEY_CHAT_HISTORY, JSON.stringify(hist));
    } catch (e) {}
  }

  // Восстановление истории сообщений
  const existingHistory = getLocalHistory();
  if (existingHistory.length > 0) {
    existingHistory.forEach(function (m) {
      appendMessageToUI(m.text, m.isUser);
    });
  }

  // 10. Переключение окна виджета
  let isOpen = false;
  function openWidget() {
    isOpen = true;
    win.style.display = 'flex';
    badge.style.display = 'none';
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    inputEl.focus();
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

  bubble.addEventListener('click', toggleWidget);
  badge.addEventListener('click', openWidget);
  closeBtn.addEventListener('click', closeWidget);

  // Фоновая загрузка параметров оформления (цвета, аватар/маскот, позиция)
  initSession();

  // 11. Проактивное открытие через заданный интервал
  if (proactiveEnabled && existingHistory.length === 0) {
    setTimeout(function () {
      if (!isOpen && getLocalHistory().length === 0) {
        openWidget();
      }
    }, proactiveDelay);
  }

  // 12. Инициализация сессии на сервере (загрузка настроек аккаунта)
  let sessionInitialized = false;
  async function initSession() {
    if (sessionInitialized) return;
    try {
      const res = await fetch(apiUrl + '/api/v1/public/chat/init/' + channelAccountId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: visitorId || undefined }),
      });

      if (res.ok) {
        sessionInitialized = true;
        const data = (await res.json()).data;
        if (data.visitorId) {
          visitorId = data.visitorId;
          try {
            localStorage.setItem(STORAGE_KEY_VISITOR, visitorId);
          } catch (e) {}
        }

        botTitle.textContent = data.title || (data.tenantName + ' (' + data.botName + ')');

        if (data.accentColor) {
          bubble.style.background = data.accentColor;
          bubble.style.boxShadow = '0 8px 24px ' + data.accentColor + '55';
          sendBtn.style.background = data.accentColor;
          badge.style.background = data.accentColor;
        }

        // Поддержка 3D-маскота или фото консультанта
        if (data.avatarType === 'mascot' || (!data.avatarType && (data.customMascotDirections || data.mascotId === 'custom'))) {
          bubble.classList.add('is-mascot');

          let assetBaseUrl = 'https://getvoxly.ru';

          const MASCOT_MAP = {
            voxly_robot: 'drone',
            friendly_fox: 'fox',
            smart_cat: 'cat',
            cyber_owl: 'scout',
            happy_alien: 'crt',
            friendly_panda: 'otter',
            tech_ninja: 'kamran',
          };

          let resolvedId = data.mascotId || 'drone';
          if (MASCOT_MAP[resolvedId]) {
            resolvedId = MASCOT_MAP[resolvedId];
          }

          let directionsUrl = assetBaseUrl + '/mascots/' + resolvedId + '-directions.webp';
          let reactionsUrl = assetBaseUrl + '/mascots/' + resolvedId + '-reactions.webp';

          if (resolvedId === 'custom' || data.customMascotDirections) {
            directionsUrl = data.customMascotDirections || directionsUrl;
            reactionsUrl = data.customMascotReactions || data.customMascotDirections || directionsUrl;
          }

          bubble.innerHTML = `
            <div class="getvoxly-mascot-wrap" id="getvoxly-mascot-el">
              <div class="getvoxly-mascot-sprite" id="getvoxly-mascot-sprite" style="background-image: url('${directionsUrl}');"></div>
              <span class="getvoxly-bubble-dot"></span>
            </div>
          `;

          const mascotEl = bubble.querySelector('#getvoxly-mascot-el');
          const spriteEl = bubble.querySelector('#getvoxly-mascot-sprite');

          // Preload reactions
          const preloadImg = new Image();
          preloadImg.src = reactionsUrl;

          let isBooped = false;
          let boopTimer = null;

          function setMascotCell(row, col) {
            if (!spriteEl) return;
            const x = col === 0 ? '0%' : col === 1 ? '50%' : '100%';
            const y = row === 0 ? '0%' : row === 1 ? '50%' : '100%';
            spriteEl.style.backgroundPosition = x + ' ' + y;
          }

          // Трекинг курсора мыши (9 направлений взгляда)
          if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && spriteEl) {
            window.addEventListener('pointermove', function (e) {
              if (isBooped) return;
              const b = bubble.getBoundingClientRect();
              const cx = b.left + b.width / 2;
              const cy = b.top + b.height / 2;
              const dx = e.clientX - cx;
              const dy = e.clientY - cy;
              const dist = Math.hypot(dx, dy);

              if (dist < 35) {
                setMascotCell(1, 1);
                return;
              }

              const angle = Math.atan2(dy, dx) * (180 / Math.PI);
              if (angle >= -22.5 && angle < 22.5) {
                setMascotCell(1, 2); // right
              } else if (angle >= 22.5 && angle < 67.5) {
                setMascotCell(2, 2); // down-right
              } else if (angle >= 67.5 && angle < 112.5) {
                setMascotCell(2, 1); // down
              } else if (angle >= 112.5 && angle < 157.5) {
                setMascotCell(2, 0); // down-left
              } else if (angle >= 157.5 || angle < -157.5) {
                setMascotCell(1, 0); // left
              } else if (angle >= -157.5 && angle < -112.5) {
                setMascotCell(0, 0); // up-left
              } else if (angle >= -112.5 && angle < -67.5) {
                setMascotCell(0, 1); // up
              } else if (angle >= -67.5 && angle < -22.5) {
                setMascotCell(0, 2); // up-right
              }
            }, { passive: true });
          }

          // Реакция boop при клике
          bubble.addEventListener('pointerdown', function () {
            if (!spriteEl) return;
            isBooped = true;
            spriteEl.style.backgroundImage = "url('" + reactionsUrl + "')";
            setMascotCell(1, 1);
            if (mascotEl) mascotEl.classList.add('squashing');

            clearTimeout(boopTimer);
            boopTimer = setTimeout(function () {
              isBooped = false;
              spriteEl.style.backgroundImage = "url('" + directionsUrl + "')";
              if (mascotEl) mascotEl.classList.remove('squashing');
              setMascotCell(1, 1);
            }, 600);
          });
        } else if (data.avatarType === 'photo' && data.consultantAvatar) {
          bubble.classList.add('is-photo');
          bubble.innerHTML = '<img class="getvoxly-bubble-photo-img" src="' + data.consultantAvatar + '" alt="Консультант"><span class="getvoxly-bubble-dot"></span>';
        }

        if (data.position === 'bottom-left') {
          wrapper.classList.add('position-left');
          win.classList.add('position-left');
        }

        if (data.placeholder) {
          inputEl.placeholder = data.placeholder;
        }

        // Если в истории ещё нет сообщений, показываем приветствие
        if (messagesContainer.children.length === 0 && data.greeting) {
          saveAndRenderMessage(data.greeting, false);
        }

        // Баннер перехода в мессенджеры (Telegram, WhatsApp, MAX)
        const buttons = data.messengerButtons || [];

        // Обратная совместимость для устаревших вызовов
        if (buttons.length === 0 && (telegramBot || data.telegramBot) && data.showTelegramBanner !== false) {
          const tb = (telegramBot || data.telegramBot).replace(/^@/, '');
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
            const b = buttons[0];
            const linkHref = b.url + (b.type === 'telegram' ? '?start=site_' + visitorId : '');
            let iconSvg = '';
            let actionText = 'Перейти';

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
            let buttonsHtml = '';
            for (let i = 0; i < buttons.length; i++) {
              const btn = buttons[i];
              const href = btn.url + (btn.type === 'telegram' ? '?start=site_' + visitorId : '');
              let icon = '';
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
      }
    } catch (e) {
      console.warn('[GetVoxly] Failed to init chat session', e);
    }
  }

  // 13. Умная склейка сообщений (Message Buffer / Debounce)
  let messageBuffer = [];
  let sendTimer = null;

  function flushMessageBuffer() {
    if (messageBuffer.length === 0) return;
    const combinedText = messageBuffer.join('\n\n');
    messageBuffer = [];

    executeSendMessage(combinedText);
  }

  function handleUserSubmit() {
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    inputEl.style.height = '38px';
    lastDraft = '';

    // Сразу отрисовываем и сохраняем локально, чтобы посетитель видел своё сообщение
    saveAndRenderMessage(text, true);
    messageBuffer.push(text);

    // Сбрасываем предыдущий таймер отправки
    clearTimeout(sendTimer);
    typingIndicator.style.display = 'block';

    // Буфер на 2.5 секунды: склеивает быстрые сообщения пользователя в одну реплику для AI
    sendTimer = setTimeout(flushMessageBuffer, 2500);
  }

  // 14. Отправка на бэкенд и имитация чтения/печати AI
  async function executeSendMessage(fullText, isDraft) {
    try {
      const payload = {
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

      const res = await fetch(apiUrl + '/api/v1/public/chat/message/' + channelAccountId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      typingIndicator.style.display = 'none';

      if (isDraft) {
        return; // Черновик отправлен тихо, автоответ не ожидается
      }

      if (res.ok) {
        const result = (await res.json()).data;
        if (result.replies && result.replies.length > 0) {
          for (let i = 0; i < result.replies.length; i++) {
            const replyText = result.replies[i];
            const typingDelay = Math.min(Math.max(replyText.length * 25, 700), 2200);

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

  sendBtn.addEventListener('click', handleUserSubmit);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleUserSubmit();
    }
  });

  // 15. Перехват брошенных черновиков (Lead Salvage)
  let lastDraft = '';
  let sentDrafts = {};

  inputEl.addEventListener('input', function (e) {
    const current = e.target.value.trim();
    // Если посетитель набрал текст > 3 символов и полностью стёр — тихо отправляем стёртый черновик
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

  // Отправка черновика при закрытии или перезагрузке страницы
  window.addEventListener('beforeunload', function () {
    if (lastDraft.length > 3 && !sentDrafts[lastDraft]) {
      sentDrafts[lastDraft] = true;
      const payload = JSON.stringify({
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

  // 16. Запуск монтирования виджета
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
