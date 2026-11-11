// Hides "Open App" / "Get the app" buttons, banners and dialogs that class-name CSS misses.
// Matches on what the control does (links to an app or the App Store) or says, not on class names.
// Only newly added nodes are checked, so long pages with endless feeds stay fast.
(() => {
  const APP_LINK = /^(youtube|vnd\.youtube|youtubemusic|intent|itms-apps?|twitch|reddit|instagram|fb|twitter):/i;
  const STORE_LINK = /(apps\.apple\.com|itunes\.apple\.com|\.app\.link\/|onelink\.me\/)/i;
  const LABEL = /^(open( in)?( the)? app|get( the)? app|use( the)? app|switch to( the)? app|open youtube|open youtube music)$/i;
  const CONTROLS = 'a[href], button, [role="button"]';

  const label = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');

  const check = (el) => {
    const href = el.getAttribute('href') || '';
    if (APP_LINK.test(href) || STORE_LINK.test(href) || (el.textContent.length < 40 && LABEL.test(label(el)))) {
      const target = el.closest('ytm-button-renderer, ytmusic-button-renderer, button, a') || el;
      target.style.setProperty('display', 'none', 'important');
    }
  };

  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches(CONTROLS)) check(node);
    if (node.firstElementChild) node.querySelectorAll(CONTROLS).forEach(check);
  };

  new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(scan);
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => scan(document.documentElement));
})();
