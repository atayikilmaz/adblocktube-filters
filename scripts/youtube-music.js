// YouTube Music behaves like the Music app: the app's own mini player stands in for YouTube Music's bar (the bar is
// hidden in youtube-music.css), tapping it opens YouTube Music's player page, a swipe down closes that page, and the
// lock screen shows next / previous track instead of skipping 10 seconds.
(() => {
  if (window.__abtMusic) return;

  const layout = () => document.querySelector('ytmusic-app-layout');
  // Newer YouTube Music reports the player's state in `player-ui-state` (INACTIVE, PLAYER_BAR_ONLY,
  // PLAYER_PAGE_OPEN, FULLSCREEN, …) on the layout and on the player page; older versions set `player-page-open`.
  const isPlayerPageOpen = () => {
    const el = layout() || document.querySelector('ytmusic-player-page');
    if (!el) return false;
    const state = el.getAttribute('player-ui-state');
    return state ? /PAGE_OPEN|FULLSCREEN/.test(state) : el.hasAttribute('player-page-open');
  };

  // Marks the page while the player page is open, for youtube-music.css (which hides YouTube Music's own bottom
  // bar otherwise, since the app's mini player replaces it). Watches only the layout element's attributes.
  // YouTube Music can replace the layout element (after some navigations), which left the mark stale and its own
  // bar showing under the app's mini player; a cheap check re-attaches to the current element.
  const syncPageClass = () => {
    const open = isPlayerPageOpen();
    if (document.documentElement.classList.contains('abt-ytm-page-open') !== open) {
      document.documentElement.classList.toggle('abt-ytm-page-open', open);
      // The app hides its mini player while the page's own full player is up (no second player under it).
      try { window.webkit.messageHandlers.abtNav.postMessage({ type: 'playerPage', open }); } catch (_) {}
    }
    syncUnderBars();
  };
  // Some accounts get a layout that scrolls inside a full-height box instead of scrolling the page. WebKit keeps
  // such a box out of the area under the app's bottom bars, which then showed as an empty band. The app lets the
  // page run under its bars instead and gives their height in `--abt-bottom-bars`; youtube-music.css pads the
  // scrolling box by it so the last items still scroll clear of the bars. Not while the player page is open: it
  // lays itself out to the bottom edge, so it stays above the bars as before.
  const isContained = () => {
    const el = layout();
    const content = el && el.querySelector(':scope > [slot="content"]');
    return !!el && (el.hasAttribute('is-contained-content-layout-enabled') ||
      (!!content && /auto|scroll/.test(getComputedStyle(content).overflowY)));
  };
  let underBars = false;
  const syncUnderBars = () => {
    const contained = isContained();
    document.documentElement.classList.toggle('abt-ytm-contained', contained);
    const now = contained && !isPlayerPageOpen();
    if (now === underBars) return;
    underBars = now;
    try { window.webkit.messageHandlers.abtNav.postMessage({ type: 'underBottomBars', on: now }); } catch (_) {}
  };
  let watched = null;
  const observer = new MutationObserver(syncPageClass);
  const watchLayout = () => {
    const el = layout();
    if (el && el !== watched) {
      watched = el;
      observer.disconnect();
      observer.observe(el, { attributes: true, attributeFilter: ['player-ui-state', 'player-page-open'] });
    }
    syncPageClass();
  };
  watchLayout();
  setInterval(watchLayout, 400);
  const click = (selector, root = document) => {
    const el = root.querySelector(selector);
    if (!el) return false;
    el.click();
    return true;
  };

  // The bar docked at the bottom, whatever YouTube Music builds it from: `ytmusic-player-bar` for some accounts,
  // `ytmusic-miniplayer` for others (signed in, "wiz" mini player). The player page holds second copies, which
  // don't open anything.
  const dockedBar = () => {
    const el = layout();
    const slotted = el && el.querySelector(':scope > [slot="player-bar"]');
    if (slotted) return slotted;
    return [...document.querySelectorAll('ytmusic-player-bar, ytmusic-miniplayer')]
      .find((bar) => !bar.closest('ytmusic-player-page')) || null;
  };
  // YouTube Music's player (the same API as YouTube's), for next / previous without its buttons.
  const player = () => {
    const el = document.getElementById('movie_player');
    return el && typeof el.nextVideo === 'function' ? el : null;
  };
  // Next / previous buttons, wherever they are (the docked bar, or the open player page).
  const pressButton = (kind) => {
    const roots = [dockedBar(), document.querySelector('ytmusic-player-page')].filter(Boolean);
    const name = kind === 'next' ? 'Next' : 'Previous';
    const selectors = [`.${kind}-button button`, `.${kind}-button`, `[class*="${name}Button"] button`,
      `button[aria-label="${name}"]`];
    return roots.some((root) => selectors.some((selector) => click(selector, root)));
  };

  window.__abtMusic = {
    // Opens the page as tapping YouTube Music's own bar does (the bar is hidden, but its tap handler still runs),
    // and resolves once the page says it's open. A tap on the bar itself first: inside it, the signed-in mini player
    // has links to the song. Then its track info. False only when there's nothing to open.
    async openPlayerPage() {
      if (isPlayerPageOpen()) return true;
      const el = layout();
      if (el && el.getAttribute('player-ui-state') === 'INACTIVE') return false;
      const targets = [() => dockedBar(),
        () => { const bar = dockedBar(); return bar && bar.querySelector('.middle-controls, ytmusic-track-info, [class*="TrackInfo"]'); }];
      for (const target of targets) {
        const node = target();
        if (!node) continue;
        node.click();
        for (let i = 0; i < 12; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (isPlayerPageOpen()) return true;
        }
      }
      return isPlayerPageOpen();
    },
    closePlayerPage() {
      if (!isPlayerPageOpen()) return true;
      return click('ytmusic-player-page .collapse-button button') || click('ytmusic-player-page .collapse-button');
    },
    next() {
      const api = player();
      if (api) { api.nextVideo(); return true; }
      return pressButton('next');
    },
    // Like music apps: back to the start of the song once it's a few seconds in, otherwise the song before.
    previous() {
      const api = player();
      if (api && typeof api.getCurrentTime === 'function' && api.getCurrentTime() > 3) {
        api.seekTo(0, true);
        return true;
      }
      if (api && typeof api.previousVideo === 'function') { api.previousVideo(); return true; }
      return pressButton('previous');
    },

    // CarPlay: the page's shelves (Quick picks, Listen again, …) and the player's queue, as plain lists.
    carPlayLists() {
      const text = (el) => (el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '');
      const image = (el) => {
        const img = el && [...el.querySelectorAll('img')].find((i) => (i.currentSrc || i.src || '').startsWith('http'));
        return img ? (img.currentSrc || img.src) : null;
      };
      const playable = (a) => a && /watch\?v=/.test(a.getAttribute('href') || '');
      const shelves = [...document.querySelectorAll('ytmusic-carousel-shelf-renderer, ytmusic-shelf-renderer')].map((shelf) => {
        const title = text(shelf.querySelector('ytmusic-carousel-shelf-basic-header-renderer .title, .header .title, .title-group .title, h2'));
        const items = [...shelf.querySelectorAll('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer')]
          .map((item) => {
            const link = [...item.querySelectorAll('a[href]')].find(playable);
            if (!link) return null;
            return {
              title: text(item.querySelector('.title')) || text(link),
              subtitle: text(item.querySelector('.subtitle, .secondary-flex-columns')).slice(0, 80),
              image: image(item),
              href: new URL(link.getAttribute('href'), location.href).href,
            };
          })
          .filter(Boolean)
          .slice(0, 12);
        return { title, items };
      }).filter((shelf) => shelf.title && shelf.items.length).slice(0, 6);
      const queue = [...document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item')].map((item, index) => ({
        title: text(item.querySelector('.song-title')),
        subtitle: text(item.querySelector('.byline')),
        image: image(item),
        index,
        current: item.hasAttribute('selected') || item.getAttribute('play-button-state') === 'playing',
      })).filter((item) => item.title).slice(0, 50);
      return JSON.stringify({ shelves, queue });
    },
    playQueueItem(index) {
      const item = document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item')[index];
      if (!item) return false;
      (item.querySelector('.song-info, .song-title') || item).click();
      return true;
    },
  };

  // Lock screen and Control Center: next / previous track. YouTube Music registers seek handlers (shown as
  // "10 seconds" buttons) and may re-register its own on every track, so ours are kept in place.
  // They go through the app (like YouTube's), and are set again whenever a song starts: WebKit can drop a
  // page's handlers when its media changes, which left the lock screen's buttons greyed out.
  const session = navigator.mediaSession;
  if (session && session.setActionHandler) {
    const original = MediaSession.prototype.setActionHandler;
    const set = (action, handler) => {
      try { original.call(session, action, handler); } catch (_) {}
    };
    const post = (type) => {
      try { window.webkit.messageHandlers.abtNav.postMessage({ type }); } catch (_) {}
    };
    const ours = () => {
      set('nexttrack', () => post('nextTrack'));
      set('previoustrack', () => post('previousTrack'));
      set('seekbackward', null);
      set('seekforward', null);
    };
    const guard = function (action, handler) {
      if (['nexttrack', 'previoustrack', 'seekbackward', 'seekforward'].includes(action)) return undefined;
      return original.call(this, action, handler);
    };
    session.setActionHandler = guard;
    MediaSession.prototype.setActionHandler = guard;
    ours();
    for (const type of ['playing', 'loadedmetadata']) {
      document.addEventListener(type, (event) => { if (event.target instanceof HTMLMediaElement) ours(); }, true);
    }
  }

  // A swipe down on the player page closes it, like dismissing Now Playing. Not from the queue, lyrics or the
  // scrubber, which scroll or drag on their own.
  const ownGestures = '#side-panel, ytmusic-player-queue, ytmusic-tab-renderer, tp-yt-paper-slider, #progress-bar, ' +
    'ytmusic-description-shelf-renderer, input';
  let start = null;
  document.addEventListener('touchstart', (event) => {
    start = null;
    if (!isPlayerPageOpen() || event.touches.length !== 1) return;
    const page = document.querySelector('ytmusic-player-page');
    const target = event.target;
    if (!page || !page.contains(target) || (target.closest && target.closest(ownGestures))) return;
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, { capture: true, passive: true });

  document.addEventListener('touchend', (event) => {
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const quick = Date.now() - start.time < 800;
    start = null;
    if (dy > 80 && Math.abs(dx) < 60 && quick) {
      // The lift's click would land on whatever is under the finger once the page has closed (a song in the
      // list, which opens the player again).
      event.preventDefault();
      event.stopPropagation();
      window.__abtMusic.closePlayerPage();
    }
  }, { capture: true, passive: false });
})();
