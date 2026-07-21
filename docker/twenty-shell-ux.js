/* Voxly: Twenty shell UX tweaks (multiworkspace + CRM defaults).
 * - Hide «+ Создать рабочее пространство» / Create workspace in profile ⋯ menu
 * - Pin CRM «Чат» canvas: disable page-layout outer scroll so composer stays fixed
 * - Kanban note chips: body text via title label; ≥5 lines; only latest note visible
 * Workspaces are provisioned by Voxly control plane, not from CRM UI.
 */
(function () {
  var MARKER = 'data-voxly-shell-ux';
  var CHAT_PIN = 'data-voxly-chat-pinned';
  var STYLE_ID = 'voxly-shell-ux-css-v2';
  var HIDE_RE =
    /^\s*\+?\s*(создать\s+рабочее\s+пространство|create(\s+a)?\s+workspace|create\s+your\s+workspace)\s*$/i;

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

  function isVoxlyChatCanvas(wrapper) {
    if (!wrapper || !wrapper.textContent) return false;
    var t = wrapper.textContent;
    // Composer chrome from twenty-app/voxly-crm-chat chat-panel
    return (
      t.indexOf('Ответ в Telegram') !== -1 ||
      (t.indexOf('Прикрепить') !== -1 &&
        t.indexOf('Отправить') !== -1 &&
        t.indexOf('Жирный') !== -1)
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

  function tick() {
    ensureCss();
    hideCreateWorkspaceNodes(document);
    pinChatCanvasScroll();
    expandKanbanNoteLines();
    hideExtraKanbanNotes();
  }

  function start() {
    ensureCss();
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
