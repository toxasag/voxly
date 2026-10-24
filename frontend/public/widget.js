(function () {
  'use strict';

  // 1. Вспомогательная функция телеметрии для диагностики в реальном времени
  function sendTelemetry(step, detail) {
    try {
      var d = detail ? '&d=' + encodeURIComponent(String(detail).slice(0, 200)) : '';
      var url = 'https://api.getvoxly.ru/api/v1/public/chat/debug?step=' + encodeURIComponent(step) + d + '&t=' + Date.now();
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(url);
      } else {
        var img = new Image();
        if (typeof window !== 'undefined') {
          window._gvx_imgs = window._gvx_imgs || [];
          window._gvx_imgs.push(img);
        }
        img.src = url;
      }
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
    try {
      var s1 = document.querySelector('script[data-account-id]');
      if (s1) {
        var id1 = s1.getAttribute('data-account-id');
        if (id1 && id1.trim()) return id1.trim();
      }
    } catch (e) {}

    try {
      var s2 = document.querySelector('script[data-channel-id]');
      if (s2) {
        var id2 = s2.getAttribute('data-channel-id');
        if (id2 && id2.trim()) return id2.trim();
      }
    } catch (e) {}

    try {
      if (document.currentScript) {
        var idCur =
          document.currentScript.getAttribute('data-account-id') ||
          document.currentScript.getAttribute('data-channel-id');
        if (idCur && idCur.trim()) return idCur.trim();
      }
    } catch (e) {}

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

  // 4. Стили виджета с поддержкой тем (Twenty Light Canvas по умолчанию), мобильных устройств и safe-area
  var styles = `
    .getvoxly-widget-wrapper {
      position: fixed !important;
      bottom: 20px !important;
      bottom: calc(20px + env(safe-area-inset-bottom, 0px)) !important;
      right: 20px !important;
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
      --accent-color: #6366F1;
      --badge-color: #6366F1;
    }
    .getvoxly-widget-wrapper.position-left {
      right: auto !important;
      left: 20px !important;
      left: calc(20px + env(safe-area-inset-left, 0px)) !important;
    }
    .getvoxly-widget-wrapper * {
      box-sizing: border-box !important;
    }

    @keyframes getvoxlyPulse {
      0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.45); }
      70% { transform: scale(1.04); box-shadow: 0 0 0 14px rgba(99, 102, 241, 0); }
      100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
    }

    .getvoxly-widget-bubble {
      width: 60px !important;
      height: 60px !important;
      min-width: 60px !important;
      min-height: 60px !important;
      border-radius: 50% !important;
      background: var(--accent-color, #6366F1) !important;
      box-shadow: 0 8px 24px rgba(99, 102, 241, 0.35) !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: relative !important;
      animation: getvoxlyPulse 2.4s infinite !important;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s, background 0.2s !important;
      user-select: none !important;
      border: none !important;
      outline: none !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .getvoxly-widget-bubble:hover {
      animation: none !important;
      transform: scale(1.06) !important;
      box-shadow: 0 12px 30px rgba(99, 102, 241, 0.45) !important;
    }
    .getvoxly-bubble-icon {
      display: flex !important;
      width: 100% !important;
      height: 100% !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .getvoxly-bubble-close-icon {
      display: none !important;
      width: 100% !important;
      height: 100% !important;
      align-items: center !important;
      justify-content: center !important;
      color: #ffffff !important;
    }

    /* Когда чат открыт: кнопка превращается в аккуратную круглую кнопку-крестик, бейдж скрыт */
    .getvoxly-widget-wrapper.is-chat-open .getvoxly-widget-bubble {
      width: 56px !important;
      height: 56px !important;
      min-width: 56px !important;
      min-height: 56px !important;
      border-radius: 50% !important;
      background: var(--accent-color, #6366F1) !important;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25) !important;
      animation: none !important;
    }
    .getvoxly-widget-wrapper.is-chat-open .getvoxly-bubble-icon {
      display: none !important;
    }
    .getvoxly-widget-wrapper.is-chat-open .getvoxly-bubble-close-icon {
      display: flex !important;
    }
    .getvoxly-widget-wrapper.is-chat-open .getvoxly-chat-badge {
      display: none !important;
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
      background-position: 50% 50%;
      background-color: rgba(99, 102, 241, 0.12) !important;
      image-rendering: -webkit-optimize-contrast !important;
      user-select: none !important;
      -webkit-user-drag: none !important;
      pointer-events: none !important;
      border-radius: 50% !important;
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
      background: var(--badge-color, #6366F1) !important;
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
      transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
      line-height: 1.3 !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .getvoxly-chat-badge.is-animating {
      opacity: 0 !important;
      transform: translateY(-68%) scale(0.92) !important;
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
      border-color: transparent transparent transparent var(--badge-color, #6366F1) !important;
    }
    .position-left .getvoxly-chat-badge::after {
      right: auto !important;
      left: -6px !important;
      border-width: 6px 6px 6px 0 !important;
      border-color: transparent var(--badge-color, #6366F1) transparent transparent !important;
    }

    /* Окно диалога (Светлая тема по умолчанию Twenty Light Canvas) */
    .getvoxly-widget-window {
      position: fixed !important;
      bottom: calc(88px + env(safe-area-inset-bottom, 0px)) !important;
      right: calc(20px + env(safe-area-inset-right, 0px)) !important;
      width: 380px !important;
      max-width: calc(100vw - 32px) !important;
      height: 580px !important;
      max-height: calc(100vh - 120px) !important;
      background: #ffffff !important;
      color: #111111 !important;
      border-radius: 16px !important;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.18) !important;
      border: 1px solid #e5e5e5 !important;
      display: none;
      flex-direction: column !important;
      overflow: hidden !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      box-sizing: border-box !important;
      direction: ltr !important;
      --accent-color: #6366F1;
    }
    .getvoxly-widget-window * {
      box-sizing: border-box !important;
    }
    .getvoxly-widget-window.position-left {
      right: auto !important;
      left: calc(20px + env(safe-area-inset-left, 0px)) !important;
    }
    .getvoxly-widget-window.is-expanded {
      width: 680px !important;
      max-width: calc(100vw - 40px) !important;
      height: 720px !important;
      max-height: calc(100vh - 100px) !important;
    }

    /* Тёмная тема (если явно задана в настройках) */
    .getvoxly-widget-window.is-dark-theme {
      background: #111111 !important;
      color: #f8fafc !important;
      border-color: #27272a !important;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.45) !important;
    }

    @media (max-width: 640px) {
      .getvoxly-header-expand {
        display: none !important;
      }
      .getvoxly-chat-badge {
        display: none !important;
      }
      /* На мобильных при открытом чате скрываем плавающую круглую кнопку вызова */
      .getvoxly-widget-wrapper.is-chat-open {
        display: none !important;
      }
      .getvoxly-widget-window {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        max-width: 100vw !important;
        height: 100% !important;
        height: 100dvh !important;
        max-height: 100% !important;
        max-height: 100dvh !important;
        border-radius: 0 !important;
        border: none !important;
        box-shadow: none !important;
        margin: 0 !important;
      }
      .getvoxly-header {
        border-radius: 0 !important;
        padding-top: calc(12px + env(safe-area-inset-top, 0px)) !important;
        padding-bottom: 12px !important;
        padding-left: calc(14px + env(safe-area-inset-left, 0px)) !important;
        padding-right: calc(14px + env(safe-area-inset-right, 0px)) !important;
      }
      .getvoxly-header-close {
        width: 36px !important;
        height: 36px !important;
        padding: 0 !important;
        background: rgba(0, 0, 0, 0.15) !important;
        border-radius: 8px !important;
      }
      .getvoxly-messages {
        padding: 12px !important;
      }
      .getvoxly-textarea {
        font-size: 16px !important; /* Предотвращает нежелательный зум страницы в iOS Safari */
      }
      .getvoxly-input-area {
        padding-left: calc(12px + env(safe-area-inset-left, 0px)) !important;
        padding-right: calc(12px + env(safe-area-inset-right, 0px)) !important;
      }
      .getvoxly-consent {
        padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)) !important;
      }
    }

    /* Шапка виджета: цвет акцента, аватар консультанта, статус онлайн и крестик */
    .getvoxly-header {
      background: var(--accent-color, #6366F1) !important;
      color: #ffffff !important;
      padding: 12px 14px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12) !important;
      flex-shrink: 0 !important;
    }
    .getvoxly-header-left {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      min-width: 0 !important;
      flex: 1 !important;
    }
    .getvoxly-header-avatar {
      width: 36px !important;
      height: 36px !important;
      border-radius: 50% !important;
      background: rgba(0, 0, 0, 0.15) !important;
      position: relative !important;
      flex-shrink: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      overflow: visible !important;
    }
    .getvoxly-header-avatar-inner {
      width: 36px !important;
      height: 36px !important;
      border-radius: 50% !important;
      overflow: hidden !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .getvoxly-header-status-dot {
      position: absolute !important;
      right: -1px !important;
      bottom: -1px !important;
      width: 10px !important;
      height: 10px !important;
      border-radius: 50% !important;
      background: #10b981 !important;
      border: 2px solid #ffffff !important;
      z-index: 3 !important;
    }
    .getvoxly-header-info {
      min-width: 0 !important;
      flex: 1 !important;
    }
    .getvoxly-header-name {
      font-size: 13px !important;
      font-weight: 700 !important;
      line-height: 1.25 !important;
      color: #ffffff !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .getvoxly-header-sub {
      font-size: 11px !important;
      font-weight: 500 !important;
      opacity: 0.85 !important;
      line-height: 1.2 !important;
      color: #ffffff !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .getvoxly-header-actions {
      display: flex !important;
      align-items: center !important;
      gap: 2px !important;
      flex-shrink: 0 !important;
    }
    .getvoxly-header-btn {
      background: transparent !important;
      border: none !important;
      color: #ffffff !important;
      cursor: pointer !important;
      padding: 6px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 6px !important;
      transition: background 0.15s !important;
      flex-shrink: 0 !important;
      line-height: 1 !important;
    }
    .getvoxly-header-btn:hover {
      background: rgba(0, 0, 0, 0.15) !important;
    }
    .getvoxly-header-close {
      background: transparent !important;
      border: none !important;
      color: #ffffff !important;
      cursor: pointer !important;
      padding: 6px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 50% !important;
      transition: background 0.15s !important;
      flex-shrink: 0 !important;
      line-height: 1 !important;
    }
    .getvoxly-header-close:hover {
      background: rgba(0, 0, 0, 0.15) !important;
    }

    /* Баннер перехода в мессенджеры */
    .getvoxly-messenger-container {
      border-bottom: 1px solid #e5e5e5 !important;
      flex-shrink: 0 !important;
    }
    .is-dark-theme .getvoxly-messenger-container {
      border-bottom-color: #27272a !important;
    }

    .getvoxly-msg-banner-single {
      padding: 8px 14px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 10px !important;
      font-size: 12px !important;
      text-decoration: none !important;
      cursor: pointer !important;
      transition: opacity 0.15s, background 0.15s !important;
    }
    .getvoxly-msg-banner-single:hover {
      opacity: 0.9 !important;
    }
    .getvoxly-msg-banner-single.is-telegram {
      background: rgba(2, 132, 199, 0.08) !important;
      border-bottom: 1px solid rgba(2, 132, 199, 0.2) !important;
      color: #0284c7 !important;
    }
    .getvoxly-msg-banner-single.is-whatsapp {
      background: rgba(22, 163, 74, 0.08) !important;
      border-bottom: 1px solid rgba(22, 163, 74, 0.2) !important;
      color: #15803d !important;
    }
    .getvoxly-msg-banner-single.is-max {
      background: rgba(99, 102, 241, 0.08) !important;
      border-bottom: 1px solid rgba(99, 102, 241, 0.2) !important;
      color: #4f46e5 !important;
    }
    .getvoxly-msg-banner-left {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      min-width: 0 !important;
    }
    .getvoxly-msg-banner-title {
      font-weight: 600 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .getvoxly-msg-banner-action {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      padding: 3px 9px !important;
      border-radius: 4px !important;
      white-space: nowrap !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 3px !important;
      color: #ffffff !important;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
      letter-spacing: 0.01em !important;
    }
    .getvoxly-msg-banner-single.is-telegram .getvoxly-msg-banner-action { background: #0284c7 !important; }
    .getvoxly-msg-banner-single.is-whatsapp .getvoxly-msg-banner-action { background: #16a34a !important; }
    .getvoxly-msg-banner-single.is-max .getvoxly-msg-banner-action { background: #6366f1 !important; }

    .getvoxly-msg-bar-multi {
      padding: 7px 12px !important;
      background: #fafafa !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 6px !important;
    }
    .is-dark-theme .getvoxly-msg-bar-multi {
      background: #18181b !important;
    }
    .getvoxly-msg-bar-title {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #888888 !important;
      white-space: nowrap !important;
      flex-shrink: 0 !important;
    }
    .getvoxly-msg-buttons-row {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      flex-wrap: wrap !important;
      justify-content: flex-end !important;
    }
    .getvoxly-msg-btn-pill {
      color: #ffffff !important;
      padding: 3px 8px !important;
      border-radius: 4px !important;
      font-weight: 500 !important;
      font-size: 10px !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      text-decoration: none !important;
      cursor: pointer !important;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
      transition: transform 0.1s ease, opacity 0.1s ease !important;
    }
    .getvoxly-msg-btn-pill:hover {
      transform: scale(1.04) !important;
      opacity: 0.95 !important;
    }
    .getvoxly-msg-btn-pill.btn-telegram { background: #0284c7 !important; }
    .getvoxly-msg-btn-pill.btn-whatsapp { background: #16a34a !important; }
    .getvoxly-msg-btn-pill.btn-max { background: #6366f1 !important; }

    /* Область сообщений */
    .getvoxly-messages {
      flex: 1 1 0% !important;
      min-height: 0 !important;
      padding: 14px !important;
      overflow-y: auto !important;
      -webkit-overflow-scrolling: touch !important;
      overscroll-behavior: contain !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      background: #ffffff !important;
    }
    .is-dark-theme .getvoxly-messages {
      background: #111111 !important;
    }

    .getvoxly-msg-row {
      display: flex !important;
      width: 100% !important;
    }
    .getvoxly-msg-row-bot {
      align-items: flex-start !important;
      gap: 8px !important;
      max-width: 90% !important;
    }
    .getvoxly-msg-row-user {
      justify-content: flex-end !important;
      align-self: flex-end !important;
      max-width: 82% !important;
    }
    .getvoxly-msg-bot-avatar {
      width: 28px !important;
      height: 28px !important;
      border-radius: 50% !important;
      background: var(--accent-color, #6366F1) !important;
      flex-shrink: 0 !important;
      overflow: hidden !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      margin-top: 2px !important;
      color: #ffffff !important;
    }
    .getvoxly-msg-bot-content {
      flex: 1 !important;
      min-width: 0 !important;
    }
    .getvoxly-msg-bot-author {
      font-size: 10px !important;
      font-weight: 600 !important;
      color: #888888 !important;
      margin-bottom: 2px !important;
    }

    .getvoxly-msg {
      padding: 10px 14px !important;
      font-size: 13px !important;
      line-height: 1.45 !important;
      word-break: break-word !important;
    }
    .getvoxly-msg-bot {
      background: #f5f5f5 !important;
      color: #111111 !important;
      border: 1px solid #e5e5e5 !important;
      border-radius: 16px !important;
      border-top-left-radius: 4px !important;
    }
    .is-dark-theme .getvoxly-msg-bot {
      background: #18181b !important;
      color: #e4e4e7 !important;
      border-color: #27272a !important;
    }
    .getvoxly-msg-user {
      background: var(--accent-color, #6366F1) !important;
      color: #ffffff !important;
      font-weight: 500 !important;
      border-radius: 16px !important;
      border-top-right-radius: 4px !important;
    }

    /* Прикрепление файлов и превью */
    .getvoxly-attach-btn {
      background: transparent !important;
      border: none !important;
      color: #888888 !important;
      cursor: pointer !important;
      padding: 4px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 6px !important;
      transition: color 0.15s, background 0.15s !important;
      flex-shrink: 0 !important;
      line-height: 1 !important;
    }
    .getvoxly-attach-btn:hover {
      color: var(--accent-color, #4a38f5) !important;
      background: rgba(0, 0, 0, 0.04) !important;
    }
    .is-dark-theme .getvoxly-attach-btn:hover {
      background: rgba(255, 255, 255, 0.08) !important;
      color: #ffffff !important;
    }
    .getvoxly-attachment-preview {
      margin-bottom: 8px !important;
    }
    .getvoxly-preview-card {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 6px 10px !important;
      background: #ffffff !important;
      border: 1px solid #e5e5e5 !important;
      border-radius: 8px !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
    }
    .is-dark-theme .getvoxly-preview-card {
      background: #18181b !important;
      border-color: #27272a !important;
    }
    .getvoxly-preview-thumb {
      width: 32px !important;
      height: 32px !important;
      border-radius: 4px !important;
      object-fit: cover !important;
      flex-shrink: 0 !important;
      background: #f5f5f5 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      color: #666666 !important;
      overflow: hidden !important;
    }
    .getvoxly-preview-info {
      flex: 1 !important;
      min-width: 0 !important;
    }
    .getvoxly-preview-name {
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #111111 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      line-height: 1.3 !important;
    }
    .is-dark-theme .getvoxly-preview-name {
      color: #f1f5f9 !important;
    }
    .getvoxly-preview-size {
      font-size: 10px !important;
      color: #888888 !important;
    }
    .getvoxly-preview-remove {
      background: transparent !important;
      border: none !important;
      color: #888888 !important;
      cursor: pointer !important;
      padding: 4px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 4px !important;
      flex-shrink: 0 !important;
    }
    .getvoxly-preview-remove:hover {
      color: #e11d48 !important;
      background: rgba(225, 29, 72, 0.08) !important;
    }

    /* Отображение вложений в сообщении */
    .getvoxly-msg-attachment {
      margin-bottom: 6px !important;
    }
    .getvoxly-msg-img {
      max-width: 100% !important;
      max-height: 220px !important;
      border-radius: 10px !important;
      display: block !important;
      cursor: pointer !important;
      transition: opacity 0.15s !important;
    }
    .getvoxly-msg-img:hover {
      opacity: 0.95 !important;
    }
    .getvoxly-msg-video {
      max-width: 100% !important;
      max-height: 240px !important;
      border-radius: 10px !important;
      display: block !important;
    }
    .getvoxly-msg-file-link {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 6px 10px !important;
      background: rgba(0, 0, 0, 0.06) !important;
      border-radius: 8px !important;
      text-decoration: none !important;
      color: inherit !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      word-break: break-all !important;
    }
    .getvoxly-msg-user .getvoxly-msg-file-link {
      background: rgba(255, 255, 255, 0.2) !important;
      color: #ffffff !important;
    }

    /* Inline Attach Gate */
    .getvoxly-attach-gate {
      padding: 8px 10px !important;
      margin-bottom: 8px !important;
      background: #ffffff !important;
      border: 1px solid #e5e5e5 !important;
      border-radius: 10px !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05) !important;
    }
    .is-dark-theme .getvoxly-attach-gate {
      background: #18181b !important;
      border-color: #27272a !important;
      color: #f1f5f9 !important;
    }
    .getvoxly-attach-gate-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      margin-bottom: 6px !important;
    }
    .getvoxly-attach-gate-text {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      font-size: 11.5px !important;
      font-weight: 600 !important;
      color: #334155 !important;
    }
    .is-dark-theme .getvoxly-attach-gate-text {
      color: #cbd5e1 !important;
    }
    .getvoxly-attach-gate-text svg {
      color: var(--accent-color, #4a38f5) !important;
      flex-shrink: 0 !important;
    }
    .getvoxly-attach-cancel-btn {
      width: 20px !important;
      height: 20px !important;
      background: transparent !important;
      border: none !important;
      color: #888888 !important;
      cursor: pointer !important;
      border-radius: 4px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      padding: 0 !important;
      transition: color 0.15s, background-color 0.15s !important;
    }
    .getvoxly-attach-cancel-btn:hover {
      color: #111111 !important;
      background: #f1f5f9 !important;
    }
    .is-dark-theme .getvoxly-attach-cancel-btn:hover {
      color: #ffffff !important;
      background: #27272a !important;
    }
    .getvoxly-attach-gate-row {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
    }
    .getvoxly-attach-phone-input {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      height: 32px !important;
      padding: 0 10px !important;
      font-size: 12.5px !important;
      border: 1px solid #e5e5e5 !important;
      border-radius: 6px !important;
      background: #ffffff !important;
      color: #111111 !important;
      outline: none !important;
      transition: border-color 0.15s, box-shadow 0.15s !important;
    }
    .is-dark-theme .getvoxly-attach-phone-input {
      background: #111111 !important;
      border-color: #27272a !important;
      color: #f1f5f9 !important;
    }
    .getvoxly-attach-phone-input:focus {
      border-color: var(--accent-color, #4a38f5) !important;
      box-shadow: 0 0 0 2px rgba(74, 56, 245, 0.15) !important;
    }
    .getvoxly-attach-submit-btn {
      height: 32px !important;
      padding: 0 12px !important;
      background: var(--accent-color, #4a38f5) !important;
      color: #ffffff !important;
      border: none !important;
      border-radius: 6px !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      flex-shrink: 0 !important;
      transition: opacity 0.15s !important;
    }
    .getvoxly-attach-submit-btn:hover {
      opacity: 0.92 !important;
    }
    .getvoxly-attach-gate-error {
      margin-top: 5px !important;
      font-size: 11px !important;
      color: #e11d48 !important;
      font-weight: 500 !important;
    }

    /* Поле ввода */
    .getvoxly-input-area {
      padding: 10px 12px 6px !important;
      background: #fafafa !important;
      border-top: 1px solid #e5e5e5 !important;
      flex-shrink: 0 !important;
    }
    .is-dark-theme .getvoxly-input-area {
      background: #18181b !important;
      border-top-color: #27272a !important;
    }
    .getvoxly-input-wrapper {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      background: #ffffff !important;
      border: 1px solid #e5e5e5 !important;
      border-radius: 12px !important;
      padding: 6px 8px 6px 12px !important;
      transition: border-color 0.15s !important;
    }
    .is-dark-theme .getvoxly-input-wrapper {
      background: #111111 !important;
      border-color: #27272a !important;
    }
    .getvoxly-input-wrapper:focus-within {
      border-color: var(--accent-color, #6366F1) !important;
    }
    .getvoxly-textarea {
      flex: 1 !important;
      background: transparent !important;
      border: none !important;
      color: #111111 !important;
      padding: 0 !important;
      font-size: 13px !important;
      font-family: inherit !important;
      resize: none !important;
      height: 24px !important;
      max-height: 80px !important;
      outline: none !important;
      line-height: 24px !important;
    }
    .is-dark-theme .getvoxly-textarea {
      color: #f1f5f9 !important;
    }
    .getvoxly-send-btn {
      background: var(--accent-color, #6366F1) !important;
      color: #ffffff !important;
      border: none !important;
      border-radius: 8px !important;
      width: 30px !important;
      height: 30px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      transition: transform 0.1s ease, opacity 0.15s !important;
      flex-shrink: 0 !important;
    }
    .getvoxly-send-btn:hover {
      transform: scale(1.05) !important;
    }
    .getvoxly-send-btn:active {
      transform: scale(0.95) !important;
    }
    .getvoxly-send-btn:disabled {
      opacity: 0.5 !important;
      cursor: not-allowed !important;
    }
    .getvoxly-typing {
      font-size: 11px !important;
      color: #888888 !important;
      font-style: italic !important;
      padding: 0 16px 6px !important;
      display: none;
    }
    .getvoxly-consent {
      background: #fafafa !important;
      font-size: 10px !important;
      color: #888888 !important;
      text-align: center !important;
      padding: 2px 12px 6px !important;
      line-height: 1.25 !important;
      user-select: none !important;
    }
    .is-dark-theme .getvoxly-consent {
      background: #18181b !important;
      color: #71717a !important;
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
    var yandexuid = getCookie('yandexuid') || null;
    var ymD = getCookie('_ym_d') || null;
    var yabsSid = getCookie('yabs-sid') || null;
    var gaId = getCookie('_ga') || null;
    var gaGid = getCookie('_gid') || null;
    var fbId = getCookie('_fbp') || getCookie('_fbc') || null;
    var tmrLvid = getCookie('_tmr_lvid') || null;
    var vkUid = getCookie('_vk_uid') || getCookie('remixsid') || null;

    try {
      if (!ymUid && window.Ya && window.Ya.Metrika2) {
        var counters = window.Ya.Metrika2.counters ? window.Ya.Metrika2.counters() : [];
        if (counters && counters[0] && typeof counters[0].getClientID === 'function') {
          ymUid = counters[0].getClientID();
        }
      }
    } catch (e) {}

    try {
      if (!gaId && window.ga && typeof window.ga.getAll === 'function') {
        var trackers = window.ga.getAll();
        if (trackers && trackers[0] && typeof trackers[0].get === 'function') {
          gaId = trackers[0].get('clientId');
        }
      }
    } catch (e) {}

    function setPersistentCookie(name, value, days) {
      try {
        var d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
      } catch (e) {}
    }

    function getDeviceFingerprint() {
      try {
        var scr = window.screen ? [window.screen.width, window.screen.height, window.screen.colorDepth, window.devicePixelRatio || 1].join('x') : '';
        var tz = '';
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
        var tzOff = new Date().getTimezoneOffset();
        var lng = (navigator.languages ? navigator.languages.join(',') : navigator.language) || '';
        var plt = navigator.platform || (navigator.userAgentData && navigator.userAgentData.platform) || '';
        var cores = navigator.hardwareConcurrency || 0;
        var mem = navigator.deviceMemory || 0;
        var touch = navigator.maxTouchPoints || 0;

        var cvsHash = '';
        try {
          var cvs = document.createElement('canvas');
          cvs.width = 180;
          cvs.height = 30;
          var ctx = cvs.getContext('2d');
          if (ctx) {
            ctx.textBaseline = 'top';
            ctx.font = '13px Arial';
            ctx.fillStyle = '#4a38f5';
            ctx.fillRect(0, 0, 80, 20);
            ctx.fillStyle = '#03b2cb';
            ctx.fillText('GetVoxly,fp26', 2, 2);
            var dUrl = cvs.toDataURL();
            var h = 0;
            for (var i = 0; i < dUrl.length; i++) {
              h = ((h << 5) - h) + dUrl.charCodeAt(i);
              h |= 0;
            }
            cvsHash = 'cv_' + Math.abs(h).toString(36);
          }
        } catch (e) {}

        var gpu = '';
        try {
          var glCvs = document.createElement('canvas');
          var gl = glCvs.getContext('webgl') || glCvs.getContext('experimental-webgl');
          if (gl) {
            var ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext) {
              gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').replace(/[^\w.-]/g, '_').slice(0, 50);
            }
          }
        } catch (e) {}

        var raw = [scr, tz, tzOff, lng, plt, cores, mem, touch, cvsHash, gpu].join('|');
        var fpH = 0;
        for (var j = 0; j < raw.length; j++) {
          fpH = ((fpH << 5) - fpH) + raw.charCodeAt(j);
          fpH |= 0;
        }

        return {
          fingerprint: 'dfp_' + Math.abs(fpH).toString(36),
          screen: scr,
          timezone: tz,
          timezoneOffset: tzOff,
          language: lng,
          platform: plt,
          cpuCores: cores,
          deviceMemory: mem,
          maxTouchPoints: touch,
          canvasHash: cvsHash,
          gpuRenderer: gpu,
        };
      } catch (e) {
        return { fingerprint: 'dfp_fallback', screen: '', timezone: '', language: '', platform: '' };
      }
    }

    var dfp = getDeviceFingerprint();

    // UTM-метки и рекламные Click ID
    var STORAGE_KEY_UTM = 'getvoxly_utm_tags';
    var STORAGE_KEY_CLICKS = 'getvoxly_click_ids';
    var utmTags = {};
    var clickIds = {};
    try {
      utmTags = JSON.parse(safeStorage.getItem(STORAGE_KEY_UTM) || '{}');
      clickIds = JSON.parse(safeStorage.getItem(STORAGE_KEY_CLICKS) || '{}');
    } catch (e) {
      utmTags = {};
      clickIds = {};
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

      var detectedClicks = {};
      ['yclid', 'gclid', 'fbclid', 'vkclid', '_openstat'].forEach(function (param) {
        if (searchParams.has(param)) {
          detectedClicks[param] = searchParams.get(param);
        }
      });
      if (Object.keys(detectedClicks).length > 0) {
        clickIds = Object.assign({}, clickIds, detectedClicks);
        safeStorage.setItem(STORAGE_KEY_CLICKS, JSON.stringify(clickIds));
      }
    } catch (e) {}

    // Идентификация посетителя с многоуровневым хранением (Evercookie sync)
    var STORAGE_KEY_VISITOR = 'getvoxly_visitor_' + channelAccountId;
    var COOKIE_KEY_VISITOR = 'getvoxly_vid_' + channelAccountId;
    var visitorId = safeStorage.getItem(STORAGE_KEY_VISITOR) || getCookie(COOKIE_KEY_VISITOR) || '';

    if (!visitorId) {
      if (yandexuid) {
        visitorId = 'ya_' + yandexuid;
      } else if (ymUid) {
        visitorId = 'ym_' + ymUid;
      } else if (dfp.fingerprint && dfp.fingerprint !== 'dfp_fallback') {
        visitorId = 'usr_' + dfp.fingerprint.slice(4) + '_' + Math.random().toString(36).substring(2, 7);
      } else {
        visitorId = 'usr_' + Math.random().toString(36).substring(2, 11);
      }
    }

    safeStorage.setItem(STORAGE_KEY_VISITOR, visitorId);
    safeSessionStorage.setItem(STORAGE_KEY_VISITOR, visitorId);
    setPersistentCookie(COOKIE_KEY_VISITOR, visitorId, 365);

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
    var currentConfig = null;
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
      <div class="getvoxly-widget-bubble" id="getvoxly-bubble" title="Онлайн-консультант">
        <div class="getvoxly-bubble-icon" id="getvoxly-bubble-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
          </svg>
        </div>
        <div class="getvoxly-bubble-close-icon" id="getvoxly-bubble-close-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </div>
      </div>
    `;

    var win = document.createElement('div');
    win.className = 'getvoxly-widget-window';
    win.id = 'getvoxly-window';
    win.innerHTML = `
      <div class="getvoxly-header" id="getvoxly-header">
        <div class="getvoxly-header-left">
          <div class="getvoxly-header-avatar" id="getvoxly-header-avatar">
            <div class="getvoxly-header-avatar-inner" id="getvoxly-header-avatar-inner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
              </svg>
            </div>
            <span class="getvoxly-header-status-dot"></span>
          </div>
          <div class="getvoxly-header-info">
            <div class="getvoxly-header-name" id="getvoxly-header-name">Онлайн-консультант</div>
            <div class="getvoxly-header-sub" id="getvoxly-header-sub">В сети · Консультант онлайн</div>
          </div>
        </div>
        <div class="getvoxly-header-actions">
          <button class="getvoxly-header-btn getvoxly-header-expand" id="getvoxly-expand" title="Развернуть окно" type="button">
            <svg class="getvoxly-icon-expand" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
            </svg>
            <svg class="getvoxly-icon-compress" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
              <path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M10 14l-7 7"/>
            </svg>
          </button>
          <button class="getvoxly-header-btn getvoxly-header-close" id="getvoxly-close" title="Закрыть окно" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="getvoxly-messenger-container" id="getvoxly-messenger-container" style="display: none;"></div>
      <div class="getvoxly-messages" id="getvoxly-messages"></div>
      <div class="getvoxly-typing" id="getvoxly-typing">Ассистент печатает ответ...</div>
      <div class="getvoxly-input-area">
        <div class="getvoxly-attachment-preview" id="getvoxly-attachment-preview" style="display: none;"></div>
        <div class="getvoxly-attach-gate" id="getvoxly-attach-gate" style="display: none;">
          <div class="getvoxly-attach-gate-header">
            <div class="getvoxly-attach-gate-text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              <span>Укажите телефон для прикрепления файла:</span>
            </div>
            <button class="getvoxly-attach-cancel-btn" id="getvoxly-attach-cancel" title="Отмена" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </div>
          <div class="getvoxly-attach-gate-row">
            <input class="getvoxly-attach-phone-input" id="getvoxly-attach-phone" placeholder="+7 (999) 000-00-00" type="tel" autocomplete="tel" />
            <button class="getvoxly-attach-submit-btn" id="getvoxly-attach-submit" type="button">Выбрать файл</button>
          </div>
          <div class="getvoxly-attach-gate-error" id="getvoxly-attach-error" style="display: none;"></div>
        </div>
        <div class="getvoxly-input-wrapper">
          <button class="getvoxly-attach-btn" id="getvoxly-attach" title="Прикрепить фото или документ" type="button">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l7.88-7.88"/>
            </svg>
          </button>
          <input type="file" id="getvoxly-file-input" style="display: none;" accept="image/*,video/*,.pdf,.doc,.docx,.txt,.xls,.xlsx" />
          <textarea class="getvoxly-textarea" id="getvoxly-input" placeholder="Введите ваш вопрос..."></textarea>
          <button class="getvoxly-send-btn" id="getvoxly-send" title="Отправить" type="button">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="getvoxly-consent">
        Нажимая «Отправить», вы даете согласие на обработку персональных данных.
      </div>
    `;

    document.body.appendChild(wrapper);
    document.body.appendChild(win);

    sendTelemetry('dom_appended', 'bubble_ready');

    var bubble = document.getElementById('getvoxly-bubble');
    var bubbleIcon = document.getElementById('getvoxly-bubble-icon');
    var badge = document.getElementById('getvoxly-badge');
    var messagesContainer = document.getElementById('getvoxly-messages');
    var inputEl = document.getElementById('getvoxly-input');
    var sendBtn = document.getElementById('getvoxly-send');
    var closeBtn = document.getElementById('getvoxly-close');
    var expandBtn = document.getElementById('getvoxly-expand');
    var typingIndicator = document.getElementById('getvoxly-typing');
    var headerName = document.getElementById('getvoxly-header-name');
    var headerSub = document.getElementById('getvoxly-header-sub');
    var headerAvatarInner = document.getElementById('getvoxly-header-avatar-inner');
    var msgContainer = document.getElementById('getvoxly-messenger-container');

    var attachBtn = document.getElementById('getvoxly-attach');
    var fileInput = document.getElementById('getvoxly-file-input');
    var attachmentPreview = document.getElementById('getvoxly-attachment-preview');
    var attachGate = document.getElementById('getvoxly-attach-gate');
    var attachCloseBtn = document.getElementById('getvoxly-attach-cancel');
    var attachSubmitBtn = document.getElementById('getvoxly-attach-submit');
    var attachPhoneInput = document.getElementById('getvoxly-attach-phone');
    var attachGateError = document.getElementById('getvoxly-attach-error');

    var isExpanded = false;
    var pendingAttachment = null;

    var STORAGE_KEY_LEAD_PHONE = 'getvoxly_lead_phone_' + channelAccountId;
    var STORAGE_KEY_LEAD_EMAIL = 'getvoxly_lead_email_' + channelAccountId;
    var STORAGE_KEY_LEAD_NAME = 'getvoxly_lead_name_' + channelAccountId;

    function hasKnownLeadContact() {
      var p = safeStorage.getItem(STORAGE_KEY_LEAD_PHONE);
      var cleanP = p ? p.replace(/\D/g, '') : '';
      return Boolean(cleanP.length >= 10);
    }

    function formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      var k = 1024;
      var sizes = ['B', 'KB', 'MB', 'GB'];
      var i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function renderAttachmentPreview(att) {
      if (!attachmentPreview) return;
      if (!att) {
        attachmentPreview.innerHTML = '';
        attachmentPreview.style.display = 'none';
        return;
      }

      var isImg = att.mimeType && att.mimeType.startsWith('image/');
      var thumbHtml = isImg
        ? '<img src="' + att.url + '" class="getvoxly-preview-thumb" alt="Превью" />'
        : '<div class="getvoxly-preview-thumb"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>';

      attachmentPreview.innerHTML =
        '<div class="getvoxly-preview-card">' +
          thumbHtml +
          '<div class="getvoxly-preview-info">' +
            '<div class="getvoxly-preview-name" title="' + (att.filename || 'Файл') + '">' + (att.filename || 'Файл') + '</div>' +
            '<div class="getvoxly-preview-size">' + formatBytes(att.sizeBytes) + '</div>' +
          '</div>' +
          '<button class="getvoxly-preview-remove" id="getvoxly-preview-remove" title="Удалить файл" type="button">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
          '</button>' +
        '</div>';
      attachmentPreview.style.display = 'block';

      var removeBtn = document.getElementById('getvoxly-preview-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', function () {
          pendingAttachment = null;
          if (fileInput) fileInput.value = '';
          renderAttachmentPreview(null);
        });
      }
    }

    function showAttachGate() {
      if (!attachGate) return;
      if (attachGateError) {
        attachGateError.style.display = 'none';
        attachGateError.textContent = '';
      }
      if (attachPhoneInput) {
        attachPhoneInput.value = safeStorage.getItem(STORAGE_KEY_LEAD_PHONE) || '';
      }
      attachGate.style.display = 'block';
      if (attachPhoneInput) {
        setTimeout(function () { attachPhoneInput.focus(); }, 60);
      }
    }

    function hideAttachGate() {
      if (attachGate) attachGate.style.display = 'none';
      if (attachGateError) {
        attachGateError.style.display = 'none';
        attachGateError.textContent = '';
      }
    }

    if (attachCloseBtn) {
      attachCloseBtn.addEventListener('click', hideAttachGate);
    }

    function submitAttachGate() {
      var phone = attachPhoneInput ? attachPhoneInput.value.trim() : '';
      var cleanDigits = phone.replace(/\D/g, '');
      if (cleanDigits.length < 10) {
        if (attachGateError) {
          attachGateError.textContent = 'Пожалуйста, укажите действующий номер телефона.';
          attachGateError.style.display = 'block';
        }
        if (attachPhoneInput) attachPhoneInput.focus();
        return;
      }

      safeStorage.setItem(STORAGE_KEY_LEAD_PHONE, phone);
      hideAttachGate();
      if (fileInput) {
        fileInput.click();
      }
    }

    if (attachSubmitBtn) {
      attachSubmitBtn.addEventListener('click', submitAttachGate);
    }

    if (attachPhoneInput) {
      attachPhoneInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitAttachGate();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          hideAttachGate();
        }
      });
    }

    if (expandBtn) {
      expandBtn.addEventListener('click', function () {
        isExpanded = !isExpanded;
        if (isExpanded) {
          win.classList.add('is-expanded');
          expandBtn.title = 'Свернуть окно';
          var expIcon = expandBtn.querySelector('.getvoxly-icon-expand');
          var compIcon = expandBtn.querySelector('.getvoxly-icon-compress');
          if (expIcon) expIcon.style.display = 'none';
          if (compIcon) compIcon.style.display = 'block';
        } else {
          win.classList.remove('is-expanded');
          expandBtn.title = 'Развернуть окно';
          var expIcon = expandBtn.querySelector('.getvoxly-icon-expand');
          var compIcon = expandBtn.querySelector('.getvoxly-icon-compress');
          if (expIcon) expIcon.style.display = 'block';
          if (compIcon) compIcon.style.display = 'none';
        }
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      });
    }

    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', function () {
        if (hasKnownLeadContact()) {
          fileInput.click();
        } else {
          showAttachGate();
        }
      });

      fileInput.addEventListener('change', async function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;

        if (file.size > 20 * 1024 * 1024) {
          alert('Размер файла не должен превышать 20 МБ');
          fileInput.value = '';
          return;
        }

        if (attachmentPreview) {
          attachmentPreview.innerHTML =
            '<div class="getvoxly-preview-card">' +
              '<div class="getvoxly-preview-thumb"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>' +
              '<div class="getvoxly-preview-info"><div class="getvoxly-preview-name">Загрузка ' + file.name + '...</div></div>' +
            '</div>';
          attachmentPreview.style.display = 'block';
        }

        try {
          var formData = new FormData();
          formData.append('file', file);

          var res = await fetch(apiUrl + '/api/v1/public/chat/upload/' + channelAccountId, {
            method: 'POST',
            body: formData,
          });

          if (res.ok) {
            var uploadJson = await res.json();
            var data = uploadJson && uploadJson.data;
            if (data && data.url) {
              pendingAttachment = {
                url: data.url,
                filename: data.filename || file.name,
                mimeType: data.mimeType || file.type || 'application/octet-stream',
                sizeBytes: data.sizeBytes || file.size,
              };
              renderAttachmentPreview(pendingAttachment);
            } else {
              throw new Error('Пустой ответ сервера');
            }
          } else {
            var errData = await res.json().catch(function () { return {}; });
            alert('Ошибка загрузки: ' + (errData.error || 'не удалось загрузить файл'));
            renderAttachmentPreview(null);
            fileInput.value = '';
          }
        } catch (err) {
          alert('Не удалось загрузить файл. Проверьте соединение с интернетом.');
          renderAttachmentPreview(null);
          fileInput.value = '';
        }
      });
    }

    // Локальная история сообщений
    var STORAGE_KEY_CHAT_HISTORY = 'getvoxly_chat_history_' + channelAccountId;
    function getLocalHistory() {
      try {
        return JSON.parse(safeStorage.getItem(STORAGE_KEY_CHAT_HISTORY) || '[]');
      } catch (e) {
        return [];
      }
    }

    function createMiniAvatarHtml() {
      if (!currentConfig) {
        return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';
      }
      if (currentConfig.avatarType === 'photo' && currentConfig.consultantAvatar) {
        return '<img src="' + currentConfig.consultantAvatar + '" alt="Консультант" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">';
      }
      var isMascot = currentConfig.avatarType === 'mascot' || (!currentConfig.avatarType && (currentConfig.customMascotDirections || currentConfig.mascotId === 'custom' || currentConfig.mascotId));
      if (isMascot && currentConfig._directionsUrl) {
        return '<div style="width:28px;height:28px;border-radius:50%;background-image:url(\'' + currentConfig._directionsUrl + '\');background-size:300% 300%;background-position:50% 50%;background-repeat:no-repeat;display:block;"></div>';
      }
      return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';
    }

    function appendMessageToUI(text, isUser, attachment, attachmentType) {
      if (!messagesContainer) return;

      var row = document.createElement('div');
      row.className = 'getvoxly-msg-row ' + (isUser ? 'getvoxly-msg-row-user' : 'getvoxly-msg-row-bot');

      var bubble = document.createElement('div');
      bubble.className = 'getvoxly-msg ' + (isUser ? 'getvoxly-msg-user' : 'getvoxly-msg-bot');

      if (attachment) {
        var attContainer = document.createElement('div');
        attContainer.className = 'getvoxly-msg-attachment';

        var isImg = attachmentType && attachmentType.startsWith('image/');
        var isVideo = attachmentType && attachmentType.startsWith('video/');

        if (isImg) {
          var link = document.createElement('a');
          link.href = attachment;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          var img = document.createElement('img');
          img.className = 'getvoxly-msg-img';
          img.src = attachment;
          img.alt = 'Фотография';
          img.loading = 'lazy';
          link.appendChild(img);
          attContainer.appendChild(link);
        } else if (isVideo) {
          var video = document.createElement('video');
          video.className = 'getvoxly-msg-video';
          video.src = attachment;
          video.controls = true;
          attContainer.appendChild(video);
        } else {
          var docLink = document.createElement('a');
          docLink.className = 'getvoxly-msg-file-link';
          docLink.href = attachment;
          docLink.target = '_blank';
          docLink.rel = 'noopener noreferrer';
          docLink.download = '';
          var rawName = (attachment.split('/').pop() || 'Документ').split('?')[0];
          docLink.innerHTML =
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
            '<span>' + rawName + '</span>';
          attContainer.appendChild(docLink);
        }
        bubble.appendChild(attContainer);
      }

      var isTextPlaceholder = Boolean(
        attachment && (!text || text === 'Фотография' || text === 'Видео' || text === 'Вложение')
      );

      if (text && !isTextPlaceholder) {
        var textEl = document.createElement('div');
        textEl.className = 'getvoxly-msg-text';
        textEl.textContent = text;
        bubble.appendChild(textEl);
      }

      if (isUser) {
        row.appendChild(bubble);
      } else {
        var avatarEl = document.createElement('div');
        avatarEl.className = 'getvoxly-msg-bot-avatar';
        avatarEl.innerHTML = createMiniAvatarHtml();

        var contentEl = document.createElement('div');
        contentEl.className = 'getvoxly-msg-bot-content';

        if (currentConfig && currentConfig.consultantName) {
          var authorEl = document.createElement('div');
          authorEl.className = 'getvoxly-msg-bot-author';
          authorEl.textContent = currentConfig.consultantName;
          contentEl.appendChild(authorEl);
        }

        contentEl.appendChild(bubble);
        row.appendChild(avatarEl);
        row.appendChild(contentEl);
      }

      messagesContainer.appendChild(row);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function saveAndRenderMessage(text, isUser, attachment, attachmentType) {
      appendMessageToUI(text, isUser, attachment, attachmentType);
      var hist = getLocalHistory();
      hist.push({
        text: text,
        isUser: isUser,
        attachment: attachment || null,
        attachmentType: attachmentType || null,
        timestamp: Date.now()
      });
      try {
        safeStorage.setItem(STORAGE_KEY_CHAT_HISTORY, JSON.stringify(hist));
      } catch (e) {}
    }

    var existingHistory = getLocalHistory();
    if (existingHistory.length > 0) {
      existingHistory.forEach(function (m) {
        appendMessageToUI(m.text, m.isUser, m.attachment, m.attachmentType);
      });
    }

    var syncInProgress = false;
    var historyPollTimer = null;

    async function syncHistoryFromServer() {
      if (!channelAccountId || !visitorId || syncInProgress) return;
      try {
        syncInProgress = true;
        var res = await fetch(apiUrl + '/api/v1/public/chat/history/' + channelAccountId + '?visitorId=' + encodeURIComponent(visitorId));
        if (res.ok) {
          var json = await res.json();
          var items = json && json.data;
          if (Array.isArray(items) && items.length > 0) {
            var currentRows = messagesContainer ? messagesContainer.querySelectorAll('.getvoxly-msg') : [];
            var lastCurrentText = currentRows.length > 0 ? currentRows[currentRows.length - 1].textContent : '';
            var lastServerText = items[items.length - 1].content;

            if (currentRows.length !== items.length || lastCurrentText !== lastServerText) {
              if (messagesContainer) {
                messagesContainer.innerHTML = '';
              }
              var localHist = [];
              for (var k = 0; k < items.length; k++) {
                var m = items[k];
                var isUser = m.direction === 'inbound';
                appendMessageToUI(m.content, isUser, m.attachment, m.attachmentType);
                localHist.push({
                  text: m.content,
                  isUser: isUser,
                  attachment: m.attachment || null,
                  attachmentType: m.attachmentType || null,
                  timestamp: m.createdAt
                });
              }
              try {
                safeStorage.setItem(STORAGE_KEY_CHAT_HISTORY, JSON.stringify(localHist));
              } catch (e) {}
              if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
              }
            }
          }
        }
      } catch (e) {
      } finally {
        syncInProgress = false;
      }
    }

    function isMobileScreen() {
      return (typeof window !== 'undefined') && (
        window.innerWidth <= 640 ||
        (window.matchMedia && window.matchMedia('(max-width: 640px)').matches)
      );
    }

    var isScrollLocked = false;
    var prevBodyOverflow = '';
    var prevHtmlOverflow = '';
    var prevTouchAction = '';

    function lockMobileScroll() {
      if (!isMobileScreen() || isScrollLocked) return;
      isScrollLocked = true;
      try {
        prevBodyOverflow = document.body.style.overflow;
        prevHtmlOverflow = document.documentElement.style.overflow;
        prevTouchAction = document.body.style.touchAction;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
      } catch (e) {}
    }

    function unlockMobileScroll() {
      if (!isScrollLocked) return;
      isScrollLocked = false;
      try {
        document.body.style.overflow = prevBodyOverflow;
        document.documentElement.style.overflow = prevHtmlOverflow;
        document.body.style.touchAction = prevTouchAction;
      } catch (e) {}
      prevBodyOverflow = '';
      prevHtmlOverflow = '';
      prevTouchAction = '';
    }

    function updateMobileViewport() {
      if (!isMobileScreen()) {
        win.style.top = '';
        win.style.left = '';
        win.style.width = '';
        win.style.height = '';
        win.style.bottom = '';
        win.style.maxHeight = '';
        return;
      }
      if (!isOpen) return;

      if (window.visualViewport) {
        var vv = window.visualViewport;
        var topPx = Math.max(0, Math.round(vv.offsetTop));
        var leftPx = Math.max(0, Math.round(vv.offsetLeft));
        var heightPx = Math.round(vv.height);
        var widthPx = Math.round(vv.width);

        win.style.setProperty('position', 'fixed', 'important');
        win.style.setProperty('top', topPx + 'px', 'important');
        win.style.setProperty('left', leftPx + 'px', 'important');
        win.style.setProperty('width', widthPx + 'px', 'important');
        win.style.setProperty('height', heightPx + 'px', 'important');
        win.style.setProperty('max-height', heightPx + 'px', 'important');
        win.style.setProperty('bottom', 'auto', 'important');
      } else {
        win.style.setProperty('position', 'fixed', 'important');
        win.style.setProperty('top', '0px', 'important');
        win.style.setProperty('left', '0px', 'important');
        win.style.setProperty('width', '100vw', 'important');
        win.style.setProperty('height', '100%', 'important');
        win.style.setProperty('max-height', '100%', 'important');
        win.style.setProperty('bottom', '0px', 'important');
      }

      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }

    function openWidget() {
      isOpen = true;
      win.style.display = 'flex';
      wrapper.classList.add('is-chat-open');
      if (isMobileScreen()) {
        lockMobileScroll();
        updateMobileViewport();
      }
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
      if (!isMobileScreen() && inputEl && typeof inputEl.focus === 'function') {
        setTimeout(function () { inputEl.focus(); }, 100);
      }
      initSession();
      syncHistoryFromServer();
      if (!historyPollTimer) {
        historyPollTimer = setInterval(syncHistoryFromServer, 4000);
      }
    }

    function closeWidget() {
      isOpen = false;
      win.style.display = 'none';
      wrapper.classList.remove('is-chat-open');
      unlockMobileScroll();
      if (historyPollTimer) {
        clearInterval(historyPollTimer);
        historyPollTimer = null;
      }
      win.style.top = '';
      win.style.left = '';
      win.style.width = '';
      win.style.height = '';
      win.style.bottom = '';
      win.style.maxHeight = '';
      if (badge) {
        badge.style.display = (currentConfig && currentConfig.badgeEnabled === false) ? 'none' : '';
      }
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

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateMobileViewport);
      window.visualViewport.addEventListener('scroll', updateMobileViewport);
    }
    window.addEventListener('resize', updateMobileViewport);
    window.addEventListener('orientationchange', function () {
      setTimeout(updateMobileViewport, 200);
    });

    if (inputEl) {
      inputEl.addEventListener('focus', function () {
        if (isMobileScreen()) {
          setTimeout(updateMobileViewport, 60);
          setTimeout(updateMobileViewport, 180);
          setTimeout(updateMobileViewport, 320);
        }
      });
      inputEl.addEventListener('blur', function () {
        if (isMobileScreen()) {
          setTimeout(updateMobileViewport, 80);
        }
      });
    }

    // Фоновая инициализация сессии на сервере
    initSession();

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
          currentConfig = data;
          sendTelemetry('init_success', data.mascotId || 'none');

          if (data.visitorId) {
            visitorId = data.visitorId;
            safeStorage.setItem(STORAGE_KEY_VISITOR, visitorId);
          }
          syncHistoryFromServer();

          // Установка акцентного цвета
          var accent = data.accentColor || '#6366F1';
          wrapper.style.setProperty('--accent-color', accent);
          wrapper.style.setProperty('--badge-color', accent);
          win.style.setProperty('--accent-color', accent);

          // Настройка всплывающего бейджа и динамической смены фраз
          var badgeEl = document.getElementById('getvoxly-badge');
          if (badgeEl) {
            if (data.badgeEnabled === false) {
              badgeEl.style.display = 'none';
              if (window.__gvx_badge_timer) {
                clearInterval(window.__gvx_badge_timer);
                window.__gvx_badge_timer = null;
              }
            } else {
              var badgePhrases = [];
              if (Array.isArray(data.badgeTexts) && data.badgeTexts.length > 0) {
                badgePhrases = data.badgeTexts.map(function (s) { return String(s).trim(); }).filter(Boolean);
              } else if (typeof data.badgeTexts === 'string' && data.badgeTexts.trim()) {
                badgePhrases = data.badgeTexts.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
              } else if (typeof data.badgeText === 'string' && data.badgeText.trim()) {
                badgePhrases = [data.badgeText.trim()];
              }

              if (badgePhrases.length === 0) {
                badgePhrases = ['Задайте вопрос'];
              }

              var badgeCurrentIdx = 0;
              badgeEl.textContent = badgePhrases[0];
              if (!isOpen) {
                badgeEl.style.display = '';
              }

              if (window.__gvx_badge_timer) {
                clearInterval(window.__gvx_badge_timer);
                window.__gvx_badge_timer = null;
              }

              if (badgePhrases.length > 1) {
                var intervalSec = Math.max(2, (data.badgeRotateIntervalSec || 5));
                window.__gvx_badge_timer = setInterval(function () {
                  if (isOpen) return;
                  badgeEl.classList.add('is-animating');
                  setTimeout(function () {
                    badgeCurrentIdx = (badgeCurrentIdx + 1) % badgePhrases.length;
                    badgeEl.textContent = badgePhrases[badgeCurrentIdx];
                    badgeEl.classList.remove('is-animating');
                  }, 250);
                }, intervalSec * 1000);
              }
            }
          }

          // Тема (светлая / тёмная)
          if (data.theme === 'dark') {
            win.classList.add('is-dark-theme');
          } else {
            win.classList.remove('is-dark-theme');
          }

          // Шапка виджета: имя консультанта и статус
          if (headerName) {
            headerName.textContent = data.consultantName || data.title || (data.tenantName + ' (' + data.botName + ')');
          }
          if (headerSub) {
            headerSub.textContent = data.consultantName
              ? (data.title || 'Онлайн-консультант')
              : (data.isAiEnabled ? (data.botName || 'AI-ассистент онлайн') : 'В сети · Консультант онлайн');
          }

          // Позиционирование (слева / справа)
          if (data.position === 'bottom-left') {
            wrapper.classList.add('position-left');
            win.classList.add('position-left');
          }

          if (data.placeholder && inputEl) {
            inputEl.placeholder = data.placeholder;
          }

          // Поддержка интерактивного 3D-маскота или фото консультанта
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
          data._directionsUrl = directionsUrl;
          data._reactionsUrl = reactionsUrl;
          currentConfig = data;

          // Обновление мини-аватаров и имен во всех уже отрисованных сообщениях бота
          if (messagesContainer) {
            var botAvatars = messagesContainer.querySelectorAll('.getvoxly-msg-bot-avatar');
            var newAvatarHtml = createMiniAvatarHtml();
            for (var a = 0; a < botAvatars.length; a++) {
              botAvatars[a].innerHTML = newAvatarHtml;
            }
            if (data.consultantName) {
              var botContents = messagesContainer.querySelectorAll('.getvoxly-msg-bot-content');
              for (var c = 0; c < botContents.length; c++) {
                if (!botContents[c].querySelector('.getvoxly-msg-bot-author')) {
                  var authorEl = document.createElement('div');
                  authorEl.className = 'getvoxly-msg-bot-author';
                  authorEl.textContent = data.consultantName;
                  botContents[c].insertBefore(authorEl, botContents[c].firstChild);
                }
              }
            }
          }

          // Обновление аватара в шапке
          if (headerAvatarInner) {
            if (data.avatarType === 'photo' && data.consultantAvatar) {
              headerAvatarInner.innerHTML = '<img src="' + data.consultantAvatar + '" alt="Консультант" style="width:100%;height:100%;object-fit:cover;display:block;">';
            } else if (data.avatarType === 'mascot' || (!data.avatarType && (data.customMascotDirections || data.mascotId === 'custom'))) {
              headerAvatarInner.innerHTML = '<div style="width:34px;height:34px;border-radius:50%;background-image:url(\'' + directionsUrl + '\');background-size:300% 300%;background-position:50% 50%;background-repeat:no-repeat;"></div>';
            }
          }

          // Рендер плавающего маскота / фото в кнопке
          if (data.avatarType === 'mascot' || (!data.avatarType && (data.customMascotDirections || data.mascotId === 'custom'))) {
            bubble.classList.add('is-mascot');

            var mascotEl = document.createElement('div');
            mascotEl.className = 'getvoxly-mascot-wrap';
            mascotEl.id = 'getvoxly-mascot-el';

            var spriteEl = document.createElement('div');
            spriteEl.className = 'getvoxly-mascot-sprite';
            spriteEl.id = 'getvoxly-mascot-sprite';
            spriteEl.style.backgroundImage = 'url("' + directionsUrl + '")';
            spriteEl.style.setProperty('background-position', '50% 50%', 'important');

            var dot = document.createElement('span');
            dot.className = 'getvoxly-bubble-dot';

            mascotEl.appendChild(spriteEl);
            mascotEl.appendChild(dot);

            bubbleIcon.innerHTML = '';
            bubbleIcon.appendChild(mascotEl);

            var isBooped = false;
            var boopTimer = null;

            // Точное отслеживание направления взгляда маскота по 8 секторам
            var CLOCKWISE = [
              'right',
              'down-right',
              'down',
              'down-left',
              'left',
              'up-left',
              'up',
              'up-right',
            ];
            var POSITIONS = {
              center: '50% 50%',
              'up-left': '0% 0%',
              up: '50% 0%',
              'up-right': '100% 0%',
              left: '0% 50%',
              right: '100% 50%',
              'down-left': '0% 100%',
              down: '50% 100%',
              'down-right': '100% 100%',
            };
            var SECTOR = (Math.PI * 2) / 8;
            var HYSTERESIS = 0.12;
            var DEAD_ZONE = 36;

            function wrapAngle(angle) {
              return Math.atan2(Math.sin(angle), Math.cos(angle));
            }

            var currentSector = -1;
            function updateMascotAim(clientX, clientY) {
              if (!spriteEl || isBooped || isOpen) return;
              var b = bubble.getBoundingClientRect();
              var cx = b.left + b.width / 2;
              var cy = b.top + b.height / 2;
              var dx = clientX - cx;
              var dy = clientY - cy;

              if (Math.hypot(dx, dy) < DEAD_ZONE) {
                currentSector = -1;
                spriteEl.style.setProperty('background-position', '50% 50%', 'important');
                return;
              }

              var angle = Math.atan2(dy, dx);
              if (currentSector !== -1 && Math.abs(wrapAngle(angle - currentSector * SECTOR)) < SECTOR / 2 + HYSTERESIS) {
                return;
              }

              currentSector = (Math.round(angle / SECTOR) + 8) % 8;
              var dirName = CLOCKWISE[currentSector];
              var pos = POSITIONS[dirName] || '50% 50%';
              spriteEl.style.setProperty('background-position', pos, 'important');
            }

            // Плавное отслеживание направления взгляда маскота без двойного срабатывания и рывков
            var rAF = null;
            var lastClientX = 0, lastClientY = 0;
            function onPointerMove(e) {
              lastClientX = e.clientX;
              lastClientY = e.clientY;
              if (rAF) return;
              rAF = window.requestAnimationFrame(function () {
                rAF = null;
                updateMascotAim(lastClientX, lastClientY);
              });
            }

            var moveEvent = window.PointerEvent ? 'pointermove' : 'mousemove';
            window.addEventListener(moveEvent, onPointerMove, { passive: true });

            if (bubble) {
              bubble.addEventListener('pointerdown', function (e) {
                if (isOpen) return; // Если окно уже открыто, клик обрабатывается как закрытие
                if (!spriteEl) return;
                isBooped = true;
                spriteEl.style.backgroundImage = 'url("' + reactionsUrl + '")';
                spriteEl.style.setProperty('background-position', '50% 50%', 'important');
                if (mascotEl) mascotEl.classList.add('squashing');

                clearTimeout(boopTimer);
                boopTimer = setTimeout(function () {
                  isBooped = false;
                  spriteEl.style.backgroundImage = 'url("' + directionsUrl + '")';
                  if (mascotEl) mascotEl.classList.remove('squashing');
                  spriteEl.style.setProperty('background-position', '50% 50%', 'important');
                }, 600);
              });
            }
          } else if (data.avatarType === 'photo' && data.consultantAvatar) {
            bubble.classList.add('is-photo');
            bubbleIcon.innerHTML = '<img class="getvoxly-bubble-photo-img" src="' + data.consultantAvatar + '" alt="Консультант"><span class="getvoxly-bubble-dot"></span>';
          }

          // Приветственное сообщение
          if ((!messagesContainer.children || messagesContainer.children.length === 0) && data.greeting) {
            saveAndRenderMessage(data.greeting, false);
          }

          // Кнопки перехода в мессенджеры (Telegram, WhatsApp, MAX)
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

          // Проверяем настройку показа баннера мессенджеров (независимо от того, Telegram это, WhatsApp или MAX)
          if (msgContainer && buttons.length > 0 && data.showMessengerBanner !== false) {
            msgContainer.style.display = 'block';

            if (buttons.length === 1) {
              var b = buttons[0];
              var linkHref = b.url;
              if (b.type === 'telegram') {
                linkHref += (linkHref.indexOf('?') === -1 ? '?start=site_' + visitorId : '&start=site_' + visitorId);
              } else if (b.type === 'whatsapp') {
                var waSep = linkHref.indexOf('?') === -1 ? '?' : '&';
                linkHref += waSep + 'text=' + encodeURIComponent('Здравствуйте! (код: site_' + visitorId + ')');
              } else if (b.type === 'max') {
                if (linkHref.indexOf('/u/') === -1) {
                  linkHref += (linkHref.indexOf('?') === -1 ? '?start=site_' + visitorId : '&start=site_' + visitorId);
                }
              }
              var iconSvg = '';

              if (b.type === 'telegram') {
                iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>';
              } else if (b.type === 'whatsapp') {
                iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19.01L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.34C9.36 7.34 9.09 7.4 8.87 7.65C8.65 7.89 8.02 8.49 8.02 9.71C8.02 10.93 8.91 12.11 9.03 12.27C9.15 12.44 10.74 14.98 13.23 15.96C15.3 16.77 15.72 16.61 16.17 16.57C16.62 16.53 17.62 15.98 17.83 15.4C18.04 14.81 18.04 14.31 17.98 14.21C17.92 14.1 17.76 14.04 17.51 13.92C17.27 13.79 16.07 13.2 15.85 13.12C15.63 13.04 15.46 13 15.3 13.25C15.13 13.49 14.66 14.04 14.52 14.21C14.38 14.37 14.24 14.4 14 14.27C13.75 14.15 12.96 13.89 12.03 13.06C11.3 12.41 10.81 11.61 10.67 11.36C10.53 11.12 10.65 10.99 10.78 10.86C10.89 10.75 11.03 10.57 11.16 10.42C11.28 10.27 11.32 10.16 11.41 9.99C11.49 9.83 11.45 9.68 11.39 9.56C11.33 9.44 10.83 8.21 10.62 7.71C10.42 7.22 10.21 7.29 10.06 7.28C9.92 7.27 9.75 7.27 9.58 7.27"/></svg>';
              } else if (b.type === 'max') {
                iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
              }

              var actionText = 'Перейти \u2192';
              msgContainer.innerHTML = '<a href="' + linkHref + '" target="_blank" rel="noopener noreferrer" class="getvoxly-msg-banner-single is-' + b.type + '">' +
                '<div class="getvoxly-msg-banner-left">' +
                  iconSvg +
                  '<span class="getvoxly-msg-banner-title">Продолжить в ' + b.label + '</span>' +
                '</div>' +
                '<span class="getvoxly-msg-banner-action">' + actionText + '</span>' +
              '</a>';
            } else {
              var buttonsHtml = '';
              for (var j = 0; j < buttons.length; j++) {
                var btn = buttons[j];
                var href = btn.url;
                if (btn.type === 'telegram') {
                  href += (href.indexOf('?') === -1 ? '?start=site_' + visitorId : '&start=site_' + visitorId);
                } else if (btn.type === 'whatsapp') {
                  var waSep2 = href.indexOf('?') === -1 ? '?' : '&';
                  href += waSep2 + 'text=' + encodeURIComponent('Здравствуйте! (код: site_' + visitorId + ')');
                } else if (btn.type === 'max') {
                  if (href.indexOf('/u/') === -1) {
                    href += (href.indexOf('?') === -1 ? '?start=site_' + visitorId : '&start=site_' + visitorId);
                  }
                }
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

          // Проактивное приглашение в диалог
          var isProactive = data.proactiveEnabled !== undefined ? Boolean(data.proactiveEnabled) : proactiveEnabled;
          var delaySec = (data.proactiveDelaySeconds !== undefined ? data.proactiveDelaySeconds : Math.round(proactiveDelay / 1000)) || 10;
          var proKey = 'getvoxly_proactive_shown_' + channelAccountId;

          if (isProactive && !safeSessionStorage.getItem(proKey)) {
            setTimeout(function () {
              var alreadyShown = safeSessionStorage.getItem(proKey);
              if (!alreadyShown) {
                safeSessionStorage.setItem(proKey, 'true');
                var hist = getLocalHistory();
                var userHasSpoken = hist.some(function (m) { return m.isUser; });
                if (!userHasSpoken) {
                  if (!isOpen) {
                    openWidget();
                  }
                  var proMsg = data.proactiveMessage || 'Я онлайн, спрашивайте, готов вам помочь';
                  var lastMsg = hist.length > 0 ? hist[hist.length - 1] : null;
                  if (!lastMsg || lastMsg.text !== proMsg) {
                    saveAndRenderMessage(proMsg, false);
                  }
                }
              }
            }, delaySec * 1000);
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
      if (!text && !pendingAttachment) return;

      var currentAttachment = pendingAttachment ? pendingAttachment.url : undefined;
      var currentAttachmentType = pendingAttachment ? pendingAttachment.mimeType : undefined;

      pendingAttachment = null;
      if (fileInput) fileInput.value = '';
      renderAttachmentPreview(null);

      inputEl.value = '';
      inputEl.style.height = '24px';
      lastDraft = '';

      if (text) {
        var phoneMatch = text.match(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/);
        if (phoneMatch) {
          var digits = phoneMatch[0].replace(/\D/g, '');
          if (digits.length >= 10) {
            safeStorage.setItem(STORAGE_KEY_LEAD_PHONE, phoneMatch[0]);
          }
        }
        var emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) {
          safeStorage.setItem(STORAGE_KEY_LEAD_EMAIL, emailMatch[0]);
        }
      }

      saveAndRenderMessage(text, true, currentAttachment, currentAttachmentType);

      if (currentAttachment) {
        clearTimeout(sendTimer);
        typingIndicator.style.display = 'block';
        executeSendMessage(text, false, currentAttachment, currentAttachmentType);
      } else {
        messageBuffer.push(text);
        clearTimeout(sendTimer);
        typingIndicator.style.display = 'block';
        sendTimer = setTimeout(flushMessageBuffer, 2500);
      }
    }

    async function executeSendMessage(fullText, isDraft, attachment, attachmentType) {
      try {
        var storedPhone = safeStorage.getItem(STORAGE_KEY_LEAD_PHONE) || undefined;
        var storedEmail = safeStorage.getItem(STORAGE_KEY_LEAD_EMAIL) || undefined;
        var storedName = safeStorage.getItem(STORAGE_KEY_LEAD_NAME) || undefined;

        var payload = {
          visitorId: visitorId,
          text: fullText || '',
          senderPhone: storedPhone,
          senderEmail: storedEmail,
          senderName: storedName,
          attachment: attachment || undefined,
          attachmentType: attachmentType || undefined,
          pageUrl: window.location.href,
          referrer: document.referrer || undefined,
          utmTags: utmTags,
          clickIds: clickIds,
          analytics: {
            ymUid: ymUid || undefined,
            yandexuid: yandexuid || undefined,
            ymD: ymD || undefined,
            yabsSid: yabsSid || undefined,
            gaId: gaId || undefined,
            gaGid: gaGid || undefined,
            fbId: fbId || undefined,
            tmrLvid: tmrLvid || undefined,
            vkUid: vkUid || undefined,
          },
          deviceFingerprint: dfp.fingerprint,
          deviceInfo: {
            screen: dfp.screen,
            timezone: dfp.timezone,
            timezoneOffset: dfp.timezoneOffset,
            language: dfp.language,
            platform: dfp.platform,
            cpuCores: dfp.cpuCores,
            deviceMemory: dfp.deviceMemory,
            maxTouchPoints: dfp.maxTouchPoints,
            canvasHash: dfp.canvasHash,
            gpuRenderer: dfp.gpuRenderer,
          },
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
            referrer: document.referrer || undefined,
            utmTags: utmTags,
            clickIds: clickIds,
            analytics: {
              ymUid: ymUid || undefined,
              yandexuid: yandexuid || undefined,
              gaId: gaId || undefined,
              fbId: fbId || undefined,
              tmrLvid: tmrLvid || undefined,
            },
            deviceFingerprint: dfp.fingerprint,
            deviceInfo: {
              screen: dfp.screen,
              timezone: dfp.timezone,
              language: dfp.language,
              platform: dfp.platform,
            },
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
