// Pages behave like app screens: no pinch zoom (apps don't zoom their UI; videos still go fullscreen).
(() => {
  const lock = () => {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      (document.head || document.documentElement).appendChild(meta);
    }
    const content = (meta.getAttribute('content') || 'width=device-width, initial-scale=1')
      .split(',').map((part) => part.trim())
      .filter((part) => part && !/^(maximum-scale|minimum-scale|user-scalable)=/i.test(part));
    meta.setAttribute('content', content.concat(['maximum-scale=1', 'user-scalable=no']).join(', '));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lock); else lock();
})();

// Tells the app once the page has drawn real content, and again after each in-page navigation, so its placeholders
// give way to a finished page in one go instead of pieces appearing one by one. Finished means the page has stopped
// changing for a moment (the video player's own ticking doesn't count) and the images on screen have loaded; never
// more than a few seconds.
(() => {
  if (window.top !== window) return;
  const post = (message) => window.webkit?.messageHandlers?.abtNav?.postMessage(message);
  const QUIET_MS = 300;
  const LIMIT_MS = 4000;
  const PLAYER = '#player-container-id, .html5-video-player, ytmusic-player, ytm-shorts-player';
  let run = 0;
  const imagesReady = () => [...document.images].every((img) => {
    const r = img.getBoundingClientRect();
    if (r.width < 40 || r.bottom < 0 || r.top > innerHeight) return true;
    return img.complete;
  });
  // A page that has drawn something real: a loaded image or a video on screen. An empty document passes
  // imagesReady() vacuously, and feeds fill in only after DOMContentLoaded.
  const hasContent = () => [...document.images].some((img) => {
      const r = img.getBoundingClientRect();
      return r.width >= 40 && r.bottom > 0 && r.top < innerHeight && img.complete && img.naturalWidth > 0;
    }) || [...document.querySelectorAll('video')].some((video) => {
      const r = video.getBoundingClientRect();
      return r.width >= 40 && r.bottom > 0 && r.top < innerHeight;
    });
  // A Short on its first paint: the skeleton stays until the video can really play, and the video is held
  // paused under it. The hold starts with the document (YouTube starts the Short long before
  // DOMContentLoaded), and lets go only when the app says the skeleton has gone (`__abtReleaseShort`), so no
  // sound plays under the skeleton.
  // Not where it is: YouTube parks the Short's one video off screen until it plays.
  const shortsVideoReady = () => [...document.querySelectorAll('video')]
    .some((video) => video.readyState >= 3 && video.videoWidth > 0);
  const shortHold = location.pathname.startsWith('/shorts') ? (() => {
    const held = new Set();
    // Paused the moment it starts (a play event fires before any sound), and polled as a backstop.
    const hold = (video) => {
      if (video instanceof HTMLVideoElement && !video.paused) { video.pause(); held.add(video); }
    };
    const onPlay = (event) => hold(event.target);
    document.addEventListener('play', onPlay, true);
    const poll = setInterval(() => document.querySelectorAll('video').forEach(hold), 30);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      document.removeEventListener('play', onPlay, true);
      clearInterval(poll);
      held.forEach((video) => video.play().catch(() => {}));
    };
    // Never held for good, e.g. when the page moves on before its first paint is reported.
    setTimeout(release, LIMIT_MS * 2 + 1500);
    return { release };
  })() : null;
  const settle = (type) => {
    const id = ++run;
    let timer = null;
    const holdShort = type === 'painted' && !!shortHold;
    const finish = () => {
      if (id !== run) return;
      run += 1;
      observer.disconnect();
      clearTimeout(timer);
      if (holdShort) {
        window.__abtReleaseShort = shortHold.release;
        // In case the app never answers.
        setTimeout(shortHold.release, 1500);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => post({ type, path: location.pathname })));
    };
    const wait = () => {
      clearTimeout(timer);
      // The first paint waits for real content on screen; in-page moves already have theirs.
      const ready = type === 'painted'
        ? hasContent() && imagesReady() && (!holdShort || shortsVideoReady())
        : imagesReady();
      timer = setTimeout(() => (ready ? finish() : wait()), QUIET_MS);
    };
    const observer = new MutationObserver((records) => {
      if (records.some((r) => !(r.target.closest && r.target.closest(PLAYER)))) wait();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    wait();
    // The limit lets go of the placeholder only once something is really on screen; a page whose
    // content never comes (an empty or broken page) is let go at twice the limit.
    setTimeout(() => { if (type === 'painted' && !hasContent()) return; finish(); }, LIMIT_MS);
    setTimeout(finish, LIMIT_MS * 2);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => settle('painted'), { once: true });
  else settle('painted');

  // Single-page sites move between pages with pushState (and back with popstate); replaceState only tidies the URL.
  // Not from one Short to the next: the app shows no placeholders for those, and watching every DOM change
  // through a swipe cost the page frames.
  const navigated = (before) => {
    if (before && before.startsWith('/shorts') && location.pathname.startsWith('/shorts')) return;
    post({ type: 'navigating', path: location.pathname });
    settle('settled');
  };
  const push = history.pushState;
  history.pushState = function (...args) {
    const before = location.pathname + location.search;
    const result = push.apply(this, args);
    if (location.pathname + location.search !== before) navigated(before);
    return result;
  };
  window.addEventListener('popstate', () => navigated());
})();

// The first touch in the page: from then on, whatever plays is the user's doing (see TabWebSession.quietUntil).
(() => {
  if (window.top !== window) return;
  document.addEventListener('touchstart', () => {
    window.webkit?.messageHandlers?.abtNav?.postMessage({ type: 'touched' });
  }, { capture: true, passive: true, once: true });
})();
