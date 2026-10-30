// The app's own player controls (PlayerControls in the app) stand in for YouTube's, which youtube-player.css hides.
// This is their link to the page:
// - Taps on the video go to the app (`playerTap`, with the side it landed on) instead of YouTube. Holds (2×,
//   youtube-speed-hold.js) and swipes are left alone.
// - What the controls show is posted as `playerState` whenever it changes: captions, loop, autoplay, chapters, the
//   storyboard (scrub previews), previous / next, YouTube's own settings switches, the like / subscribe row, and
//   where YouTube's action row sits in the page (the app draws its own there).
// - `__abtControls.*` presses YouTube's own controls for the app.
(() => {
  if (window.__abtControls) return;
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const $ = (selector) => document.querySelector(selector);
  const player = () => document.getElementById('movie_player');
  const call = (name, ...args) => {
    const p = player();
    try { return p && typeof p[name] === 'function' ? p[name](...args) : undefined; } catch (_) { return undefined; }
  };
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const label = (el) => (el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '');

  // MARK: Taps

  const inPlayer = (x, y) => {
    const p = player();
    if (!p) return false;
    const r = p.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  let touch = null;
  document.addEventListener('touchstart', (event) => {
    const t = event.touches[0];
    touch = event.touches.length === 1 && inPlayer(t.clientX, t.clientY)
      ? { x: t.clientX, y: t.clientY, at: Date.now(), moved: false } : null;
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', (event) => {
    const t = event.touches[0];
    if (touch && t && Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > 10) touch.moved = true;
  }, { capture: true, passive: true });
  document.addEventListener('touchend', (event) => {
    const t = touch;
    touch = null;
    if (!t || t.moved || !event.isTrusted || Date.now() - t.at > 450) return;
    if (window.__abtSpeedHolding || Date.now() - (window.__abtSpeedHoldEndedAt || 0) < 400) return;
    // YouTube never sees it (its controls are hidden; its double-tap seek would double ours).
    event.preventDefault();
    event.stopPropagation();
    const third = innerWidth / 3;
    post({ type: 'playerTap', side: t.x < third ? 'left' : t.x > third * 2 ? 'right' : 'center' });
  }, { capture: true, passive: false });
  for (const type of ['click', 'dblclick']) {
    document.addEventListener(type, (event) => {
      if (event.isTrusted && inPlayer(event.clientX, event.clientY) && !event.target.closest('.ytp-ad-module')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  // MARK: YouTube's settings sheet (Ambient mode, Stable volume, Stats for nerds…), read and pressed invisibly

  // The last good list. YouTube's switches are global, so it carries over from video to video, and a read that
  // comes back short (sheet not ready, an ad's own sheet) never replaces it on its own.
  let sheetSettings = [];
  let sheetBusy = false;
  const visibleItems = () => {
    const all = [...document.querySelectorAll('yt-list-item-view-model')].filter(visible);
    const inSheet = all.filter((el) => el.closest('.ytSpecBottomSheetLayoutHost, bottom-sheet-container, ytm-bottom-sheet-renderer'));
    return inSheet.length ? inSheet : all;
  };
  // The sheet fills in over a few frames: reading at the first item missed the switches further down (Ambient mode
  // came and went). Waits until the count holds still.
  const settledItems = async () => {
    let items = [];
    let steady = 0;
    for (let i = 0; i < 30; i += 1) {
      await sleep(60);
      const now = visibleItems();
      steady = now.length && now.length === items.length ? steady + 1 : 0;
      items = now;
      if (steady >= 2) break;
    }
    return items;
  };
  const closeSheet = () => {
    const close = [...document.querySelectorAll('button[aria-label]')].find((b) => visible(b) && b.closest('.ytSpecBottomSheetLayoutHost, bottom-sheet-container') && /close/i.test(b.getAttribute('aria-label')));
    const scrim = $('ytw-scrim');
    if (close) close.click(); else if (scrim) scrim.click();
  };
  // Opens the sheet out of sight (html.abt-sheet-hidden, youtube-player.css: invisible and untouchable), runs
  // `action` on its items and closes it. Null when it couldn't open (no settings button yet, or already open).
  const withSettingsSheet = async (action) => {
    const button = $('.player-settings-icon');
    if (!button || sheetBusy) return null;
    sheetBusy = true;
    document.documentElement.classList.add('abt-sheet-hidden');
    let result = null;
    try {
      button.click();
      const items = await settledItems();
      if (items.length) result = await action(items);
    } catch (_) {}
    closeSheet();
    await sleep(300);
    document.documentElement.classList.remove('abt-sheet-hidden');
    sheetBusy = false;
    return result;
  };
  // Switches (Ambient mode, Stable volume, Loop) and plain actions (Stats for nerds, Copy debug info); the
  // entries with a value (Quality, Speed, Captions) have native pickers.
  const readSheet = (items) => items.map((item) => {
    const toggle = item.querySelector('[role="switch"]');
    const parts = [...item.querySelectorAll('.ytListItemViewModelTitle, .ytListItemViewModelSubtitle, span[role="text"], .yt-core-attributed-string')]
      .map(label).filter(Boolean);
    const title = parts[0] || label(item);
    if (toggle) return { kind: 'toggle', title: toggle.getAttribute('aria-label') || title, on: toggle.getAttribute('aria-checked') === 'true' };
    return parts.length > 1 ? null : { kind: 'action', title };
  }).filter(Boolean);
  const switchCount = (list) => list.filter((s) => s.kind === 'toggle').length;
  const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  let refreshTimer = null;
  let shorterRead = null;
  // Reads the sheet after `delay` ms, trying again (further apart each time) until a read has switches in it: the
  // settings button comes a while after the page, and during an ad the sheet is the ad's.
  const scheduleRefresh = (delay, attempt = 0) => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const p = player();
      const ready = p && !p.classList.contains('ad-showing');
      const read = ready ? await withSettingsSheet(async (items) => readSheet(items)) : null;
      if (read && switchCount(read)) accept(read);
      else if (attempt < 6) scheduleRefresh(Math.min(1500 * 2 ** attempt, 15000), attempt + 1);
    }, delay);
  };
  // A list with fewer switches than the known one is believed only once a second read agrees with it.
  const accept = (read) => {
    if (switchCount(read) < switchCount(sheetSettings) && !(shorterRead && sameList(read, shorterRead))) {
      shorterRead = read;
      scheduleRefresh(4000, 5);
      return;
    }
    shorterRead = null;
    if (!sameList(read, sheetSettings)) { sheetSettings = read; send(); }
  };

  // MARK: State for the app

  const chapters = () => {
    const parts = [...document.querySelectorAll('yt-chaptered-progress-bar-line .ytChapteredProgressBarChapteredPlayerBarChapter')];
    if (parts.length < 2) return [];
    let start = 0;
    return parts.map((el) => {
      const at = start;
      start += (parseFloat(el.style.width) || 0) / 100;
      return at;
    });
  };
  const captionTracks = (response) => {
    let tracks = call('getOption', 'captions', 'tracklist', { includeAsr: true }) || [];
    if (!tracks.length && response && response.captions && response.captions.playerCaptionsTracklistRenderer) {
      tracks = (response.captions.playerCaptionsTracklistRenderer.captionTracks || []).map((t) => ({
        languageCode: t.languageCode, kind: t.kind || '',
        displayName: (t.name && (t.name.simpleText || (t.name.runs || []).map((r) => r.text).join(''))) || t.languageCode,
      }));
    }
    return tracks.map((t) => ({ code: t.languageCode, kind: t.kind || '', name: t.displayName || t.languageName || t.languageCode }));
  };
  const digits = (text) => {
    const number = (text || '').replace(/[^\d]/g, '');
    return number ? Number(number) : null;
  };
  const actionRow = () => {
    const bar = $('ytm-slim-video-action-bar-renderer');
    if (!bar) return null;
    const like = bar.querySelector('like-button-view-model button');
    const dislike = bar.querySelector('dislike-button-view-model button');
    const subscribe = bar.querySelector('ytm-subscribe-button-renderer') || $('ytm-slim-owner-renderer ytm-subscribe-button-renderer');
    const rect = bar.getBoundingClientRect();
    // The page shows comments, the description or chapters over everything below the video: the app's row hides.
    const panel = [...document.querySelectorAll('ytm-engagement-panel')].some((p) => p.getBoundingClientRect().height > 80);
    return {
      // The invisible settings sheet's scrim (read in the background) doesn't count.
      top: rect.top + scrollY, height: rect.height, covered: panel || (!sheetBusy && visible($('ytw-scrim'))),
      liked: !!like && like.getAttribute('aria-pressed') === 'true',
      disliked: !!dislike && dislike.getAttribute('aria-pressed') === 'true',
      likes: like ? digits(like.getAttribute('aria-label')) : null,
      subscribed: !!subscribe && !subscribe.classList.contains('is-not-subscribed'),
      subscribeLabel: label(subscribe && subscribe.querySelector('button')),
    };
  };
  const snapshot = () => {
    const p = player();
    if (!p) return null;
    const response = call('getPlayerResponse') || {};
    const details = response.videoDetails || {};
    const board = response.storyboards && response.storyboards.playerStoryboardSpecRenderer;
    const track = call('getOption', 'captions', 'track') || {};
    const prevNext = [...document.querySelectorAll('.player-middle-controls-prev-next-button')];
    const autoplay = $('player-autonav-toggle button');
    const chapterButton = $('.ytwPlayerTimeDisplayPlayerBarButton');
    const chapterStarts = chapters();
    return {
      videoID: details.videoId || null,
      isLive: !!details.isLiveContent && !!details.isLive,
      captions: captionTracks(response),
      caption: track.languageCode ? { code: track.languageCode, kind: track.kind || '' } : null,
      loop: !!call('getLoopVideo'),
      rates: call('getAvailablePlaybackRates') || [],
      autoplay: autoplay ? autoplay.getAttribute('aria-pressed') === 'true' : null,
      hasPrevious: !!prevNext[0] && prevNext[0].getAttribute('aria-disabled') !== 'true',
      hasNext: !!prevNext[1] && prevNext[1].getAttribute('aria-disabled') !== 'true',
      chapters: chapterStarts,
      // YouTube's controls are hidden, so this reads the (hidden) chapter button's text.
      chapterTitle: chapterStarts.length > 1 ? label(chapterButton) : '',
      storyboard: board ? board.spec : null,
      buffered: call('getVideoLoadedFraction') || 0,
      settings: sheetSettings,
      adShowing: p.classList.contains('ad-showing'),
      actions: actionRow(),
    };
  };

  let lastSent = '';
  let lastVideo = null;
  const send = () => {
    const state = snapshot();
    if (!state) return;
    const json = JSON.stringify(state);
    if (json === lastSent) return;
    lastSent = json;
    post({ type: 'playerState', state: json });
    if (state.videoID && state.videoID !== lastVideo) {
      lastVideo = state.videoID;
      // Read (again) on every page and video once its controls exist: switches can come and go with the video.
      scheduleRefresh(1500);
    }
  };
  // Twice a second, and every 120 ms for the first seconds of each page or video, so the app's skeleton gives
  // way the moment the page has laid out.
  let fastUntil = Date.now() + 6000;
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; fastUntil = Date.now() + 6000; }
    if (Date.now() < fastUntil) send();
  }, 120);
  setInterval(send, 600);
  for (const type of ['loadedmetadata', 'playing', 'pause', 'seeked']) {
    document.addEventListener(type, () => setTimeout(send, 50), true);
  }
  const soon = () => setTimeout(send, 350);

  const press = (selector) => {
    const el = $(selector);
    if (el) el.click();
    soon();
    return !!el;
  };

  window.__abtControls = {
    refresh: () => { lastSent = ''; send(); return true; },
    setCaptions(code, kind) {
      if (!code) {
        call('unloadModule', 'captions');
      } else {
        call('loadModule', 'captions');
        call('setOption', 'captions', 'track', { languageCode: code, kind: kind || undefined });
      }
      soon();
      return true;
    },
    setLoop(on) {
      call('setLoopVideo', !!on);
      const video = player() && player().querySelector('video');
      if (video) video.loop = !!on;
      soon();
      return true;
    },
    toggleAutoplay: () => press('player-autonav-toggle button'),
    // A switch or action from YouTube's settings sheet, by its title. A switch shows its new state at once (the
    // app does the same), and the sheet is read back once the switch has moved. If a background read has the sheet
    // open, it waits its turn instead of being dropped.
    pressSetting(title) {
      sheetSettings = sheetSettings.map((s) => (s.kind === 'toggle' && s.title === title ? { ...s, on: !s.on } : s));
      const attempt = async (tries) => {
        const pressed = await withSettingsSheet(async (items) => {
          const item = items.find((i) => {
            const toggle = i.querySelector('[role="switch"]');
            return (toggle && toggle.getAttribute('aria-label') === title) || label(i).startsWith(title);
          });
          if (!item) return false;
          const toggle = item.querySelector('[role="switch"]');
          const before = toggle && toggle.getAttribute('aria-checked');
          (toggle || item.querySelector('button') || item).click();
          for (let i = 0; toggle && i < 20 && toggle.getAttribute('aria-checked') === before; i += 1) await sleep(50);
          const read = readSheet(visibleItems());
          if (switchCount(read)) sheetSettings = read;
          return true;
        });
        if (pressed === null && tries < 8) { await sleep(250); return attempt(tries + 1); }
        return pressed;
      };
      attempt(0).then(() => { lastSent = ''; send(); });
      return true;
    },
    openChapters: () => press('.ytwPlayerTimeDisplayPlayerBarButton'),
    like: () => press('ytm-slim-video-action-bar-renderer like-button-view-model button'),
    dislike: () => press('ytm-slim-video-action-bar-renderer dislike-button-view-model button'),
    subscribe: () => press('ytm-slim-video-action-bar-renderer ytm-subscribe-button-renderer button, ytm-slim-owner-renderer ytm-subscribe-button-renderer button'),
    // "Save to playlist": the action row's button whose label mentions a playlist, else the one after Share.
    save() {
      const buttons = [...document.querySelectorAll('ytm-slim-video-action-bar-renderer button-view-model button')];
      const save = buttons.find((b) => /playlist|save|kaydet|speichern|enregistrer|guardar|salva/i.test(b.getAttribute('aria-label') || '')) || buttons[1];
      if (save) save.click();
      return !!save;
    },
  };
})();
