// The app's own Shorts player (Features/Shorts): YouTube's embed player, one per web view, driven by the app. Each
// Short is preloaded (started muted and held at its first frame) so it plays the moment it's swiped to; it plays,
// pauses and loops on the app's word and reports its state. shorts-embed.css hides the embed's own overlay.
(() => {
  if (window.top !== window || !location.pathname.startsWith('/embed/')) return;
  const post = (message) => { try { window.webkit.messageHandlers.abtShorts.postMessage(message); } catch (_) {} };
  const player = () => document.getElementById('movie_player');
  const video = () => document.querySelector('video');
  let id = location.pathname.split('/')[2] || '';
  // The app wants it playing (it's the Short on screen).
  let wanted = false;
  let ready = false;
  let failed = false;
  let loadedAt = performance.now();
  // Hold for 2× (the app's gesture). YouTube resets the speed for each video, so it's put back as each one starts.
  let rate = 1;
  const applyRate = () => {
    const v = video();
    if (v && v.playbackRate !== rate) v.playbackRate = rate;
  };
  document.addEventListener('playing', applyRate, true);
  document.addEventListener('ratechange', applyRate, true);

  const report = () => {
    const v = video();
    post({
      type: 'state', id,
      playing: wanted && !!v && !v.paused,
      time: v ? v.currentTime : 0,
      duration: v && isFinite(v.duration) ? v.duration : 0,
    });
  };
  const checkReady = () => {
    const v = video();
    if (ready || !v || v.readyState < 2 || v.videoWidth === 0) return;
    ready = true;
    post({ type: 'ready', id });
  };
  const unmute = () => {
    const p = player();
    if (p && p.isMuted && p.isMuted()) p.unMute();
    const v = video();
    if (v) v.muted = false;
  };
  const start = () => {
    const p = player();
    unmute();
    if (p && p.playVideo) p.playVideo(); else if (video()) video().play().catch(() => {});
  };
  // Loads the stream and its first frames without a sound; the `playing` handler holds it at the start.
  const prime = () => {
    if (wanted) { start(); return; }
    const p = player();
    if (p && p.mute) p.mute();
    if (video()) video().muted = true;
    if (p && p.playVideo) p.playVideo(); else if (video()) video().play().catch(() => {});
  };

  document.addEventListener('playing', (event) => {
    const v = event.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (wanted) {
      unmute();
    } else {
      const p = player();
      if (p && p.pauseVideo) p.pauseVideo(); else v.pause();
      v.currentTime = 0;
    }
    checkReady();
    report();
  }, true);
  for (const type of ['pause', 'waiting', 'loadeddata', 'canplay', 'seeked']) {
    document.addEventListener(type, () => { checkReady(); report(); }, true);
  }
  document.addEventListener('ended', (event) => {
    if (!wanted) return;
    event.target.currentTime = 0;
    start();
  }, true);
  let lastReport = 0;
  document.addEventListener('timeupdate', () => {
    const now = performance.now();
    if (!wanted || now - lastReport < 200) return;
    lastReport = now;
    report();
  }, true);

  // A Short that can't play here (embedding turned off, removed): the app shows it on YouTube's own page instead.
  setInterval(() => {
    if (failed || performance.now() - loadedAt < 800) return;
    const error = document.querySelector('.ytp-error');
    if (error && error.getClientRects().length > 0) {
      failed = true;
      post({ type: 'error', id, message: (error.innerText || '').trim().slice(0, 200) });
    }
  }, 400);

  window.__abtShort = {
    load(next) {
      if (next === id && !failed) return;
      const p = player();
      if (failed || !p || !p.loadVideoById) {
        location.replace(`/embed/${next}${location.search}`);
        return;
      }
      id = next;
      ready = false;
      loadedAt = performance.now();
      if (!wanted && p.mute) p.mute();
      p.loadVideoById({ videoId: next });
    },
    play() { wanted = true; start(); report(); },
    // Muted too: a paused Short with its sound on stays WebKit's pick for the lock screen, and came back there
    // later in place of what played since. Playing turns the sound back on.
    pause() {
      wanted = false;
      const p = player();
      if (p && p.pauseVideo) p.pauseVideo(); else if (video()) video().pause();
      if (p && p.mute) p.mute();
      if (video()) video().muted = true;
      report();
    },
    setRate(value) { rate = value; applyRate(); },
    // Fill the screen (cropping the sides) or fit the whole video (shorts-embed.css).
    setFill(on) { document.documentElement.classList.toggle('abt-fill', !!on); },
    seek(seconds) {
      const p = player();
      if (p && p.seekTo) p.seekTo(seconds, true); else if (video()) video().currentTime = seconds;
    },
  };

  // Once YouTube's player is up: tell the app, and start loading the Short.
  const began = performance.now();
  const boot = setInterval(() => {
    const p = player();
    if (p && p.playVideo) {
      clearInterval(boot);
      post({ type: 'loaded', id });
      prime();
    } else if (performance.now() - began > 15000) {
      clearInterval(boot);
    }
  }, 100);
})();
