/* Voxly: Twenty shell UX tweaks (multiworkspace + CRM defaults).
 * - Hide «+ Создать рабочее пространство» / Create workspace in profile ⋯ menu
 * - Clarify top-left workspace switcher (slug «john») vs logged-in member
 * - Pin CRM «Чат» canvas: disable page-layout outer scroll so composer stays fixed
 * - Kanban note chips: body text via title label; ≥5 lines; only latest note visible
 * - Deduplicate sidebar «Кабинет Voxly» (keep first)
 * - Opportunity create CTA: «New/Новый …» → «Новая Сделка» (Twenty template is masculine New)
 * - Left inbound-message toasts (prefer /s/crm-chat/inbound-toasts via Twenty session;
 *   fallback: /api/crm/chat/inbound-toasts via portal #voxlyChatToken)
 * - Unread inbound badges on Opportunity/Person board+list cards + «Чат» tab
 *   (poll /s/crm-chat/unread-badges; mark-read when Chat tab loads history)
 * Workspaces are provisioned by Voxly control plane, not from CRM UI.
 */
(function () {
  var MARKER = 'data-voxly-shell-ux';
  var CHAT_PIN = 'data-voxly-chat-pinned';
  var STYLE_ID = 'voxly-shell-ux-css-v5';
  var TOAST_ROOT_ID = 'voxly-inbound-toasts';
  var MEMBER_CHIP_ID = 'voxly-current-member-chip';
  var UNREAD_ATTR = 'data-voxly-unread-id';
  var TOKEN_KEY = 'voxly_crm_chat_token';
  var SEEN_KEY = 'voxly_inbound_toast_seen';
  var API = '__VOXLY_API_URL__'.replace(/\/$/, '');
  var HIDE_RE =
    /^\s*\+?\s*(создать\s+рабочее\s+пространство|create(\s+a)?\s+workspace|create\s+your\s+workspace)\s*$/i;
  var CABINET_RE = /^\s*кабинет\s+voxly\s*$/i;
  var DEAL_CREATE_RE =
    /^\s*(new|новый|новая)\s+(возможност[ьи]|opportunit(y|ies)|сделк[аи])\s*$/i;
  var DEAL_CREATE_LABEL = 'Новая Сделка';
  var CRM_WS_PREFIX = 'CRM · ';
  var pollTimer = null;
  var toastSince = null;
  var shownIds = {};
  var openChatTarget = null;
  var lastChatSoftRefreshAt = 0;
  /** @type {Record<string, number>} */
  var unreadById = {};
  var lastUnreadPollAt = 0;
  var memberNameCache = null;
  var memberNameFetchedAt = 0;
  var memberNameInFlight = false;

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
      /* Unread chat badges on board/list/chat tab */
      '.voxly-unread-badge {',
      '  position: absolute;',
      '  top: 6px;',
      '  right: 6px;',
      '  z-index: 5;',
      '  min-width: 18px;',
      '  height: 18px;',
      '  padding: 0 5px;',
      '  border-radius: 9px;',
      '  background: #e11d48;',
      '  color: #fff;',
      '  font: 650 11px/18px ui-sans-serif, system-ui, -apple-system, sans-serif;',
      '  text-align: center;',
      '  pointer-events: none;',
      '  box-shadow: 0 1px 2px rgba(0,0,0,0.18);',
      '}',
      '.voxly-unread-badge[data-voxly-unread-inline="1"] {',
      '  position: static;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  margin-left: 6px;',
      '  vertical-align: middle;',
      '  box-shadow: none;',
      '}',
      '[data-voxly-unread-host="1"] {',
      '  position: relative !important;',
      '}',
      '#' + MEMBER_CHIP_ID + ' {',
      '  display: block;',
      '  margin: 2px 12px 8px;',
      '  padding: 0 2px;',
      '  font: 500 11px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif;',
      '  color: rgba(0,0,0,0.55);',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  pointer-events: none;',
      '}',
      '[data-theme="dark"] #' + MEMBER_CHIP_ID + ', html.dark #' + MEMBER_CHIP_ID + ' {',
      '  color: rgba(255,255,255,0.62);',
      '}',
    ].join('\n');
    document.documentElement.appendChild(style);
  }

  function textOf(el) {
    return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  /** Hostname `{slug}-crm.…` → slug used as Twenty workspace displayName. */
  function crmWorkspaceSlug() {
    try {
      var host = (location.hostname || '').toLowerCase();
      var m = host.match(/^([a-z0-9-]+)-crm\./);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Top-left MultiWorkspaceDropdown shows workspace displayName (often = slug «john»),
   * not the logged-in member — invitees confuse it with their profile.
   * Prefix with «CRM · » and set a clarifying title.
   */
  function clarifyWorkspaceSwitcher() {
    var slug = crmWorkspaceSlug();
    if (!slug) return;
    var nodes = document.querySelectorAll('button, [role="button"], a, div, span');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el) continue;
      var t = textOf(el);
      if (!t) continue;
      var bare = t.indexOf(CRM_WS_PREFIX) === 0 ? t.slice(CRM_WS_PREFIX.length) : t;
      if (bare.toLowerCase() !== slug) continue;
      if (t.length > 40) continue;
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (rect && (rect.top > 120 || rect.left > 320 || rect.width > 280)) continue;
      var labelEl = el;
      if (el.children && el.children.length) {
        for (var c = 0; c < el.children.length; c++) {
          var child = el.children[c];
          var ct = textOf(child);
          var cbare =
            ct.indexOf(CRM_WS_PREFIX) === 0 ? ct.slice(CRM_WS_PREFIX.length) : ct;
          if (cbare && cbare.toLowerCase() === slug) {
            labelEl = child;
            break;
          }
        }
      }
      if (textOf(labelEl).toLowerCase() === slug) {
        labelEl.textContent = CRM_WS_PREFIX + slug;
      }
      var row =
        (el.closest && el.closest('button, [role="button"], a')) || el;
      if (row.getAttribute(MARKER) !== 'ws-label') {
        row.setAttribute(MARKER, 'ws-label');
        row.setAttribute(
          'title',
          'Рабочее пространство CRM («' +
            slug +
            '»). Это не ваш профиль — имя сотрудника ниже / в Настройках.',
        );
      }
      break;
    }
  }

  function formatMemberChipName(data) {
    if (!data || typeof data !== 'object') return '';
    var name = data.name || data;
    var first =
      (name && (name.firstName || name.first_name)) ||
      data.firstName ||
      '';
    var last =
      (name && (name.lastName || name.last_name)) || data.lastName || '';
    var full = [first, last]
      .map(function (s) {
        return String(s || '').trim();
      })
      .filter(Boolean)
      .join(' ')
      .trim();
    if (full) return full;
    var email = String(data.userEmail || data.email || '').trim();
    if (email.indexOf('@') !== -1) return email.split('@')[0];
    return email;
  }

  function paintMemberChip(name) {
    if (!name) return;
    var existing = document.getElementById(MEMBER_CHIP_ID);
    if (existing) {
      existing.textContent = 'Вы: ' + name;
      return;
    }
    var chip = document.createElement('div');
    chip.id = MEMBER_CHIP_ID;
    chip.setAttribute(MARKER, 'member-chip');
    chip.textContent = 'Вы: ' + name;
    // Prefer under the top of the left navigation drawer.
    var nav =
      document.querySelector('nav') ||
      document.querySelector('[class*="navigation-drawer"]') ||
      document.querySelector('[class*="NavigationDrawer"]');
    if (nav && nav.firstChild) {
      // Insert after the first header block when possible.
      var header = nav.firstElementChild;
      if (header && header.nextSibling) {
        nav.insertBefore(chip, header.nextSibling);
      } else {
        nav.insertBefore(chip, nav.firstChild);
      }
      return;
    }
    document.body.appendChild(chip);
  }

  function fetchCurrentMemberName() {
    var now = Date.now();
    if (memberNameCache) {
      paintMemberChip(memberNameCache);
      return;
    }
    if (memberNameInFlight) return;
    if (now - memberNameFetchedAt < 15000 && memberNameFetchedAt > 0) return;
    var token = getTwentyAccessToken();
    if (!token) return;
    memberNameInFlight = true;
    memberNameFetchedAt = now;
    var queries = [
      {
        query:
          'query { currentWorkspaceMember { name { firstName lastName } userEmail } }',
        pick: function (j) {
          return j && j.data && j.data.currentWorkspaceMember;
        },
      },
      {
        query:
          'query { currentUser { firstName lastName email fullName } }',
        pick: function (j) {
          return j && j.data && j.data.currentUser;
        },
      },
    ];
    var i = 0;
    function tryNext() {
      if (i >= queries.length) {
        memberNameInFlight = false;
        return;
      }
      var q = queries[i++];
      fetch('/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ query: q.query }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (json) {
          var raw = q.pick(json);
          var name = formatMemberChipName(raw);
          if (name) {
            memberNameCache = name;
            memberNameInFlight = false;
            paintMemberChip(name);
            return;
          }
          tryNext();
        })
        .catch(function () {
          tryNext();
        });
    }
    tryNext();
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
   * Chat messages list must open on the LATEST message. Remote DOM proxies make
   * in-component scrollTop/scrollIntoView unreliable — the host scrolls the REAL
   * element. Sticks to bottom on open / thread switch / new messages; respects
   * the user manually scrolling up (no jump while reading history).
   */
  var chatListScrollState = new WeakMap();

  function scrollChatListToLatest() {
    var canvas = findOpenChatCanvas();
    if (!canvas) return;
    var lists = canvas.querySelectorAll('[data-voxly-chat-list="1"]');
    for (var i = 0; i < lists.length; i++) {
      var el = lists[i];
      var st = chatListScrollState.get(el);
      if (!st) {
        st = { h: 0, bottom: true };
        chatListScrollState.set(el, st);
      }
      var sh = el.scrollHeight;
      var ch = el.clientHeight;
      if (sh !== st.h) {
        // Content changed (open / thread switch / new message).
        if (st.bottom || st.h === 0) {
          try {
            el.scrollTop = sh;
          } catch (e) {}
        }
        st.h = sh;
      }
      st.bottom = ch === 0 || sh - el.scrollTop - ch < 48;
    }
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
      // Optimistic: Chat open + inbound → API marks lastOperatorReadAt; clear local badge.
      var openId = currentCrmRecordId();
      if (openId && unreadById[openId]) {
        delete unreadById[openId];
        paintUnreadBadges();
      }
    } else if (findOpenChatCanvas()) {
      // Soft live refresh while Chat tab is open (Remote DOM cannot setInterval).
      var now = Date.now();
      if (now - lastChatSoftRefreshAt >= 4500) {
        if (clickOpenChatRefresh()) {
          lastChatSoftRefreshAt = now;
          var softId = currentCrmRecordId();
          if (softId && unreadById[softId]) {
            delete unreadById[softId];
            paintUnreadBadges();
          }
        }
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

  function formatUnreadLabel(n) {
    var c = Number(n) || 0;
    if (c <= 0) return '';
    if (c > 99) return '99+';
    return String(c);
  }

  function applyUnreadPayload(data) {
    var next = {};
    var lists = [
      (data && data.opportunities) || [],
      (data && data.persons) || [],
    ];
    for (var li = 0; li < lists.length; li++) {
      var arr = lists[li];
      for (var i = 0; i < arr.length; i++) {
        var row = arr[i];
        if (!row || !row.id || !(row.count > 0)) continue;
        var id = String(row.id);
        next[id] = (next[id] || 0) + Number(row.count);
      }
    }
    unreadById = next;
    paintUnreadBadges();
  }

  function ensureUnreadBadge(host, recordId, inline) {
    if (!host || !recordId) return;
    var count = unreadById[recordId];
    var label = formatUnreadLabel(count);
    var existing = null;
    var kids = host.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].getAttribute && kids[i].getAttribute(UNREAD_ATTR) === recordId) {
        existing = kids[i];
        break;
      }
    }
    if (!label) {
      if (existing) {
        try {
          existing.remove();
        } catch (e) {}
      }
      if (host.getAttribute('data-voxly-unread-host') === '1') {
        host.removeAttribute('data-voxly-unread-host');
      }
      return;
    }
    if (!inline) host.setAttribute('data-voxly-unread-host', '1');
    if (!existing) {
      existing = document.createElement('span');
      existing.className = 'voxly-unread-badge';
      existing.setAttribute(UNREAD_ATTR, recordId);
      existing.setAttribute(MARKER, 'unread');
      existing.setAttribute('aria-label', 'Непрочитанных сообщений: ' + label);
      if (inline) existing.setAttribute('data-voxly-unread-inline', '1');
      host.appendChild(existing);
    }
    if (existing.textContent !== label) existing.textContent = label;
  }

  function findBoardCardRoot(el) {
    if (!el || !el.closest) return null;
    return (
      el.closest('[data-testid="record-board-card"]') ||
      el.closest('[class*="RecordBoardCard"]') ||
      el.closest('[class*="record-board-card"]') ||
      null
    );
  }

  function findBoardCardHost(fieldEl) {
    if (!fieldEl) return null;
    var card = findBoardCardRoot(fieldEl);
    if (card) return card;
    // Fallback: climb a few parents from field cell id=record-board-card-{uuid}-*
    var el = fieldEl;
    for (var i = 0; i < 8 && el; i++) {
      if (el.parentElement) el = el.parentElement;
      else break;
      if (
        el.getAttribute &&
        (el.getAttribute('data-testid') === 'record-board-card' ||
          (el.className && String(el.className).indexOf('BoardCard') !== -1))
      ) {
        return el;
      }
    }
    return null;
  }

  function boardFieldRecordId(el) {
    var m = String((el && el.id) || '').match(
      /^record-board-card-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i,
    );
    return m ? { id: m[1], field: m[2] } : null;
  }

  function preferBoardTitleField(recordId) {
    var preferred = ['name', 'Name', 'fullnameName', 'fullnamename'];
    for (var i = 0; i < preferred.length; i++) {
      var el = document.getElementById(
        'record-board-card-' + recordId + '-' + preferred[i],
      );
      if (el) return el;
    }
    var fields = document.querySelectorAll(
      '[id^="record-board-card-' + recordId + '-"]',
    );
    return fields.length ? fields[0] : null;
  }

  /** Skip secondary board fields (emails, phones, dates) — badge only on title/name. */
  function isSecondaryRecordLink(link) {
    if (!link || !link.closest) return false;
    var fieldEl = link.closest('[id^="record-board-card-"]');
    var meta = boardFieldRecordId(fieldEl);
    if (meta && meta.field) {
      var f = String(meta.field).toLowerCase();
      if (f === 'name' || f === 'fullnamename') return false;
      return true;
    }
    return false;
  }

  function paintUnreadBadges() {
    // While Chat canvas is open for a record, treat it as read locally so the
    // next poll does not flash badges before lastOperatorReadAt commits.
    var openId = currentCrmRecordId();
    if (openId && findOpenChatCanvas() && unreadById[openId]) {
      delete unreadById[openId];
    }

    // Drop badges for ids that are no longer unread.
    var stale = document.querySelectorAll('[' + UNREAD_ATTR + ']');
    for (var s = 0; s < stale.length; s++) {
      var sid = stale[s].getAttribute(UNREAD_ATTR);
      if (!sid || !unreadById[sid]) {
        var host = stale[s].parentElement;
        try {
          stale[s].remove();
        } catch (e) {}
        if (host && host.getAttribute('data-voxly-unread-host') === '1') {
          if (!host.querySelector('[' + UNREAD_ATTR + ']')) {
            host.removeAttribute('data-voxly-unread-host');
          }
        }
      }
    }

    /** @type {Record<string, 1>} one badge per CRM record id */
    var painted = {};

    // Kanban / board: exactly one badge on the card root (title field preferred).
    var boardIds = {};
    var fields = document.querySelectorAll('[id^="record-board-card-"]');
    for (var i = 0; i < fields.length; i++) {
      var meta = boardFieldRecordId(fields[i]);
      if (!meta || !unreadById[meta.id]) continue;
      boardIds[meta.id] = 1;
    }
    var boardIdList = Object.keys(boardIds);
    for (var bi = 0; bi < boardIdList.length; bi++) {
      var rid = boardIdList[bi];
      if (painted[rid]) continue;
      var titleField = preferBoardTitleField(rid);
      var cardHost = findBoardCardHost(titleField) || findBoardCardRoot(titleField);
      if (!cardHost && titleField) {
        // Last resort: badge inline next to the name field only (not every field).
        painted[rid] = 1;
        ensureUnreadBadge(titleField, rid, true);
        continue;
      }
      if (!cardHost) continue;
      painted[rid] = 1;
      ensureUnreadBadge(cardHost, rid, false);
    }

    // Table / show-page links — never re-badge inside a board card (causes
    // duplicate «2» on title + date + person chip). One host per record id.
    var links = document.querySelectorAll(
      'a[href*="/object/person/"], a[href*="/object/opportunity/"]',
    );
    for (var j = 0; j < links.length; j++) {
      if (findBoardCardRoot(links[j])) continue;
      var href = String(links[j].getAttribute('href') || '');
      var lm = href.match(
        /\/object\/(?:person|opportunity)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
      );
      if (!lm) continue;
      var lid = lm[1];
      if (!unreadById[lid] || painted[lid]) continue;
      if (isSecondaryRecordLink(links[j])) continue;
      var row =
        (links[j].closest &&
          (links[j].closest('tr') ||
            links[j].closest('[data-testid*="row"]') ||
            links[j].closest('[class*="RecordTableRow"]'))) ||
        null;
      painted[lid] = 1;
      if (row) ensureUnreadBadge(row, lid, false);
      else ensureUnreadBadge(links[j], lid, true);
    }

    // «Чат» tab on open Person/Opportunity record.
    var chatTabs = document.querySelectorAll(
      'button, a, [role="tab"], div, span',
    );
    var chatHost = null;
    for (var k = 0; k < chatTabs.length; k++) {
      var t = textOf(chatTabs[k]);
      // Exact label; ignore long wrappers that merely contain «Чат».
      if (t !== 'Чат' && t !== 'Chat') continue;
      chatHost =
        (chatTabs[k].closest &&
          chatTabs[k].closest('button, a, [role="tab"]')) ||
        chatTabs[k];
      break;
    }
    if (chatHost) {
      if (openId && unreadById[openId]) {
        ensureUnreadBadge(chatHost, openId, true);
      } else {
        var old = chatHost.querySelector('[' + UNREAD_ATTR + ']');
        if (old) {
          try {
            old.remove();
          } catch (e2) {}
        }
      }
    }
  }

  function fetchCrmApiUnread(crmToken) {
    return fetch(API + '/api/crm/chat/unread-badges', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + crmToken,
        Accept: 'application/json',
      },
      credentials: 'omit',
    }).then(function (res) {
      if (!res.ok) throw new Error('unread poll ' + res.status);
      return res.json();
    });
  }

  function pollUnreadBadges() {
    captureChatToken();
    var crmToken = getToken();
    var twentyToken = getTwentyAccessToken();
    var apiReady = apiUrlReady();
    if (!twentyToken && !(crmToken && apiReady)) return;

    var req;
    if (twentyToken) {
      req = fetch('/s/crm-chat/unread-badges', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + twentyToken,
          Accept: 'application/json',
        },
        credentials: 'include',
      }).then(function (res) {
        if (res.status === 404 || res.status === 501) {
          if (crmToken && apiReady) return fetchCrmApiUnread(crmToken);
          throw new Error('unread proxy missing');
        }
        if (!res.ok) throw new Error('unread poll ' + res.status);
        return res.json().then(function (data) {
          if (
            !data ||
            (!Array.isArray(data.opportunities) && !Array.isArray(data.persons))
          ) {
            if (crmToken && apiReady) return fetchCrmApiUnread(crmToken);
            throw new Error('unread proxy shape');
          }
          return data;
        });
      });
    } else {
      req = fetchCrmApiUnread(crmToken);
    }

    req.then(applyUnreadPayload).catch(function () {
      /* silent */
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
    clarifyWorkspaceSwitcher();
    fetchCurrentMemberName();
    dedupeCabinetNav();
    fixOpportunityCreateCta();
    pinChatCanvasScroll();
    scrollChatListToLatest();
    expandKanbanNoteLines();
    hideExtraKanbanNotes();
    maybeOpenChatTab();
    paintUnreadBadges();
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
      pollUnreadBadges();
      pollTimer = setInterval(function () {
        pollInboundToasts();
        // Unread is cheaper to skip occasionally; still refresh ~every 8s.
        var now = Date.now();
        if (now - lastUnreadPollAt >= 8000) {
          lastUnreadPollAt = now;
          pollUnreadBadges();
        }
      }, 4000);
      lastUnreadPollAt = Date.now();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
