/* Voxly: Twenty shell UX tweaks (multiworkspace + CRM defaults).
 * - Hide «+ Создать рабочее пространство» / Create workspace in profile ⋯ menu
 * - Pin CRM «Чат» canvas: disable page-layout outer scroll so composer stays fixed
 * - Kanban note chips: body text via title label; ≥5 lines; only latest note visible
 * - Deduplicate sidebar «Кабинет Voxly» (keep first)
 * - Opportunity create CTA: «New/Новый …» → «Новая Сделка» (Twenty template is masculine New)
 * - Left inbound-message toasts (prefer /s/crm-chat/inbound-toasts via Twenty session;
 *   fallback: /api/crm/chat/inbound-toasts via portal #voxlyChatToken)
 * Workspaces are provisioned by Voxly control plane, not from CRM UI.
 */
(function () {
  var MARKER = 'data-voxly-shell-ux';
  var CHAT_PIN = 'data-voxly-chat-pinned';
  var STYLE_ID = 'voxly-shell-ux-css-v3';
  var TOAST_ROOT_ID = 'voxly-inbound-toasts';
  var TOKEN_KEY = 'voxly_crm_chat_token';
  var SEEN_KEY = 'voxly_inbound_toast_seen';
  var API = '__VOXLY_API_URL__'.replace(/\/$/, '');
  var HIDE_RE =
    /^\s*\+?\s*(создать\s+рабочее\s+пространство|create(\s+a)?\s+workspace|create\s+your\s+workspace)\s*$/i;
  var CABINET_RE = /^\s*кабинет\s+voxly\s*$/i;
  var DEAL_CREATE_RE =
    /^\s*(new|новый|новая)\s+(возможност[ьи]|opportunit(y|ies)|сделк[аи])\s*$/i;
  var DEAL_CREATE_LABEL = 'Новая Сделка';
  var pollTimer = null;
  var toastSince = null;
  var shownIds = {};
  var openChatTarget = null;
  var lastChatSoftRefreshAt = 0;

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    // Note chips: keep chip as inline-flex (do NOT webkit-box the chip — that
    // collapses to the avatar initial «П»). Wrap only the label text.
    style.textContent = [
      '[id^="record-board-card-"][id*="-noteTargets"] {',
      '  max-width: 100% !important;',
      '  width: 100% !important;',
      '  min-width: 0 !important;',
      '}',
      '[id^="record-board-card-"][id*="-noteTargets"] [class*="_chip"] {',
      '  max-width: 100% !important;',
      '  width: auto !important;',
      '  height: auto !important;',
      '  min-height: 0 !important;',
      '  align-items: flex-start !important;',
      '  white-space: normal !important;',
      '  overflow: hidden !important;',
      '}',
      '[id^="record-board-card-"][id*="-noteTargets"] [class*="_overflowingText"] {',
      '  white-space: pre-wrap !important;',
      '  display: -webkit-box !important;',
      '  -webkit-box-orient: vertical !important;',
      '  -webkit-line-clamp: 5 !important;',
      '  line-clamp: 5 !important;',
      '  overflow: hidden !important;',
      '  text-overflow: unset !important;',
      '  max-width: 100% !important;',
      '  max-height: 7.5em !important;',
      '  line-height: 1.35 !important;',
      '  word-break: break-word !important;',
      '}',
      '[id^="record-board-card-"][id*="-noteTargets"] [data-voxly-shell-ux="note-extra"] {',
      '  display: none !important;',
      '}',
      '#' + TOAST_ROOT_ID + ' {',
      '  position: fixed;',
      '  left: 16px;',
      '  bottom: 16px;',
      '  z-index: 2147483000;',
      '  display: flex;',
      '  flex-direction: column-reverse;',
      '  gap: 8px;',
      '  max-width: min(360px, calc(100vw - 32px));',
      '  pointer-events: none;',
      '}',
      '#' + TOAST_ROOT_ID + ' .voxly-toast {',
      '  pointer-events: auto;',
      '  cursor: pointer;',
      '  background: #1c1c1c;',
      '  color: #f5f5f5;',
      '  border: 1px solid rgba(255,255,255,0.08);',
      '  border-radius: 10px;',
      '  padding: 10px 12px;',
      '  box-shadow: 0 8px 24px rgba(0,0,0,0.28);',
      '  font: 500 13px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif;',
      '  animation: voxlyToastIn 160ms ease-out;',
      '}',
      '#' + TOAST_ROOT_ID + ' .voxly-toast-nick {',
      '  font-weight: 650;',
      '  margin-bottom: 2px;',
      '  color: #fff;',
      '}',
      '#' + TOAST_ROOT_ID + ' .voxly-toast-text {',
      '  color: rgba(255,255,255,0.86);',
      '  white-space: pre-wrap;',
      '  word-break: break-word;',
      '  display: -webkit-box;',
      '  -webkit-box-orient: vertical;',
      '  -webkit-line-clamp: 4;',
      '  line-clamp: 4;',
      '  overflow: hidden;',
      '}',
      '@keyframes voxlyToastIn { from { opacity: 0; transform: translateY(8px);} to { opacity: 1; transform: none;} }',
    ].join('\n');
    document.documentElement.appendChild(style);
  }

  function textOf(el) {
    return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function hideCreateWorkspaceNodes(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll
      ? scope.querySelectorAll('button, a, [role="menuitem"], [role="option"], li, div')
      : [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || el.getAttribute(MARKER) === 'hidden') continue;
      var t = textOf(el);
      if (!t || t.length > 80) continue;
      if (!HIDE_RE.test(t)) continue;
      // Prefer hiding the clickable row, not a nested span-only match of a larger menu.
      var row = el.closest
        ? el.closest('[role="menuitem"], [role="option"], button, a, li') || el
        : el;
      if (row.getAttribute(MARKER) === 'hidden') continue;
      row.setAttribute(MARKER, 'hidden');
      row.style.setProperty('display', 'none', 'important');
      row.setAttribute('aria-hidden', 'true');
    }
  }

  /** Keep a single «Кабинет Voxly» entry in the working-area sidebar. */
  function dedupeCabinetNav() {
    var nodes = document.querySelectorAll('a, button, [role="link"], [role="menuitem"], li, div');
    var kept = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || el.getAttribute(MARKER) === 'cabinet-dup') continue;
      var t = textOf(el);
      if (!CABINET_RE.test(t)) continue;
      // Prefer the clickable leaf whose text is exactly the label (avoid parent wrappers).
      if (t.length > 40) continue;
      var row =
        (el.closest &&
          el.closest('[role="menuitem"], [role="link"], a, button, li')) ||
        el;
      if (row.getAttribute(MARKER) === 'cabinet-dup') continue;
      if (!kept) {
        kept = row;
        continue;
      }
      if (row === kept || kept.contains(row) || row.contains(kept)) continue;
      row.setAttribute(MARKER, 'cabinet-dup');
      row.style.setProperty('display', 'none', 'important');
      row.setAttribute('aria-hidden', 'true');
    }
  }

  /**
   * Twenty builds create CTA as «New/Новый {labelSingular}» (masculine template).
   * With Сделка that becomes «Новый Сделка»; force feminine «Новая Сделка».
   */
  function fixOpportunityCreateCta() {
    var nodes = document.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || el.getAttribute(MARKER) === 'deal-cta') continue;
      var t = textOf(el);
      if (!t || t.length > 48) continue;
      if (!DEAL_CREATE_RE.test(t)) continue;
      if (t === DEAL_CREATE_LABEL) {
        el.setAttribute(MARKER, 'deal-cta');
        continue;
      }
      // Prefer rewriting the leaf text node / span so button chrome stays intact.
      var target = el;
      var spans = el.querySelectorAll('span, div');
      for (var s = 0; s < spans.length; s++) {
        if (DEAL_CREATE_RE.test(textOf(spans[s])) && textOf(spans[s]).length <= 48) {
          target = spans[s];
          break;
        }
      }
      if (target.childNodes && target.childNodes.length === 1 && target.childNodes[0].nodeType === 3) {
        target.childNodes[0].nodeValue = DEAL_CREATE_LABEL;
      } else {
        target.textContent = DEAL_CREATE_LABEL;
      }
      el.setAttribute(MARKER, 'deal-cta');
    }
  }

  function deepHasAttr(root, attr, value) {
    if (!root) return false;
    var stack = [root];
    while (stack.length) {
      var node = stack.pop();
      if (!node || node.nodeType !== 1) continue;
      try {
        if (node.getAttribute && node.getAttribute(attr) === value) return true;
      } catch (e) {}
      if (node.shadowRoot) stack.push(node.shadowRoot);
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return false;
  }

  function isVoxlyChatCanvas(wrapper) {
    if (!wrapper) return false;
    // Reliable marker from chat-panel (works across GramJS/WA/Business).
    if (deepHasAttr(wrapper, 'data-voxly-crm-chat', '1')) return true;
    if (deepHasAttr(wrapper, 'data-voxly-ai-controls', '1')) return true;
    var t = wrapper.textContent || '';
    // Format toolbar + send are always visible text.
    // Do NOT rely on textarea placeholder («Ответ в…») — placeholders are not in textContent.
    // «Прикрепить» is missing on GramJS (supportsAttachments=false).
    if (t.indexOf('Отправить') !== -1 && t.indexOf('Жирный') !== -1) return true;
    return (
      t.indexOf('Прикрепить') !== -1 &&
      t.indexOf('Отправить') !== -1 &&
      t.indexOf('Жирный') !== -1
    );
  }

  /**
   * Twenty wraps CANVAS tabs in `.page-layout-scroll-wrapper { overflow: auto }`.
   * When the front component grows with messages, that outer scroller moves the
   * whole widget — including the composer. For Voxly Chat, lock the wrapper and
   * fill the widget; only the panel's middle message list should scroll.
   */
  function pinChatCanvasScroll() {
    var wrappers = document.querySelectorAll(
      '.page-layout-scroll-wrapper, [id^="scroll-wrapper-scroll-wrapper-page-layout"]',
    );
    for (var i = 0; i < wrappers.length; i++) {
      var w = wrappers[i];
      if (!isVoxlyChatCanvas(w)) {
        if (w.getAttribute(CHAT_PIN) === '1') {
          w.removeAttribute(CHAT_PIN);
          w.style.removeProperty('overflow');
          w.style.removeProperty('overflow-y');
          w.style.removeProperty('overflow-x');
          var oldPinned = w.querySelectorAll(
            '[' + CHAT_PIN + '-widget], [' + CHAT_PIN + '-wrap]',
          );
          for (var u = 0; u < oldPinned.length; u++) {
            oldPinned[u].removeAttribute(CHAT_PIN + '-widget');
            oldPinned[u].removeAttribute(CHAT_PIN + '-wrap');
            oldPinned[u].style.removeProperty('height');
            oldPinned[u].style.removeProperty('max-height');
            oldPinned[u].style.removeProperty('overflow');
            oldPinned[u].style.removeProperty('min-height');
            oldPinned[u].style.removeProperty('position');
          }
        }
        continue;
      }
      w.setAttribute(CHAT_PIN, '1');
      w.style.setProperty('overflow', 'hidden', 'important');
      w.style.setProperty('overflow-y', 'hidden', 'important');
      w.style.setProperty('overflow-x', 'hidden', 'important');
      var widgets = w.querySelectorAll('.widget');
      for (var j = 0; j < widgets.length; j++) {
        var widget = widgets[j];
        widget.setAttribute(CHAT_PIN + '-widget', '1');
        widget.style.setProperty('height', '100%', 'important');
        widget.style.setProperty('max-height', '100%', 'important');
        widget.style.setProperty('min-height', '0', 'important');
        widget.style.setProperty('overflow', 'hidden', 'important');
        widget.style.setProperty('position', 'relative', 'important');
        // Only host wrappers around the Remote DOM root (not message list / composer).
        var cur = widget;
        for (var depth = 0; depth < 3; depth++) {
          var child = cur.firstElementChild;
          if (!child) break;
          child.setAttribute(CHAT_PIN + '-wrap', '1');
          child.style.setProperty('height', '100%', 'important');
          child.style.setProperty('max-height', '100%', 'important');
          child.style.setProperty('min-height', '0', 'important');
          child.style.setProperty('overflow', 'hidden', 'important');
          child.style.setProperty('position', 'relative', 'important');
          cur = child;
        }
      }
    }
  }

  function expandKanbanNoteLines() {
    var boards = document.querySelectorAll(
      '[class*="RecordBoard"], [data-testid*="record-board"], [class*="record-board"]',
    );
    for (var b = 0; b < boards.length; b++) {
      var els = boards[b].querySelectorAll('div, span, p');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el || el.getAttribute(MARKER) === 'note-lines') continue;
        var cs = window.getComputedStyle(el);
        var clamp = cs.webkitLineClamp;
        if (clamp !== '1' && clamp !== '2') continue;
        var text = (el.innerText || '').trim();
        if (text.length < 24) continue;
        // Prefer note-ish rows (yellow «з» chip nearby or multiline body).
        var row = el.closest ? el.closest('div') : el;
        var near = row && row.parentElement ? row.parentElement.innerText || '' : text;
        if (near.indexOf('з') === -1 && text.indexOf('\n') === -1 && text.length < 60) {
          continue;
        }
        el.setAttribute(MARKER, 'note-lines');
        el.style.setProperty('-webkit-line-clamp', '5', 'important');
        el.style.setProperty('line-clamp', '5', 'important');
        el.style.setProperty('max-height', '7.5em', 'important');
        el.style.setProperty('white-space', 'pre-wrap', 'important');
        el.style.setProperty('overflow', 'hidden', 'important');
      }
    }
  }

  /** Keep only the first (latest via noteTarget.position) chip on board cards. */
  function hideExtraKanbanNotes() {
    var fields = document.querySelectorAll(
      '[id^="record-board-card-"][id*="-noteTargets"]',
    );
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      // Prefer per-chip link containers; never climb to the shared field root.
      var links = field.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) {
        var link = links[i];
        var wrap =
          (link.closest && link.closest('[class*="linkContainer"]')) ||
          (link.parentElement && link.parentElement !== field
            ? link.parentElement
            : link);
        // Bail if wrap is the field itself (would hide all chips).
        if (wrap === field) wrap = link;
        if (i === 0) {
          if (wrap.getAttribute(MARKER) === 'note-extra') {
            wrap.removeAttribute(MARKER);
            wrap.style.removeProperty('display');
          }
          continue;
        }
        wrap.setAttribute(MARKER, 'note-extra');
        wrap.style.setProperty('display', 'none', 'important');
      }
    }
  }

  function captureChatToken() {
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
        if (hash.indexOf('voxlyChatToken=') !== -1) {
          setTimeout(function () {
            try {
              history.replaceState(null, '', location.pathname + location.search);
            } catch (e) {}
          }, 800);
        }
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

  /** Twenty host session (localStorage) — enough for same-origin `/s/*` while logged in. */
  function getTwentyAccessToken() {
    try {
      var raw = localStorage.getItem('tokenPairState');
      if (!raw) return '';
      var parsed = JSON.parse(raw);
      var t =
        parsed &&
        parsed.accessOrWorkspaceAgnosticToken &&
        parsed.accessOrWorkspaceAgnosticToken.token;
      return typeof t === 'string' ? t : '';
    } catch (e) {
      return '';
    }
  }

  function apiUrlReady() {
    // Must NOT check for literal '__VOXLY_API_URL__' — Dockerfile sed replaces every
    // occurrence, which made `indexOf('__VOXLY_API_URL__') !== -1` always true (INC-041).
    return Boolean(API) && API.indexOf('__') === -1;
  }

  function loadSeen() {
    try {
      var raw = sessionStorage.getItem(SEEN_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') shownIds = parsed;
    } catch (e) {}
  }

  function saveSeen() {
    try {
      var keys = Object.keys(shownIds);
      if (keys.length > 80) {
        var trimmed = {};
        for (var i = keys.length - 60; i < keys.length; i++) {
          trimmed[keys[i]] = 1;
        }
        shownIds = trimmed;
      }
      sessionStorage.setItem(SEEN_KEY, JSON.stringify(shownIds));
    } catch (e) {}
  }

  function toastRoot() {
    var root = document.getElementById(TOAST_ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = TOAST_ROOT_ID;
    root.setAttribute(MARKER, 'toasts');
    document.body.appendChild(root);
    return root;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clickChatTab() {
    var nodes = document.querySelectorAll('button, a, [role="tab"], div, span');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var t = textOf(el);
      if (t !== 'Чат' && t !== 'Chat') continue;
      var tab =
        (el.closest && el.closest('button, a, [role="tab"]')) || el;
      try {
        tab.click();
        return true;
      } catch (e) {}
    }
    return false;
  }

  function openRecordChat(item) {
    var personId = item && item.personId;
    var opportunityId = item && item.opportunityId;
    var path = '';
    if (personId) path = '/object/person/' + personId;
    else if (opportunityId) path = '/object/opportunity/' + opportunityId;
    // No CRM link yet (sync pending / wipe) — do not navigate to a dead URL.
    if (!path) return;
    openChatTarget = { path: path, tries: 0 };
    if (location.pathname.indexOf(personId || opportunityId) === -1) {
      location.assign(path);
    } else {
      clickChatTab();
    }
  }

  function maybeOpenChatTab() {
    if (!openChatTarget) return;
    openChatTarget.tries += 1;
    if (location.pathname.indexOf('/object/') !== -1) {
      if (clickChatTab() || openChatTarget.tries > 40) {
        openChatTarget = null;
      }
    } else if (openChatTarget.tries > 40) {
      openChatTarget = null;
    }
  }

  function showToast(item) {
    if (!item || !item.id || shownIds[item.id]) return;
    shownIds[item.id] = 1;
    saveSeen();
    var root = toastRoot();
    var el = document.createElement('div');
    el.className = 'voxly-toast';
    el.setAttribute('role', 'status');
    var canOpen = !!(item.personId || item.opportunityId);
    if (!canOpen) {
      el.style.cursor = 'default';
      el.title = 'Лид ещё не создан в CRM';
    }
    el.innerHTML =
      '<div class="voxly-toast-nick">' +
      esc(item.nickname || 'Клиент') +
      '</div><div class="voxly-toast-text">' +
      esc(item.text || '') +
      '</div>';
    el.addEventListener('click', function () {
      try {
        el.remove();
      } catch (e) {}
      if (!canOpen) return;
      openRecordChat(item);
    });
    root.appendChild(el);
    setTimeout(function () {
      try {
        el.remove();
      } catch (e) {}
    }, 5000);
  }

  function currentCrmRecordId() {
    var m = String(location.pathname || '').match(
      /\/object\/(?:person|opportunity|company|companies)\/([0-9a-f-]{36})/i,
    );
    return m ? m[1] : null;
  }

  function findOpenChatCanvas() {
    var wrappers = document.querySelectorAll(
      '.page-layout-scroll-wrapper, [id^="scroll-wrapper-scroll-wrapper-page-layout"]',
    );
    for (var i = 0; i < wrappers.length; i++) {
      if (isVoxlyChatCanvas(wrappers[i])) return wrappers[i];
    }
    return null;
  }

  /** Remote DOM chat has no timers — host clicks «Обновить» so open chat stays live. */
  function clickOpenChatRefresh() {
    var canvas = findOpenChatCanvas();
    if (!canvas) return false;
    var marked = canvas.querySelector('[data-voxly-chat-refresh="1"]');
    if (marked) {
      try {
        marked.click();
        return true;
      } catch (e) {}
    }
    var nodes = canvas.querySelectorAll('button');
    for (var i = 0; i < nodes.length; i++) {
      if (textOf(nodes[i]) !== 'Обновить') continue;
      try {
        nodes[i].click();
        return true;
      } catch (e) {}
    }
    return false;
  }

  function toastMatchesOpenRecord(item) {
    var id = currentCrmRecordId();
    if (!id || !item) return false;
    return item.personId === id || item.opportunityId === id;
  }

  function applyToastPayload(data) {
    var items = (data && data.items) || [];
    var refreshOpen = false;
    for (var i = 0; i < items.length; i++) {
      showToast(items[i]);
      if (toastMatchesOpenRecord(items[i])) refreshOpen = true;
      if (items[i].sentAt && (!toastSince || items[i].sentAt > toastSince)) {
        toastSince = items[i].sentAt;
      }
    }
    if (refreshOpen) {
      clickOpenChatRefresh();
      lastChatSoftRefreshAt = Date.now();
    } else if (findOpenChatCanvas()) {
      // Soft live refresh while Chat tab is open (Remote DOM cannot setInterval).
      var now = Date.now();
      if (now - lastChatSoftRefreshAt >= 4500) {
        if (clickOpenChatRefresh()) lastChatSoftRefreshAt = now;
      }
    }
    if (data && data.serverTime && items.length === 0) {
      // Keep since advancing, but leave a wide skew so DB/Node clock drift
      // cannot skip a message that landed between polls (missed toast).
      var skew = new Date(new Date(data.serverTime).getTime() - 15000);
      if (!Number.isNaN(skew.getTime())) {
        var iso = skew.toISOString();
        if (!toastSince || iso > toastSince) toastSince = iso;
      }
    }
  }

  function fetchCrmApiToasts(qs, crmToken) {
    return fetch(API + '/api/crm/chat/inbound-toasts?' + qs, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + crmToken,
        Accept: 'application/json',
      },
      credentials: 'omit',
    }).then(function (res) {
      if (!res.ok) throw new Error('toast poll ' + res.status);
      return res.json();
    });
  }

  function pollInboundToasts() {
    captureChatToken();
    var crmToken = getToken();
    var twentyToken = getTwentyAccessToken();
    var apiReady = apiUrlReady();
    if (!twentyToken && !(crmToken && apiReady)) return;
    if (!toastSince) {
      toastSince = new Date(Date.now() - 15_000).toISOString();
    }
    var qs =
      'since=' +
      encodeURIComponent(toastSince) +
      '&limit=15';

    var req;
    if (twentyToken) {
      // Prefer same-origin logic proxy (service token server-side) — no portal hop.
      req = fetch('/s/crm-chat/inbound-toasts?' + qs, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + twentyToken,
          Accept: 'application/json',
        },
        credentials: 'include',
      }).then(function (res) {
        if (res.status === 404 || res.status === 501) {
          if (crmToken && apiReady) return fetchCrmApiToasts(qs, crmToken);
          throw new Error('toast proxy missing');
        }
        if (!res.ok) throw new Error('toast poll ' + res.status);
        return res.json().then(function (data) {
          // If route matched /crm-chat/:recordId by mistake, payload has messages not items.
          if (!data || !Array.isArray(data.items)) {
            if (crmToken && apiReady) return fetchCrmApiToasts(qs, crmToken);
            throw new Error('toast proxy shape');
          }
          return data;
        });
      });
    } else {
      req = fetchCrmApiToasts(qs, crmToken);
    }

    req.then(applyToastPayload).catch(function () {
      /* token missing / CORS / offline — silent */
    });
  }

  function tick() {
    ensureCss();
    hideCreateWorkspaceNodes(document);
    dedupeCabinetNav();
    fixOpportunityCreateCta();
    pinChatCanvasScroll();
    expandKanbanNoteLines();
    hideExtraKanbanNotes();
    maybeOpenChatTab();
  }

  function start() {
    ensureCss();
    loadSeen();
    captureChatToken();
    tick();
    var obs = new MutationObserver(function () {
      tick();
    });
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.addEventListener(
      'click',
      function () {
        setTimeout(tick, 0);
        setTimeout(tick, 50);
        setTimeout(tick, 200);
      },
      true,
    );
    window.addEventListener('resize', function () {
      setTimeout(tick, 0);
    });
    if (!pollTimer) {
      pollInboundToasts();
      pollTimer = setInterval(pollInboundToasts, 4000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
