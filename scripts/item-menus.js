// Long-press an item (a video, song, album, playlist) to get the site's own ⋮ menu as a native menu, like the
// YouTube and YouTube Music apps. The ⋮ buttons themselves are hidden (item-menus.css).
// - On a long press the app is told at once (`abtNav` message `itemMenu`: the finger, the item's link and preview),
//   so its native menu opens every time, straight away, with its own entries.
// - Meanwhile the item's ⋮ menu is opened invisibly (html.abt-menu-hidden) and its entries are read; they follow
//   as `itemMenuEntries` (empty if the site's menu never came) and join the native menu.
// - The app calls `__abtMenu.choose(index)` to press the real entry, or `__abtMenu.close()` when dismissed.
(() => {
  if (window.__abtMenu) return;
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };

  const MUSIC = location.hostname.startsWith('music.');
  const S = MUSIC ? {
    item: 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-player-queue-item',
    button: 'ytmusic-menu-renderer button, ytmusic-menu-renderer yt-icon-button, ytmusic-menu-renderer tp-yt-paper-icon-button',
    entries: () => [...document.querySelectorAll('ytmusic-menu-popup-renderer ytmusic-menu-navigation-item-renderer, ' +
      'ytmusic-menu-popup-renderer ytmusic-menu-service-item-renderer, ' +
      'ytmusic-menu-popup-renderer ytmusic-toggle-menu-service-item-renderer, ' +
      'ytmusic-menu-popup-renderer ytmusic-menu-service-item-download-renderer')],
    close: 'tp-yt-iron-overlay-backdrop',
  } : {
    item: 'ytm-rich-item-renderer, ytm-video-with-context-renderer, ytm-compact-video-renderer, ' +
      'ytm-playlist-video-renderer, ytm-shorts-lockup-view-model, yt-lockup-view-model, ytm-reel-item-renderer',
    button: 'button[aria-label="More actions"], button[aria-label="Action menu"], ytm-menu-renderer button',
    // Every sheet is searched (the page keeps empty sheet containers around too, some nested in others), and
    // each entry is counted once.
    entries: () => [...new Set([...document.querySelectorAll('.ytSpecBottomSheetLayoutHost, bottom-sheet-container, ' +
      'ytm-bottom-sheet-renderer')].flatMap((sheet) => [...sheet.querySelectorAll('yt-list-item-view-model, ytm-menu-item, ' +
      'ytm-menu-service-item-renderer, ytm-menu-navigation-item-renderer')]))],
    close: 'ytw-scrim, .bottom-sheet-overlay, c3-overlay',
  };

  const HOLD_MS = 450;
  const MOVE_CANCEL_PX = 10;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const shown = (el) => el.getClientRects().length > 0;
  const label = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ');

  let timer = null;
  let start = null;
  // The pressed item sinks a little while the finger holds, like an iOS context menu building up.
  let pressed = null;
  const press = (item) => {
    release();
    pressed = item;
    item.style.transition = `transform ${HOLD_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
    item.style.transformOrigin = 'center';
    item.style.transform = 'scale(0.95)';
  };
  const release = () => {
    if (!pressed) return;
    const item = pressed;
    pressed = null;
    item.style.transition = 'transform 220ms cubic-bezier(0.2, 0, 0, 1)';
    item.style.transform = '';
  };
  let firedAt = 0;
  let current = [];

  const hide = (on) => document.documentElement.classList.toggle('abt-menu-hidden', on);
  // The site's menu is open invisibly, waiting for the app. While the app shows its menu, its overlay covers the
  // page, so a new touch reaching the page means the app's menu isn't up (it never appeared, or went without
  // telling the page). Left open, the invisible scrim would swallow every touch and the page would look frozen.
  let waiting = false;

  // The pressed item, for the app's preview card above the menu: its title, the line under it and its artwork.
  const TITLE = MUSIC
    ? '.title, .title-column .title, yt-formatted-string.title'
    : 'h3, .media-item-headline, [class*="LockupMetadataViewModelTitle"], [class*="lockup-metadata-view-model__title"], .yt-core-attributed-string';
  const SUBTITLE = MUSIC
    ? '.subtitle, .secondary-flex-columns, .details'
    : '[class*="ContentMetadataViewModelMetadataRow"], .media-item-byline, [class*="metadata-row"]';
  const preview = (item) => {
    const titleEl = item.querySelector(TITLE);
    const subtitleEl = item.querySelector(SUBTITLE);
    const image = [...item.querySelectorAll('img')].find((img) => (img.currentSrc || img.src || '').startsWith('http')
      && img.getBoundingClientRect().width > 30);
    const rect = (image || item).getBoundingClientRect();
    return {
      title: label(titleEl),
      subtitle: label(subtitleEl).slice(0, 120),
      image: image ? image.currentSrc || image.src : null,
      wide: rect.width > rect.height * 1.25,
    };
  };

  // Each long press gets an id, so late entries from an earlier press (or one the user already dismissed) are dropped.
  let menuID = 0;
  let cancelled = false;
  const open = async (item, point) => {
    const button = item.querySelector(S.button);
    if (!button) return;
    const link = item.querySelector('a[href*="watch?v="], a[href*="/shorts/"], a[href*="playlist?list="], a[href*="browse/"], a[href*="channel/"]');
    const id = ++menuID;
    cancelled = false;
    current = [];
    waiting = true;
    post({ type: 'itemMenu', id, x: point.x, y: point.y, href: link ? link.href : null, preview: preview(item) });
    hide(true);
    button.click();
    let entries = [];
    for (let i = 0; i < 40 && !entries.length && !cancelled && id === menuID; i += 1) {
      await sleep(40);
      entries = S.entries().filter(shown).filter((el) => label(el));
    }
    if (id !== menuID) return;
    if (cancelled) { closeSiteMenu(); return; }
    current = entries;
    if (!entries.length) { waiting = false; hide(false); }
    post({ type: 'itemMenuEntries', id, items: entries.map(label) });
  };

  document.addEventListener('touchstart', (event) => {
    if (waiting && event.isTrusted) window.__abtMenu.close();
    clearTimeout(timer);
    timer = null;
    if (event.touches.length !== 1 || window.__abtSpeedHolding) return;
    const item = event.target.closest && event.target.closest(S.item);
    if (!item || !item.querySelector(S.button)) return;
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
    press(item);
    timer = setTimeout(() => {
      timer = null;
      release();
      firedAt = Date.now();
      open(item, start);
    }, HOLD_MS);
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!timer || !start) return;
    const touch = event.touches[0];
    if (touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_CANCEL_PX) {
      clearTimeout(timer);
      timer = null;
      release();
    }
  }, { capture: true, passive: true });

  // Only real touches: the script's own clicks (opening the ⋮ menu, choosing an entry) must go through.
  // However long the finger stays down after the menu opens, the lift (and the click it makes) doesn't open the item.
  let liftedAt = 0;
  const holdActive = () => firedAt > liftedAt || Date.now() - liftedAt < 500;
  // On the window, capturing, and registered before the site's own scripts: YouTube Music opens a song from its
  // own window-level tap handling, which a document-level stop came too late for.
  const swallowAfterHold = (event) => {
    if (event.isTrusted && firedAt && holdActive()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  window.addEventListener('touchend', (event) => {
    if (timer) { clearTimeout(timer); timer = null; release(); return; }
    swallowAfterHold(event);
    if (firedAt > liftedAt) liftedAt = Date.now();
  }, { capture: true, passive: false });
  for (const type of ['pointerup', 'mouseup', 'click']) window.addEventListener(type, swallowAfterHold, true);
  document.addEventListener('contextmenu', (event) => { if (Date.now() - firedAt < 2000) event.preventDefault(); }, true);

  const closeSiteMenu = () => {
    current = [];
    waiting = false;
    // The open sheet's own backdrop: the page keeps stale, hidden ones around too.
    const backdrop = [...document.querySelectorAll(S.close)].find(shown);
    if (backdrop) backdrop.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    setTimeout(() => hide(false), 300);
  };

  window.__abtMenu = {
    choose(index) {
      const el = current[index];
      current = [];
      waiting = false;
      if (!el) { this.close(); return false; }
      const target = el.querySelector('a, button, tp-yt-paper-item, [role="menuitem"]') || el;
      target.click();
      // The menu closes itself; whatever it opens next (e.g. "Save to playlist") shows normally.
      setTimeout(() => hide(false), 250);
      return true;
    },
    close() {
      cancelled = true;
      closeSiteMenu();
      return true;
    },
  };
})();
