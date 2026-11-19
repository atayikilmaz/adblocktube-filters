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
  const sheetOpen = () => visible($('ytw-scrim'))
    || [...document.querySelectorAll('yt-list-item-view-model')].some((el) => visible(el) && el.closest('.ytSpecBottomSheetLayoutHost, bottom-sheet-container, ytm-bottom-sheet-renderer'));
  // Closes the sheet and waits until it has stayed closed for a moment. A sheet that hadn't opened yet (the app was
  // inactive under a system prompt, or the page was slow) can come late, after the read gave up: it is watched for
  // longer, and closed while still out of sight. False when it's still open.
  const closeUntilGone = async (seen) => {
    const quietNeeded = seen ? 3 : 12;
    let quiet = 0;
    for (let i = 0; i < 30 && quiet < quietNeeded; i += 1) {
      if (sheetOpen()) {
        quiet = 0;
        closeSheet();
      } else {
        quiet += 1;
      }
      await sleep(120);
    }
    return !sheetOpen();
  };
  let sheetWatch = null;
  // The sheet only shows again once it's really closed: before, a close that missed (or a sheet that opened after
  // it) was left on screen, visible and stuck over the page. Keeps trying for half a minute, then lets go.
  const revealSheetWhenClosed = (stillOpen) => {
    clearInterval(sheetWatch);
    if (!stillOpen) {
      document.documentElement.classList.remove('abt-sheet-hidden');
      return;
    }
    const started = Date.now();
    sheetWatch = setInterval(() => {
      if (sheetBusy) return;
      if (sheetOpen() && Date.now() - started < 30000) {
        closeSheet();
        return;
      }
      clearInterval(sheetWatch);
      document.documentElement.classList.remove('abt-sheet-hidden');
    }, 500);
  };
  // Opens the sheet out of sight (html.abt-sheet-hidden, youtube-player.css: invisible and untouchable), runs
  // `action` on its items and closes it. Null when it couldn't open (no settings button yet, or already open).
  const withSettingsSheet = async (action) => {
    const button = $('.player-settings-icon');
    if (!button || sheetBusy) return null;
    sheetBusy = true;
    clearInterval(sheetWatch);
    document.documentElement.classList.add('abt-sheet-hidden');
    let result = null;
    let seen = false;
    try {
      button.click();
      const items = await settledItems();
      seen = items.length > 0;
      if (seen) result = await action(items);
    } catch (_) {}
    const closed = await closeUntilGone(seen);
    revealSheetWhenClosed(!closed);
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
  // Chapter times from a page ("1:21" → 81).
  const seconds = (stamp) => (stamp || '').split(':').reduce((total, part) => total * 60 + Number(part), 0);
  // The description's own chapter lines ("0:00 Intro"), when the video has them. YouTube's rule: the list starts
  // at zero, and a single line alone is no list. A line may lead with a symbol or emoji ("⌨️ (0:00) Introduction",
  // "• 1:45 Setup"): such lists were missed, and the first chapter's name stayed all video long (17 Nov).
  const describedChapters = (description) => {
    const lines = (description || '').split('\n').map((line) => {
      const m = line.match(/^\s*(?:[^\w\s([]{1,8}\s*)?[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*(?:[-–—:.]\s*)?(\S.*)/);
      return m ? { title: m[2].trim(), start: seconds(m[1]) } : null;
    }).filter(Boolean);
    return lines.length > 1 && lines[0].start === 0 ? lines : [];
  };
  // The same chapters with their titles, from the macro markers in the player overlays. Desktop web keeps them
  // there; mobile web sends no overlays in the player response at all — its page data carries them instead
  // (keyed DESCRIPTION_CHAPTERS rather than MACRO_MARKERS_TYPE_CHAPTERS).
  const overlayChapters = (overlays) => {
    const markers = ((overlays || {}).playerOverlayRenderer || {}).decoratedPlayerBarRenderer || {};
    const bar = (markers.decoratedPlayerBarRenderer || {}).playerBar || {};
    const map = ((bar.multiMarkersPlayerBarRenderer || {}).markersMap || []);
    const chapters = ((map.find((m) => m.value && m.value.chapters) || {}).value || {}).chapters || [];
    return chapters.map((c) => {
      const r = c.chapterRenderer || {};
      const title = r.title && (r.title.simpleText || (r.title.runs || []).map((x) => x.text).join('')) || '';
      return { title, start: (r.timeRangeStartMillis || 0) / 1000 };
    }).filter((c) => c.title);
  };
  // No panel needs opening for any of these. Sources, in order: the player response (always current); the page
  // data (window.ytInitialData), which however goes stale once the player switches videos without a page reload,
  // so it only counts while the page still is this video's; and last the description's timestamps, which the
  // player response always has for the playing video.
  const chapterList = (response) => {
    try {
      const details = ((response || {}).videoDetails || {});
      const chapters = overlayChapters((response || {}).playerOverlays);
      if (chapters.length) return chapters;
      const page = window.ytInitialData || {};
      if (details.videoId && (((page.currentVideoEndpoint || {}).watchEndpoint || {}).videoId) === details.videoId) {
        const pageChapters = overlayChapters(page.playerOverlays);
        if (pageChapters.length) return pageChapters;
      }
      return describedChapters(details.shortDescription);
    } catch (_) { return []; }
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
  // A sheet's dim that is drawn. One kept invisible (html.abt-quiet-sheets, while Save picks its way through the
  // More menu) doesn't count: it hid the app's row, showed it, and hid it again within 200 ms (17 Nov).
  // A scrim with no size dims nothing: an open panel leaves one 0 px tall at the page's foot, which in the tablet
  // layout (the panel beside the row) hid the app's row for nothing.
  const dimmed = () => [...document.querySelectorAll('ytw-scrim')].some((s) => {
    const box = s.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(s).visibility !== 'hidden';
  });
  const actionRow = () => {
    const bar = $('ytm-slim-video-action-bar-renderer');
    if (!bar) return null;
    const like = bar.querySelector('like-button-view-model button');
    const dislike = bar.querySelector('dislike-button-view-model button');
    const subscribe = bar.querySelector('ytm-subscribe-button-renderer') || $('ytm-slim-owner-renderer ytm-subscribe-button-renderer');
    const owner = bar.querySelector('a[href^="/@"], a[href^="/channel/"]') || $('ytm-slim-owner-renderer a');
    // "Name, 126K subscribers. Go to channel."
    const ownerLabel = ((owner && owner.getAttribute('aria-label')) || '').replace(/\.\s[^.]*\.?$/, '');
    const comma = ownerLabel.lastIndexOf(', ');
    const avatar = owner && owner.querySelector('img');
    const rect = bar.getBoundingClientRect();
    // The page shows comments, the description or chapters over everything below the video: the app's row hides.
    // In the tablet layout they open under it, and the row stays.
    const panel = [...document.querySelectorAll('ytm-engagement-panel')].some((p) => {
      const box = p.getBoundingClientRect();
      // A few points of slack: the tablet layout's panel starts where the row ends, rounded.
      return box.height > 80 && box.left < rect.right - 4 && box.right > rect.left + 4
        && box.top < rect.bottom - 4 && box.bottom > rect.top + 4;
    });
    return {
      // The invisible settings sheet's scrim (read in the background) doesn't count.
      top: rect.top + scrollY, height: rect.height, covered: panel || (!sheetBusy && !quietDialog && !document.documentElement.classList.contains('abt-sheet-hidden') && dimmed()),
      liked: !!like && like.getAttribute('aria-pressed') === 'true',
      disliked: !!dislike && dislike.getAttribute('aria-pressed') === 'true',
      likes: like ? digits(like.getAttribute('aria-label')) : null,
      subscribed: !!subscribe && !subscribe.classList.contains('is-not-subscribed'),
      subscribeLabel: label(subscribe && subscribe.querySelector('button')),
      channel: comma > 0 ? ownerLabel.slice(0, comma) : ownerLabel,
      channelSubscribers: comma > 0 ? ownerLabel.slice(comma + 2) : '',
      channelAvatar: (avatar && avatar.src) || null,
    };
  };
  const liveWindow = (details) => {
    if (!details.isLiveContent || !details.isLive) return null;
    const progress = call('getProgressState');
    if (!progress || !Number.isFinite(progress.seekableEnd)) return null;
    return {
      start: Math.floor(progress.seekableStart || 0),
      end: Math.floor(progress.seekableEnd),
      atHead: !!progress.isAtLiveHead,
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
      // A live stream's <video> duration is a placeholder far past the live edge; the window it can play is this.
      live: liveWindow(details),
      captions: captionTracks(response),
      caption: track.languageCode ? { code: track.languageCode, kind: track.kind || '' } : null,
      loop: !!call('getLoopVideo'),
      rates: call('getAvailablePlaybackRates') || [],
      autoplay: autoplay ? autoplay.getAttribute('aria-pressed') === 'true' : null,
      hasPrevious: !!prevNext[0] && prevNext[0].getAttribute('aria-disabled') !== 'true',
      hasNext: !!prevNext[1] && prevNext[1].getAttribute('aria-disabled') !== 'true',
      chapters: chapterStarts,
      chapterList: chapterList(response),
      // YouTube's controls are hidden, so this reads the (hidden) chapter button's text.
      chapterTitle: chapterStarts.length > 1 ? label(chapterButton) : '',
      storyboard: board ? board.spec : null,
      buffered: call('getVideoLoadedFraction') || 0,
      settings: sheetSettings,
      adShowing: p.classList.contains('ad-showing'),
      actions: actionRow(),
    };
  };

  // MARK: Captions choice

  // The user's last captions choice (from the app's menu), kept for every video after it: YouTube turns captions on
  // by itself for many videos (another language than the app's, its own sticky setting), which had to be turned off
  // again each time. 'off', or the track {code, kind} to pick when the video has it. Shared by every YouTube page.
  const CAPTIONS_KEY = 'abt-captions';
  const captionChoice = () => {
    try {
      const value = localStorage.getItem(CAPTIONS_KEY);
      return value === 'off' ? 'off' : value ? JSON.parse(value) : null;
    } catch (_) { return null; }
  };
  const rememberCaptions = (code, kind) => {
    try { localStorage.setItem(CAPTIONS_KEY, code ? JSON.stringify({ code, kind: kind || '' }) : 'off'); } catch (_) {}
  };
  // The video a remembered track was already picked for (once each, so the page doesn't fight anything later).
  let captionsPickedFor = null;
  const keepCaptionChoice = () => {
    const choice = captionChoice();
    if (!choice || !player()) return;
    const track = call('getOption', 'captions', 'track') || {};
    if (choice === 'off') {
      if (track.languageCode) call('unloadModule', 'captions');
      return;
    }
    const id = (call('getVideoData') || {}).video_id;
    if (!id || captionsPickedFor === id) return;
    if (track.languageCode === choice.code) { captionsPickedFor = id; return; }
    const tracks = captionTracks(call('getPlayerResponse'));
    if (!tracks.length) return;
    captionsPickedFor = id;
    const match = tracks.find((t) => t.code === choice.code && t.kind === (choice.kind || ''))
      || tracks.find((t) => t.code === choice.code);
    if (!match) return;
    call('loadModule', 'captions');
    call('setOption', 'captions', 'track', { languageCode: match.code, kind: match.kind || undefined });
  };

  let lastSent = '';
  let lastVideo = null;
  const send = () => {
    try { keepCaptionChoice(); } catch (_) {}
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

  const SUBSCRIBE = 'ytm-slim-video-action-bar-renderer ytm-subscribe-button-renderer button, ytm-slim-owner-renderer ytm-subscribe-button-renderer button';
  // The app asks "Unsubscribe?" natively, so YouTube's own dialog is confirmed out of sight.
  let quietDialog = false;
  const unsubscribe = () => {
    quietDialog = true;
    document.documentElement.classList.add('abt-quiet-dialog');
    const done = () => {
      quietDialog = false;
      document.documentElement.classList.remove('abt-quiet-dialog');
      soon();
    };
    if (!press(SUBSCRIBE)) return done();
    const started = Date.now();
    const confirm = () => {
      const buttons = [...document.querySelectorAll('div.dialog-container .ytSpecDialogLayoutFooterContainer button')];
      if (buttons.length > 1) { buttons[buttons.length - 1].click(); setTimeout(done, 400); return; }
      if (Date.now() - started > 2000) return done();
      setTimeout(confirm, 50);
    };
    confirm();
  };

  const press = (selector) => {
    const el = $(selector);
    if (el) el.click();
    soon();
    return !!el;
  };

  window.__abtControls = {
    // Reports the state now (a panel opening over the page shouldn't wait for the next tick).
    report: () => send(),
    refresh: () => { lastSent = ''; send(); return true; },
    setCaptions(code, kind) {
      rememberCaptions(code, kind);
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
    openChannel: () => press('ytm-slim-video-action-bar-renderer a[href^="/@"], ytm-slim-video-action-bar-renderer a[href^="/channel/"], ytm-slim-owner-renderer a'),
    subscribe: () => press(SUBSCRIBE),
    unsubscribe,
    // "Save to playlist": the action row's Save button, found by its bookmark icon or its label. Many videos have
    // none in the row (Like, Dislike, Share, Ask, More); then it is the Save item in the More sheet. Never guesses
    // by position: the second button is Dislike.
    save() {
      const SAVE_LABEL = /playlist|save|kaydet|speichern|enregistrer|guardar|salva|сохран|保存|저장|حفظ|सहेज/i;
      const BOOKMARK = 'path[d^="M19 2H5"]';
      const isSave = (el) => !!el.querySelector(BOOKMARK) || SAVE_LABEL.test(el.getAttribute('aria-label') || label(el));
      const row = [...document.querySelectorAll('ytm-slim-video-action-bar-renderer button-view-model button')]
        .filter((b) => !b.closest('like-button-view-model, dislike-button-view-model'));
      const direct = row.find((b) => b.querySelector(BOOKMARK))
        || row.find((b) => SAVE_LABEL.test(b.getAttribute('aria-label') || label(b)));
      if (direct) { direct.click(); return true; }
      const more = row[row.length - 1];
      if (!more) return false;
      // The More sheet is only a step on the way: it showed for 4 frames, then nothing for 10, then "Save to…"
      // popped in (a flash, 17 Nov). Every sheet stays invisible (still laid out and tappable) until "Save to…"
      // is up; that one then slides up over a fading dim, as a sheet should.
      const root = document.documentElement;
      root.classList.add('abt-quiet-sheets');
      const sheets = () => [...document.querySelectorAll('bottom-sheet-container .ytSpecBottomSheetLayoutHost')]
        .filter(visible);
      const reveal = (host) => {
        root.classList.remove('abt-quiet-sheets');
        if (!host) return;
        const scrim = host.closest('bottom-sheet-container') && host.closest('bottom-sheet-container').querySelector('ytw-scrim');
        const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
        try {
          host.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 320, easing: ease });
          if (scrim) scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
        } catch (_) {}
      };
      // Only the More menu's own rows: a "Save to…" sheet still closing has the same bookmark icon on every
      // playlist, and tapping its first row saved the video to Watch later (17 Nov). Its rows are switches
      // (aria-pressed), and it was up before More was pressed.
      const before = new Set([...document.querySelectorAll('bottom-sheet-container yt-list-item-view-model')].filter(visible));
      more.click();
      (async () => {
        let menu = null;
        for (let i = 0; i < 40 && !menu; i += 1) {
          await sleep(25);
          const items = [...document.querySelectorAll('bottom-sheet-container yt-list-item-view-model')]
            .filter((e) => visible(e) && !before.has(e) && !e.querySelector('[aria-pressed]'));
          const item = items.find((e) => e.querySelector(BOOKMARK)) || items.find(isSave);
          // The row's tappable wrapper takes the tap; its inner button does nothing.
          if (item) { menu = item; (item.querySelector('.ytListItemViewModelTappable') || item).click(); }
        }
        if (!menu) { reveal(null); return; }
        // "Save to…" is the first sheet up once the More menu has gone.
        for (let i = 0; i < 80; i += 1) {
          await sleep(25);
          const host = !menu.isConnected || !visible(menu) ? sheets()[0] : null;
          if (host) { reveal(host); return; }
        }
        reveal(null);
      })();
      return true;
    },
  };
})();
