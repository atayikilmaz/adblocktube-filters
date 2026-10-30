// YouTube end-of-video behaviour from the app's settings (window.__abtConfig):
// - autoplayNext off: cancel YouTube's "Up next" countdown.
// - skipAutoplayDelay on: start the next video right away instead of waiting out the countdown.
// Matches controls by role and label rather than class names, since YouTube renames classes often.
(() => {
  const config = () => window.__abtConfig || {};
  const UP_NEXT_AREA = '[class*="autonav" i], [class*="endscreen" i], [class*="up-next" i], [class*="upnext" i]';
  const PLAY_NEXT = /^(play( next)?|next( video)?|play now)$/i;
  const CANCEL = /^(cancel|stop autoplay)$/i;

  const label = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim();
  const findButton = (pattern) => {
    for (const area of document.querySelectorAll(UP_NEXT_AREA)) {
      for (const el of area.querySelectorAll('button, a, [role="button"]')) {
        if (pattern.test(label(el)) && el.offsetParent !== null) return el;
      }
    }
    return null;
  };

  const onEnded = (event) => {
    if (!(event.target instanceof HTMLVideoElement) || location.pathname !== '/watch') return;
    const { autoplayNext = true, skipAutoplayDelay = true, queueHasItems = false } = config();
    // With a queue, the app plays the next queued video; YouTube's own up-next is cancelled.
    const playYouTubesNext = autoplayNext && !queueHasItems;
    if (playYouTubesNext && !skipAutoplayDelay) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const button = findButton(playYouTubesNext ? PLAY_NEXT : CANCEL);
      if (button) { button.click(); clearInterval(timer); }
      if (tries > 30) clearInterval(timer);
    }, 100);
  };
  document.addEventListener('ended', onEnded, true);

  // YouTube mutes a video it autoplays (then shows "Tap to unmute") because web pages usually can't autoplay
  // sound. The app can, so on watch and Shorts pages the page may not mute the player by itself: it starts with
  // sound from the first frame, no flash of the muted state. The user's own mute (a tap) still goes through, and
  // feed previews stay muted.
  const mutedProperty = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
  const blocksAutoMute = (el) => {
    const path = location.pathname;
    if (path !== '/watch' && !path.startsWith('/shorts')) return false;
    if (navigator.userActivation && navigator.userActivation.isActive) return false;
    // SponsorBlock muting a segment (sponsorblock.js).
    if (window.__abtMuting) return false;
    return !!(el.closest && el.closest('.html5-video-player'));
  };
  if (mutedProperty && mutedProperty.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
      configurable: true,
      enumerable: mutedProperty.enumerable,
      get() { return mutedProperty.get.call(this); },
      set(value) { mutedProperty.set.call(this, value && blocksAutoMute(this) ? false : value); },
    });
  }

  // Videos and Shorts play with sound, like the YouTube app. YouTube starts them muted ("Tap to unmute") because a
  // web page usually can't autoplay sound; the app can, so each one is unmuted through YouTube's own player as it
  // starts: on `play`, before the first frame, since turning the sound (or the quality) on once frames are moving
  // stalls playback for a moment. `playing` is the backstop. Once per page, so a video the user mutes stays muted.
  let unmutedPage = null;
  const onStart = (event) => {
    const video = event.target;
    const path = location.pathname;
    if (!(video instanceof HTMLVideoElement) || !(path.startsWith('/shorts') || path === '/watch')) return;
    if (unmutedPage === location.href) return;
    unmutedPage = location.href;
    applyPreferences(video);
    const player = video.closest('.html5-video-player');
    if (player && typeof player.isMuted === 'function' && typeof player.unMute === 'function') {
      if (player.isMuted()) player.unMute();
    }
    if (video.muted) video.muted = false;
  };
  document.addEventListener('play', onStart, true);
  document.addEventListener('playing', onStart, true);

  // The app's quality menu: apply the newly chosen quality to what's playing now.
  window.__abtApplyQuality = () => {
    const video = [...document.querySelectorAll('video')].find((v) => !v.paused) || document.querySelector('video');
    if (video) applyPreferences(video);
  };

  // The app's default quality and speed, once per video: the highest available quality up to the chosen one, and
  // the default speed unless 2× is locked. YouTube's player API, so its own menus stay in sync.
  const QUALITY_ORDER = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'highres'];
  function applyPreferences(video) {
    const { videoQuality = 'auto', defaultSpeed = 1 } = config();
    const player = video.closest('.html5-video-player');
    // Not on Shorts: a forced quality switches streams as each one starts, a stall on every swipe for a clip
    // that's over in seconds.
    if (player && videoQuality !== 'auto' && !location.pathname.startsWith('/shorts')
        && typeof player.getAvailableQualityLevels === 'function') {
      const cap = QUALITY_ORDER.indexOf(videoQuality);
      const pick = player.getAvailableQualityLevels()
        .filter((q) => QUALITY_ORDER.indexOf(q) >= 0 && QUALITY_ORDER.indexOf(q) <= cap)
        .sort((a, b) => QUALITY_ORDER.indexOf(b) - QUALITY_ORDER.indexOf(a))[0];
      if (pick && typeof player.setPlaybackQualityRange === 'function') player.setPlaybackQualityRange(pick, pick);
    }
    if (defaultSpeed !== 1 && video.playbackRate === 1 && !window.__abtSpeedHolding) video.playbackRate = defaultSpeed;
  }
})();

// Previous / next video (on every YouTube page, not just the player's, so YouTube's own ±10 s handlers never
// take the lock screen), for the app's mini player and the lock screen (which then shows track buttons instead of
// ±10 seconds). Next goes through the app first, so the Up Next queue wins over YouTube's own next video.
(() => {
  const click = (selector) => {
    const el = document.querySelector(selector);
    if (!el || el.disabled || el.classList.contains('icon-disable')) return false;
    el.click();
    return true;
  };
  window.__abtPlayer = {
    next: () => click('button.player-middle-controls-prev-next-button[aria-label="Next video"]'),
    // Like music players: the start of this video, or the one before when already near the start.
    previous: () => {
      const v = document.querySelector('video');
      if (v && v.currentTime > 3) { v.currentTime = 0; return true; }
      if (click('button.player-middle-controls-prev-next-button[aria-label="Previous video"]')) return true;
      if (v) v.currentTime = 0;
      return true;
    },
  };

  const post = (type) => {
    try { window.webkit.messageHandlers.abtNav.postMessage({ type }); } catch (_) {}
  };
  const session = navigator.mediaSession;
  if (!session || !session.setActionHandler) return;
  const original = MediaSession.prototype.setActionHandler;
  const set = (action, handler) => {
    try { original.call(session, action, handler); } catch (_) {}
  };
  const ours = () => {
    set('nexttrack', () => post('nextTrack'));
    set('previoustrack', () => post('previousTrack'));
    set('seekbackward', null);
    set('seekforward', null);
  };
  // YouTube may register its own handlers per video; ours stay in place, and are set again as each video starts
  // (WebKit can drop a page's handlers when its media changes).
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
})();
