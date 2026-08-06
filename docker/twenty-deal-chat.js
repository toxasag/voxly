/* Voxly: Telegram chat panel on Twenty Opportunity (deal) and Person pages */
(function () {
  // Flip to false to restore inject UI (rollback). SDK tab «Чат» is the primary surface.
  var DISABLE_FLOATING_CHAT = true;
  if (DISABLE_FLOATING_CHAT) return;

  var API = '__VOXLY_API_URL__'.replace(/\/$/, '');
  var TOKEN_KEY = 'voxly_crm_chat_token';
  var ROOT_ID = 'voxly-deal-chat';
  var BTN_ID = 'voxly-deal-chat-btn';
  var MENU_ID = 'voxly-format-menu';
  var UUID_RE =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  var open = false;
  var recordId = null;
  var recordKind = null; // 'opportunity' | 'person'
  var pollTimer = null;
  var sending = false;
  var pendingFile = null;
  var objectUrls = [];
  var draftText = '';
  var lastMsgSig = '';
  var tokenCaptured = false;
  var stableRecordId = null;
  var stableRecordKind = null;

  function captureToken() {
    if (tokenCaptured) return;
    try {
      var hash = location.hash || '';
      var m = hash.match(/voxlyChatToken=([^&]+)/);
      if (!m) {
        var q = new URLSearchParams(location.search || '');
        var t = q.get('voxlyChatToken');
        if (t) m = [null, t];
      }
      if (m && m[1]) {
        localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1]));
        tokenCaptured = true;
        if (hash.indexOf('voxlyChatToken=') !== -1) {
          // Defer so Twenty router finishes first paint
          setTimeout(function () {
            try {
              history.replaceState(null, '', location.pathname + location.search);
            } catch (e) {}
          }, 800);
        }
      } else if (getToken()) {
        tokenCaptured = true;
      }
    } catch (e) {}
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function parseCrmRecord() {
    var path = location.pathname || '';
    var m =
      path.match(/\/object\/(opportunity|person)\/([0-9a-f-]{36})/i) ||
      path.match(/\/objects\/(opportunities|people)\/([0-9a-f-]{36})/i);
    if (m) {
      var kindRaw = String(m[1]).toLowerCase();
      var kind =
        kindRaw === 'person' || kindRaw === 'people' ? 'person' : 'opportunity';
      return { id: m[2], kind: kind };
    }
    if (/\/object\/opportunity|\/objects\/opportunities/i.test(path)) {
      var u = path.match(UUID_RE);
      if (u) return { id: u[0], kind: 'opportunity' };
    }
    if (/\/object\/person|\/objects\/people/i.test(path)) {
      var p = path.match(UUID_RE);
      if (p) return { id: p[0], kind: 'person' };
    }
    return null;
  }

  function roleLabel(role) {
    if (role === 'user') return 'Клиент';
    if (role === 'operator') return 'Менеджер';
    if (role === 'assistant' || role === 'bot') return 'Бот';
    return role || '';
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatContent(src) {
    var normalized = String(src || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/nbsp;/gi, ' ');
    var s = esc(normalized);
    s = s.replace(/```([\s\S]*?)```/g, function (_, code) {
      return (
        '<pre style="margin:4px 0;padding:6px;background:rgba(0,0,0,0.06);border-radius:6px;overflow:auto;font-size:12px">' +
        code +
        '</pre>'
      );
    });
    s = s.replace(
      /`([^`]+)`/g,
      '<code style="background:rgba(0,0,0,0.06);padding:1px 4px;border-radius:4px">$1</code>',
    );
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<em>$1</em>');
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    s = s.replace(
      /\|\|([^|]+)\|\|/g,
      '<span style="background:#333;color:#333;border-radius:3px;padding:0 2px">$1</span>',
    );
    s = s
      .split(/(<[^>]+>)/g)
      .map(function (part) {
        if (!part || part.charAt(0) === '<') return part;
        return part.replace(/(https?:\/\/[^\s<]+)/g, function (rawUrl) {
          var url = rawUrl;
          var trail = '';
          while (url.length > 0 && /[.,);:!?\]}'"]/.test(url.charAt(url.length - 1))) {
            trail = url.charAt(url.length - 1) + trail;
            url = url.slice(0, -1);
          }
          if (!/^https?:\/\//i.test(url)) return rawUrl;
          var href = esc(url);
          return (
            '<a href="' +
            href +
            '" target="_blank" rel="noopener noreferrer" style="color:#1961ed;text-decoration:underline;word-break:break-all">' +
            href +
            '</a>' +
            trail
          );
        });
      })
      .join('');
    return s;
  }

  function isTyping() {
    var el = document.activeElement;
    return el && (el.id === 'voxly-chat-input' || (el.closest && el.closest('#' + ROOT_ID)));
  }

  function stopBubble(e) {
    e.stopPropagation();
  }

  function bindPanelKeys(root) {
    ['keydown', 'keyup', 'keypress', 'input'].forEach(function (ev) {
      root.addEventListener(ev, stopBubble, true);
    });
  }

  function hideFormatMenu() {
    var menu = document.getElementById(MENU_ID);
    if (menu) menu.style.display = 'none';
  }

  function wrapSelection(markerOpen, markerClose) {
    var input = document.getElementById('voxly-chat-input');
    if (!input) return;
    var start = input.selectionStart;
    var end = input.selectionEnd;
    if (start == null || end == null || start === end) return;
    var val = input.value;
    var selected = val.slice(start, end);
    var next =
      val.slice(0, start) + markerOpen + selected + (markerClose || markerOpen) + val.slice(end);
    input.value = next;
    draftText = next;
    var pos = start + markerOpen.length + selected.length + (markerClose || markerOpen).length;
    input.focus();
    input.setSelectionRange(pos, pos);
    hideFormatMenu();
  }

  function showFormatMenu(x, y) {
    var menu = document.getElementById(MENU_ID);
    if (!menu) {
      menu = document.createElement('div');
      menu.id = MENU_ID;
      menu.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'display:none',
        'min-width:160px',
        'padding:6px',
        'background:#fff',
        'border:1px solid rgba(0,0,0,0.12)',
        'border-radius:10px',
        'box-shadow:0 8px 28px rgba(0,0,0,0.18)',
        'font:13px/1.3 Inter,ui-sans-serif,system-ui,sans-serif',
        'color:#1c1c1c',
      ].join(';');
      var items = [
        { label: 'Жирный', open: '**', close: '**' },
        { label: 'Курсив', open: '__', close: '__' },
        { label: 'Зачёркнутый', open: '~~', close: '~~' },
        { label: 'Спойлер', open: '||', close: '||' },
        { label: 'Код', open: '`', close: '`' },
      ];
      items.forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = it.label;
        b.style.cssText =
          'display:block;width:100%;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:6px;cursor:pointer;font:inherit';
        b.onmouseenter = function () {
          b.style.background = '#f3f3f3';
        };
        b.onmouseleave = function () {
          b.style.background = 'transparent';
        };
        b.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          wrapSelection(it.open, it.close);
        };
        menu.appendChild(b);
      });
      document.body.appendChild(menu);
      document.addEventListener(
        'click',
        function () {
          hideFormatMenu();
        },
        true,
      );
    }
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - 180)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - 220)) + 'px';
    menu.style.display = 'block';
  }

  function revokeObjectUrls() {
    objectUrls.forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {}
    });
    objectUrls = [];
  }

  function loadAttachmentBlob(fileId, imgOrLink) {
    var token = getToken();
    if (!token || !recordId || !fileId) return;
    fetch(
      API +
        '/api/crm/chat/' +
        encodeURIComponent(recordId) +
        '/file/' +
        encodeURIComponent(fileId),
      { headers: { Authorization: 'Bearer ' + token } },
    )
      .then(function (r) {
        if (!r.ok) throw new Error('file');
        return r.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        objectUrls.push(url);
        if (imgOrLink.tagName === 'IMG') {
          imgOrLink.src = url;
          imgOrLink.style.display = 'block';
        } else {
          imgOrLink.href = url;
        }
      })
      .catch(function () {});
  }

  function renderAttachments(atts) {
    if (!atts || !atts.length) return '';
    return atts
      .map(function (a) {
        if (!a || !a.fileId) return '';
        if (a.type === 'photo' || a.type === 'sticker') {
          return (
            '<img data-voxly-file="' +
            esc(a.fileId) +
            '" alt="media" style="display:none;max-width:100%;border-radius:8px;margin-top:6px" />'
          );
        }
        if (a.type === 'video' || a.type === 'animation') {
          return (
            '<div style="margin-top:6px"><a data-voxly-file="' +
            esc(a.fileId) +
            '" href="#" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">▶ Видео</a></div>'
          );
        }
        var label =
          a.fileName ||
          (a.type === 'voice' ? 'Голосовое' : a.type === 'audio' ? 'Аудио' : 'Файл');
        return (
          '<div style="margin-top:6px"><a data-voxly-file="' +
          esc(a.fileId) +
          '" href="#" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">📎 ' +
          esc(label) +
          '</a></div>'
        );
      })
      .join('');
  }

  function ensureUi() {
    if (!document.body) return;
    var btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.textContent = 'Чат';
      btn.setAttribute('aria-label', 'Чат Telegram');
      btn.style.cssText = [
        'position:fixed',
        'bottom:88px',
        'left:20px',
        'z-index:2147483645',
        'display:none',
        'align-items:center',
        'padding:10px 14px',
        'border-radius:10px',
        'border:1px solid rgba(0,0,0,0.08)',
        'background:#1c1c1c',
        'color:#fff',
        'font:600 13px/1.2 Inter,ui-sans-serif,system-ui,sans-serif',
        'cursor:pointer',
        'box-shadow:0 4px 16px rgba(0,0,0,0.18)',
      ].join(';');
      btn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        open = !open;
        var root = document.getElementById(ROOT_ID);
        if (root) root.style.display = open ? 'flex' : 'none';
        btn.style.background = open ? '#000' : '#1c1c1c';
        if (open) loadMessages(true);
        syncPoll();
      };
      document.body.appendChild(btn);
    }

    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.style.cssText = [
        'position:fixed',
        'bottom:140px',
        'left:20px',
        'width:min(400px,calc(100vw - 40px))',
        'height:min(520px,calc(100vh - 160px))',
        'z-index:2147483645',
        'display:none',
        'flex-direction:column',
        'background:#fff',
        'color:#1c1c1c',
        'border:1px solid rgba(0,0,0,0.1)',
        'border-radius:12px',
        'box-shadow:0 12px 40px rgba(0,0,0,0.18)',
        'overflow:hidden',
        'font:13px/1.4 Inter,ui-sans-serif,system-ui,sans-serif',
      ].join(';');
      root.innerHTML =
        '<div style="padding:12px 14px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:8px">' +
        '<div><div style="font-weight:700">Telegram</div><div id="voxly-chat-meta" style="color:#666;font-size:12px;margin-top:2px">CRM</div></div>' +
        '<button type="button" id="voxly-chat-close" style="border:0;background:transparent;font-size:18px;cursor:pointer;line-height:1;color:#666">×</button>' +
        '</div>' +
        '<div id="voxly-chat-list" style="flex:1;overflow:auto;padding:12px;background:#fafafa"></div>' +
        '<div id="voxly-chat-status" style="padding:0 12px 6px;color:#888;font-size:12px;min-height:18px"></div>' +
        '<div style="padding:0 12px 4px;color:#999;font-size:11px">Выделите текст → ПКМ → формат</div>' +
        '<div id="voxly-chat-file-row" style="display:none;padding:0 12px 6px;font-size:12px;color:#444"></div>' +
        '<form id="voxly-chat-form" style="display:flex;gap:8px;padding:10px 12px;border-top:1px solid #eee;background:#fff;align-items:flex-end">' +
        '<label style="cursor:pointer;padding:8px;border:1px solid #ddd;border-radius:8px;line-height:1;user-select:none" title="Прикрепить файл">' +
        '📎<input id="voxly-chat-file" type="file" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt" style="display:none" />' +
        '</label>' +
        '<textarea id="voxly-chat-input" rows="2" maxlength="4000" placeholder="Сообщение клиенту…" ' +
        'style="flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font:inherit;outline:none;resize:none"></textarea>' +
        '<button type="submit" style="border:0;border-radius:8px;background:#1c1c1c;color:#fff;padding:8px 12px;font:600 13px/1 Inter,sans-serif;cursor:pointer">Отправить</button>' +
        '</form>';
      document.body.appendChild(root);
      bindPanelKeys(root);
      if (open) root.style.display = 'flex';

      document.getElementById('voxly-chat-close').onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        open = false;
        root.style.display = 'none';
        btn.style.background = '#1c1c1c';
        hideFormatMenu();
        syncPoll();
      };
      document.getElementById('voxly-chat-form').onsubmit = function (e) {
        e.preventDefault();
        e.stopPropagation();
        sendReply();
      };
      var input = document.getElementById('voxly-chat-input');
      input.value = draftText;
      input.addEventListener('input', function () {
        draftText = input.value;
      });
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendReply();
        }
        if (e.key === 'Escape') hideFormatMenu();
      });
      input.addEventListener('contextmenu', function (e) {
        var start = input.selectionStart;
        var end = input.selectionEnd;
        if (start == null || end == null || start === end) return;
        e.preventDefault();
        e.stopPropagation();
        showFormatMenu(e.clientX, e.clientY);
      });

      document.getElementById('voxly-chat-file').onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        pendingFile = f || null;
        var row = document.getElementById('voxly-chat-file-row');
        if (!row) return;
        if (pendingFile) {
          row.style.display = 'block';
          row.innerHTML =
            'Файл: <strong>' +
            esc(pendingFile.name) +
            '</strong> <button type="button" id="voxly-chat-file-clear" style="border:0;background:transparent;color:#b42318;cursor:pointer;font:inherit">убрать</button>';
          document.getElementById('voxly-chat-file-clear').onclick = function () {
            pendingFile = null;
            e.target.value = '';
            row.style.display = 'none';
            row.innerHTML = '';
          };
        } else {
          row.style.display = 'none';
          row.innerHTML = '';
        }
      };
    } else {
      // Remounted by SPA wipe — restore draft if input empty
      var inputExist = document.getElementById('voxly-chat-input');
      if (inputExist && !inputExist.value && draftText) inputExist.value = draftText;
      if (open) root.style.display = 'flex';
    }
  }

  function setStatus(text, isError) {
    var el = document.getElementById('voxly-chat-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#b42318' : '#888';
  }

  function messagesSig(msgs) {
    if (!msgs || !msgs.length) return '0';
    return (
      msgs.length +
      ':' +
      (msgs[msgs.length - 1].id || '') +
      ':' +
      (msgs[msgs.length - 1].content || '').length
    );
  }

  function renderMessages(payload) {
    var list = document.getElementById('voxly-chat-list');
    var meta = document.getElementById('voxly-chat-meta');
    if (!list) return;
    var sig = messagesSig(payload.messages);
    if (sig === lastMsgSig && list.childNodes.length) return;
    lastMsgSig = sig;

    var hadFocus = isTyping();
    var selStart = 0;
    var selEnd = 0;
    var input = document.getElementById('voxly-chat-input');
    if (hadFocus && input) {
      selStart = input.selectionStart;
      selEnd = input.selectionEnd;
      draftText = input.value;
    }

    revokeObjectUrls();
    var who =
      (payload.firstName || '') +
      (payload.username ? ' @' + payload.username : '') +
      (payload.telegramId ? ' · ' + payload.telegramId : '');
    if (meta) meta.textContent = (who.trim() || 'Клиент') + (payload.mode === 'human' ? ' · human' : '');
    var msgs = payload.messages || [];
    if (!msgs.length) {
      list.innerHTML =
        '<div style="color:#888;text-align:center;padding:24px 8px">Пока нет сообщений. Когда клиент напишет боту — они появятся здесь.</div>';
      return;
    }
    list.innerHTML = msgs
      .map(function (m) {
        var mine = m.role === 'operator';
        var bot = m.role === 'assistant' || m.role === 'bot';
        var align = mine ? 'flex-end' : 'flex-start';
        var bg = mine ? '#1c1c1c' : bot ? '#eef2ff' : '#fff';
        var color = mine ? '#fff' : '#1c1c1c';
        var border = mine ? 'none' : '1px solid #e8e8e8';
        var body = formatContent(m.content || '');
        var media = renderAttachments(m.attachments);
        return (
          '<div style="display:flex;justify-content:' +
          align +
          ';margin-bottom:8px">' +
          '<div style="max-width:85%;background:' +
          bg +
          ';color:' +
          color +
          ';border:' +
          border +
          ';border-radius:10px;padding:8px 10px">' +
          '<div style="opacity:0.65;font-size:11px;margin-bottom:3px">' +
          esc(roleLabel(m.role)) +
          '</div>' +
          '<div style="white-space:pre-wrap;word-break:break-word">' +
          body +
          '</div>' +
          media +
          '</div></div>'
        );
      })
      .join('');
    list.scrollTop = list.scrollHeight;

    list.querySelectorAll('[data-voxly-file]').forEach(function (el) {
      loadAttachmentBlob(el.getAttribute('data-voxly-file'), el);
    });

    if (hadFocus && input) {
      input.focus();
      try {
        input.setSelectionRange(selStart, selEnd);
      } catch (e) {}
    }
  }

  function loadMessages(force) {
    if (!recordId) return;
    if (!force && isTyping()) return;
    var token = getToken();
    if (!token) {
      setStatus('Откройте CRM из кабинета Voxly (кнопка «CRM»), чтобы авторизовать чат.', true);
      return;
    }
    fetch(API + '/api/crm/chat/' + encodeURIComponent(recordId), {
      headers: { Authorization: 'Bearer ' + token },
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        if (res.status === 401) {
          setStatus('Сессия чата истекла. Снова откройте CRM из кабинета.', true);
          return;
        }
        if (res.status === 404) {
          renderMessages({ messages: [], firstName: '', username: '' });
          setStatus(
            recordKind === 'person'
              ? 'К этому контакту ещё не привязан Telegram-диалог.'
              : 'К этой сделке ещё не привязан Telegram-диалог.',
            true,
          );
          return;
        }
        if (!res.ok) {
          setStatus((res.data && res.data.error) || 'Ошибка загрузки чата', true);
          return;
        }
        setStatus('');
        renderMessages(res.data);
      })
      .catch(function () {
        setStatus('Не удалось связаться с API Voxly (' + API + ')', true);
      });
  }

  function sendReply() {
    if (sending || !recordId) return;
    var input = document.getElementById('voxly-chat-input');
    var text = (input && input.value ? input.value : draftText || '').trim();
    if (!text && !pendingFile) return;
    var token = getToken();
    if (!token) {
      setStatus('Нет токена чата. Откройте CRM из кабинета.', true);
      return;
    }
    sending = true;
    setStatus('Отправка…');
    hideFormatMenu();

    var url = API + '/api/crm/chat/' + encodeURIComponent(recordId) + '/reply';
    var req;
    if (pendingFile) {
      var fd = new FormData();
      if (text) fd.append('text', text);
      fd.append('file', pendingFile, pendingFile.name);
      req = fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd,
      });
    } else {
      req = fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: text }),
      });
    }

    req
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        sending = false;
        if (!res.ok) {
          setStatus((res.data && res.data.error) || 'Не удалось отправить', true);
          return;
        }
        draftText = '';
        if (input) input.value = '';
        pendingFile = null;
        var fileInput = document.getElementById('voxly-chat-file');
        if (fileInput) fileInput.value = '';
        var row = document.getElementById('voxly-chat-file-row');
        if (row) {
          row.style.display = 'none';
          row.innerHTML = '';
        }
        setStatus('Отправлено');
        lastMsgSig = '';
        loadMessages(true);
      })
      .catch(function () {
        sending = false;
        setStatus('Сеть: не удалось отправить', true);
      });
  }

  function syncPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (open && recordId) {
      pollTimer = setInterval(function () {
        loadMessages(false);
      }, 5000);
    }
  }

  function tick() {
    captureToken();
    ensureUi();
    var next = parseCrmRecord();
    var btn = document.getElementById(BTN_ID);
    var root = document.getElementById(ROOT_ID);
    if (!btn) return;

    if (!next) {
      // Keep last known record while Twenty briefly remounts routes
      if (stableRecordId && isTyping()) {
        recordId = stableRecordId;
        recordKind = stableRecordKind;
        btn.style.display = 'inline-flex';
        return;
      }
      recordId = null;
      recordKind = null;
      stableRecordId = null;
      stableRecordKind = null;
      btn.style.display = 'none';
      if (root && !isTyping()) root.style.display = 'none';
      open = false;
      syncPoll();
      return;
    }

    stableRecordId = next.id;
    stableRecordKind = next.kind;
    btn.style.display = 'inline-flex';
    if (next.id !== recordId) {
      recordId = next.id;
      recordKind = next.kind;
      lastMsgSig = '';
      if (open) loadMessages(true);
    } else {
      recordKind = next.kind;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
  setInterval(tick, 2000);
  window.addEventListener('popstate', tick);
})();
