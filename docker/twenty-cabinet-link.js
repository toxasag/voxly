/* Voxly: floating «Кабинет» link back to saas-portal (injected into Twenty front) */
(function () {
  var HREF = '__VOXLY_CABINET_URL__';
  var ID = 'voxly-cabinet-link';

  function mount() {
    if (!document.body) return;
    var existing = document.getElementById(ID);
    if (existing) {
      if (existing.getAttribute('href') !== HREF) existing.setAttribute('href', HREF);
      // Keep above Twenty bottom action bar (Открыть / Настройки)
      existing.style.bottom = '88px';
      existing.style.right = '20px';
      existing.style.top = 'auto';
      return;
    }
    var a = document.createElement('a');
    a.id = ID;
    a.href = HREF;
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'Вернуться в кабинет Voxly');
    a.textContent = '← Кабинет';
    a.style.cssText = [
      'position:fixed',
      'bottom:88px',
      'right:20px',
      'z-index:2147483646',
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'padding:10px 14px',
      'border-radius:10px',
      'border:1px solid rgba(0,0,0,0.08)',
      'background:#1c1c1c',
      'color:#fff',
      'font:600 13px/1.2 Inter,ui-sans-serif,system-ui,sans-serif',
      'text-decoration:none',
      'box-shadow:0 4px 16px rgba(0,0,0,0.18)',
      'cursor:pointer',
      'transition:transform 120ms ease,background 120ms ease',
    ].join(';');
    a.onmouseenter = function () {
      a.style.transform = 'translateY(-1px)';
      a.style.background = '#000';
    };
    a.onmouseleave = function () {
      a.style.transform = 'none';
      a.style.background = '#1c1c1c';
    };
    document.body.appendChild(a);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
  setInterval(mount, 2500);
})();
