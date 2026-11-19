// The native video player's page (a YouTube watch page): related videos stay in the player; other links
// (channels, hashtags) open in the app and the player shrinks; a swipe down on the video minimizes it,
// like the YouTube app.
(() => {
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };

  document.addEventListener('click', (event) => {
    // The app switching videos in place (`__abt.navigate`): YouTube's own router takes that click.
    if (window.__abtNavigating) return;
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    let url;
    try { url = new URL(link.getAttribute('href'), location.href); } catch (_) { return; }
    if (url.href.startsWith('javascript:')) return;
    if (url.pathname === '/watch') {
      // Timestamps in the description and comments seek this video: YouTube's own.
      const id = url.searchParams.get('v');
      if (!id || id === new URLSearchParams(location.search).get('v')) return;
      // Another video: through the app, which covers the switch with its thumbnail and the page skeleton (as
      // when opening one from a feed) and then moves the page in place, instead of the black page filling in.
      event.preventDefault();
      event.stopImmediatePropagation();
      post({ type: 'openVideo', url: url.href });
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    post({ type: 'openLink', url: url.href });
  }, true);

  let start = null;
  document.addEventListener('touchstart', (event) => {
    const player = document.getElementById('player-container-id');
    if (event.touches.length !== 1 || !player || !player.contains(event.target)) { start = null; return; }
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
    // A hold-for-2× gesture also slides down (to lock); that one is not a minimize.
    if (window.__abtSpeedHolding || window.__abtSpeedHoldEndedAt > Date.now() - 300) return;
    // Newer apps follow the swipe natively, finger and all.
    if (window.__abtNativeSwipeDown) return;
    if (dy > 70 && Math.abs(dx) < 60 && quick && !document.fullscreenElement) post({ type: 'minimize' });
  }, { capture: true, passive: true });

  // A pull down on a panel's header (comments, the description, chapters) closes it, as its sheet would in the
  // YouTube app. The page only closes it from its small X, or by a swipe that runs down to the screen's bottom
  // edge, where iOS takes it for Reachability.
  const PANEL_HEADER = 'ytm-engagement-panel .engagement-panel-section-list-header-wrapper';
  let headerPull = null;
  document.addEventListener('touchstart', (event) => {
    const header = event.target.closest && event.target.closest(PANEL_HEADER);
    const touch = event.touches[0];
    headerPull = header && event.touches.length === 1 ? { header, x: touch.clientX, y: touch.clientY } : null;
  }, { capture: true, passive: true });
  document.addEventListener('touchend', (event) => {
    if (!headerPull) return;
    const { header, x, y } = headerPull;
    headerPull = null;
    const touch = event.changedTouches[0];
    if (touch.clientY - y < 45 || Math.abs(touch.clientX - x) > 70) return;
    // Not in the tablet layout, where the panel is a column of the page rather than a sheet: there it moves under
    // the finger as its comments scroll back to the top, and the same pull closed it.
    if (isTablet()) return;
    const close = header.querySelector('button');
    if (close) close.click();
  }, { capture: true, passive: true });

  // Comments, the description and chapters open in a panel that fills in piece by piece: placeholders cover its
  // content (youtube-player.css, html.abt-panel-loading) until it has stopped changing and holds something, or for
  // three seconds at most.
  const root = document.documentElement;
  const openPanel = () => [...document.querySelectorAll('ytm-engagement-panel')]
    .find((panel) => panel.getBoundingClientRect().height > 80);
  let watching = null;
  const watchPanel = (panel) => {
    if (watching === panel) return;
    watching = panel;
    root.classList.add('abt-panel-loading');
    let quiet = null;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(limit);
      observer.disconnect();
      requestAnimationFrame(() => root.classList.remove('abt-panel-loading'));
    };
    const filled = () => {
      const content = panel.querySelector('.engagement-panel-content-wrapper') || panel;
      return content.scrollHeight > 200 && (content.textContent || '').trim().length > 80;
    };
    const wait = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => (filled() ? done() : wait()), 250);
    };
    const observer = new MutationObserver(wait);
    observer.observe(panel, { childList: true, subtree: true });
    const limit = setTimeout(done, 3000);
    wait();
  };
  setInterval(() => {
    const panel = openPanel();
    // The app's action row steps aside for a panel: tell it at once, not on its next state report.
    if (!!panel !== !!watching && window.__abtControls && window.__abtControls.report) window.__abtControls.report();
    if (panel) watchPanel(panel);
    else watching = null;
  }, 100);

  // Tablet layout (youtube-player.css sets --abt-tablet): comments, the description and chapters open in the left
  // column under the video, at full height, over the title and buttons until closed.
  const isTablet = () => getComputedStyle(root).getPropertyValue('--abt-tablet').trim() === '1';
  // YouTube's pull-down-to-dismiss doesn't apply there: with the comments scrolled back to their top, a pull down
  // closed them. It never sees a panel's drags here (the page still scrolls them; taps are clicks, untouched).
  window.addEventListener('touchmove', (event) => {
    if (event.target instanceof Element && event.target.closest('ytm-engagement-panel') && isTablet()) {
      event.stopPropagation();
    }
  }, { capture: true, passive: true });
  // The comments and the related videos run to the screen's bottom edge, under the home indicator, as the rest of
  // the app does: the app stops keeping the page above it and gives its height in --abt-bottom-bars
  // (youtube-player.css pads by it). Left above it, both ended on an empty band (18 Nov).
  let underBars = false;
  const syncUnderBars = (on) => {
    if (on === underBars) return;
    underBars = on;
    try { window.webkit.messageHandlers.abtNav.postMessage({ type: 'underBottomBars', on }); } catch (_) {}
  };
  const videoID = () => new URLSearchParams(location.search).get('v');
  // A Mix opens with its list expanded over the whole column: once per video it goes down to its "Up next" bar.
  // Opened by hand (its bar tapped), it stays.
  let collapsedListFor = null;
  let listOpenedFor = null;
  document.addEventListener('click', (event) => {
    if (event.isTrusted && event.target instanceof Element && event.target.closest('ytm-playlist-panel-entry-point')) {
      listOpenedFor = videoID();
    }
  }, { capture: true, passive: true });
  setInterval(() => {
    syncUnderBars(isTablet());
    if (!isTablet() || location.pathname !== '/watch' || document.visibilityState !== 'visible') return;
    const id = videoID();
    const panel = openPanel();
    if (!id || !panel || collapsedListFor === id || listOpenedFor === id) return;
    if (!panel.querySelector('.engagement-panel-playlist')) return;
    // Its own X ("Hide playlist videos"): the header's first button is Loop, which a looser match pressed instead.
    const close = panel.querySelector('[class*="header-close"] button');
    if (!close) return;
    collapsedListFor = id;
    close.click();
  }, 100);

  // A video whose media went away while the page was suspended in the background: back on screen, YouTube's player
  // sits "buffering" at its moment with no source on its <video> (no blob, readyState 0) and never fetches again,
  // so the mini player showed it playing (or its spinner) with a black picture, and neither play, a seek nor a
  // reload of the app's state moved it (7 Nov, iPhone 15). Its media emptied by hand, YouTube attaches a new blob and
  // stays the same way: readyState 0, buffering. The player loads the same video again and is put back at its
  // moment: after 3 s with no source, or 6 s with a source and still no data (a slow start gets that long).
  let emptyChecks = 0;
  let recoveredAt = 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible' || location.pathname !== '/watch') { emptyChecks = 0; return; }
    const player = document.querySelector('#movie_player');
    const video = player && player.querySelector('video');
    if (!video || video.readyState > 0 || typeof player.loadVideoById !== 'function') {
      emptyChecks = 0;
      return;
    }
    let state = -1;
    let id = null;
    let at = 0;
    try {
      state = player.getPlayerState();
      id = player.getVideoData().video_id;
      at = player.getCurrentTime();
    } catch (_) { return; }
    // Meant to play: YouTube's player playing or buffering, or a play sent to the <video> itself (the app's button).
    const wantsToPlay = state === 1 || state === 3 || !video.paused;
    if (!id || !wantsToPlay) { emptyChecks = 0; return; }
    emptyChecks += 1;
    if (emptyChecks < (video.currentSrc ? 4 : 2) || Date.now() - recoveredAt < 15000) return;
    emptyChecks = 0;
    recoveredAt = Date.now();
    // `startSeconds` is ignored here (it came back at 0:13): the moment is set once the new media has its length.
    player.loadVideoById({ videoId: id, startSeconds: at });
    if (at < 2) return;
    const seekBack = () => {
      const media = player.querySelector('video');
      if (media && media.readyState > 0 && player.getDuration() > 0) {
        if (Math.abs(player.getCurrentTime() - at) > 2) player.seekTo(at, true);
        return;
      }
      if (Date.now() - recoveredAt < 10000) setTimeout(seekBack, 100);
    };
    setTimeout(seekBack, 100);
  }, 1500);
  // Back from iOS's fullscreen player after a turn to portrait (a swipe down from landscape), the video sometimes
  // stayed at its landscape size and place: off to the right and cut off, under the open comments (iPhone 15,
  // 19 Nov). YouTube only places it again when it sees its player change size, which it already had, so each
  // moment while the turn settles the video is checked against its player and fitted back into it (centred, at
  // its own shape), and WebKit is made to draw it again.
  const fitVideoToPlayer = () => {
    const player = document.getElementById('movie_player');
    const video = player && player.querySelector('video');
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const box = player.getBoundingClientRect();
    const rect = video.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const left = Math.round((box.width - width) / 2);
    const top = Math.round((box.height - height) / 2);
    const off = Math.abs(rect.width - width) > 2 || Math.abs(rect.height - height) > 2
      || Math.abs(rect.left - box.left - left) > 2 || Math.abs(rect.top - box.top - top) > 2;
    if (off) {
      video.style.width = `${width}px`;
      video.style.height = `${height}px`;
      video.style.left = `${left}px`;
      video.style.top = `${top}px`;
    }
    video.style.transform = 'translateZ(0)';
    requestAnimationFrame(() => { video.style.transform = ''; });
  };
  document.addEventListener('webkitendfullscreen', () => {
    for (const delay of [100, 400, 900, 1600]) setTimeout(fitVideoToPlayer, delay);
  }, true);
})();
