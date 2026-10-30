// Connects the page's audio/video to the app's native player UI (mini player, Now Playing, sleep timer, PiP).
// Reports state to `window.webkit.messageHandlers.abtMedia`; the app calls `window.__abt.*` to control playback.
(() => {
  if (window.__abt) return;
  const post = (message) => {
    try { window.webkit.messageHandlers.abtMedia.postMessage(message); } catch (_) {}
  };

  let active = null;
  let lastTick = 0;
  let fadeTimer = null;

  const isMedia = (el) => el instanceof HTMLMediaElement;
  // Muted, tiny or ad media (feed previews, ad slots) never becomes "now playing". A hidden player (no size at
  // all, like YouTube Music's) is audio playback, so it counts.
  const isHidden = (el) => el.clientWidth === 0 && el.clientHeight === 0;
  const isRealPlayback = (el) =>
    !el.muted && el.closest('.ad-showing, .ad-interrupting') === null &&
    (el instanceof HTMLAudioElement || isHidden(el) || (el.clientWidth >= 120 && el.clientHeight >= 68) ||
      document.pictureInPictureElement === el || el.webkitDisplayingFullscreen);

  const metadata = () => {
    const meta = navigator.mediaSession && navigator.mediaSession.metadata;
    const artwork = meta && meta.artwork && meta.artwork.length ? meta.artwork[meta.artwork.length - 1].src : null;
    const ogImage = document.querySelector('meta[property="og:image"]');
    return {
      title: (meta && meta.title) || document.title.replace(/ - YouTube( Music)?$/, ''),
      artist: (meta && meta.artist) || '',
      artwork: artwork || (ogImage && ogImage.content) || null,
    };
  };

  // The lock screen, Control Center and Dynamic Island show the page's media info. YouTube's mobile site leaves
  // out artwork, so the video's thumbnail (or the page's preview image) is filled in.
  const ensureArtwork = () => {
    const session = navigator.mediaSession;
    if (!session || typeof MediaMetadata === 'undefined') return;
    const current = session.metadata;
    if (current && current.artwork && current.artwork.length) return;
    const id = new URLSearchParams(location.search).get('v') || (location.pathname.match(/\/shorts\/([\w-]{11})/) || [])[1];
    const preview = document.querySelector('meta[property="og:image"]');
    const src = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : preview && preview.content;
    if (!src) return;
    const info = metadata();
    try {
      session.metadata = new MediaMetadata({
        title: info.title, artist: info.artist, album: (current && current.album) || '',
        artwork: [{ src, sizes: '480x360', type: 'image/jpeg' }],
      });
    } catch (_) {}
  };

  const state = (type, el) => ({
    type,
    currentTime: Number.isFinite(el.currentTime) ? el.currentTime : 0,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    paused: el.paused,
    rate: el.playbackRate,
    isVideo: el instanceof HTMLVideoElement,
    pageURL: location.href,
    ...metadata(),
  });

  const handle = (event) => {
    const el = event.target;
    if (!isMedia(el)) return;
    switch (event.type) {
      case 'playing':
        if (!isRealPlayback(el)) return;
        active = el;
        ensureArtwork();
        post(state('playing', el));
        break;
      case 'volumechange':
        // Muted previews that get unmuted (or a muted autoplay the user unmutes) become real playback.
        if (el !== active && !el.paused && isRealPlayback(el)) {
          active = el;
          post(state('playing', el));
        }
        break;
      case 'pause':
      case 'ended':
      case 'ratechange':
      case 'loadedmetadata':
        if (el === active) post(state(event.type, el));
        break;
      case 'timeupdate': {
        const now = Date.now();
        if (el === active && now - lastTick > 1000) {
          lastTick = now;
          ensureArtwork();
          post(state('timeupdate', el));
        }
        break;
      }
      case 'webkitbeginfullscreen':
        post({ type: 'fullscreen', on: true });
        break;
      case 'webkitendfullscreen':
        post({ type: 'fullscreen', on: false });
        break;
    }
  };
  for (const type of ['playing', 'volumechange', 'pause', 'ended', 'ratechange', 'loadedmetadata', 'timeupdate',
    'webkitbeginfullscreen', 'webkitendfullscreen']) {
    document.addEventListener(type, handle, true);
  }
  document.addEventListener('fullscreenchange', () => post({ type: 'fullscreen', on: !!document.fullscreenElement }));
  document.addEventListener('webkitfullscreenchange', () =>
    post({ type: 'fullscreen', on: !!document.webkitFullscreenElement }));

  const media = () => (active && active.isConnected ? active : document.querySelector('video, audio'));
  const withMedia = (fn) => { const el = media(); if (el) fn(el); return !!el; };

  window.__abt = {
    play: () => withMedia((el) => { el.volume = 1; el.play(); }),
    pause: () => withMedia((el) => el.pause()),
    toggle: () => withMedia((el) => (el.paused ? el.play() : el.pause())),
    seek: (time) => withMedia((el) => { el.currentTime = Math.max(0, time); }),
    skip: (delta) => withMedia((el) => { el.currentTime = Math.max(0, el.currentTime + delta); }),
    setRate: (rate) => withMedia((el) => { el.playbackRate = rate; }),
    pip: () => withMedia((el) => {
      if (!(el instanceof HTMLVideoElement)) return;
      // Sites (YouTube) opt their player out of PiP; we opt it back in.
      el.disablePictureInPicture = false;
      el.removeAttribute('disablepictureinpicture');
      const mode = el.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
      el.webkitSetPresentationMode(mode);
    }),
    // Leaving the app: float the playing video (never toggles it back to inline).
    enterPictureInPicture: () => withMedia((el) => {
      if (!(el instanceof HTMLVideoElement) || el.paused) return;
      el.disablePictureInPicture = false;
      el.removeAttribute('disablepictureinpicture');
      if (el.webkitPresentationMode !== 'picture-in-picture') el.webkitSetPresentationMode('picture-in-picture');
    }),
    // Back in the app: the floating video returns to the page.
    exitPictureInPicture: () => withMedia((el) => {
      if (el instanceof HTMLVideoElement && el.webkitPresentationMode === 'picture-in-picture') {
        el.webkitSetPresentationMode('inline');
      }
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    }),
    airplay: () => withMedia((el) => el.webkitShowPlaybackTargetPicker && el.webkitShowPlaybackTargetPicker()),
    // Native iOS player (system controls, PiP, AirPlay) instead of the site's own fullscreen.
    fullscreen: () => withMedia((el) => el instanceof HTMLVideoElement && el.webkitEnterFullscreen()),
    exitFullscreen: () => withMedia((el) => {
      if (el.webkitDisplayingFullscreen) el.webkitExitFullscreen();
      if (document.fullscreenElement) document.exitFullscreen();
    }),
    // In-page navigation (single-page sites): a same-origin link click the site's own router handles.
    navigate: (href) => {
      const link = document.createElement('a');
      link.href = href;
      link.style.display = 'none';
      (document.querySelector('ytm-app') || document.body).appendChild(link);
      link.click();
      link.remove();
      return true;
    },
    // After the app loads a queued video: YouTube starts it muted ("tap to unmute"); turn the sound on.
    unmuteWhenPlaying: () => {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        const el = document.querySelector('video');
        if (el && !el.paused && el.readyState > 2) {
          el.muted = false;
          el.volume = 1;
          const button = [...document.querySelectorAll('button, [role="button"]')]
            .find((b) => /unmute/i.test(b.getAttribute('aria-label') || b.textContent || ''));
          if (button) button.click();
          clearInterval(timer);
        }
        if (tries > 100) clearInterval(timer);
      }, 100);
      return true;
    },
    // The app resumed a saved video in the mini player: start it once it can play (an off-screen page doesn't
    // autoplay by itself).
    playWhenReady: () => {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        const el = document.querySelector('video');
        if (el && el.readyState >= 2) {
          if (el.paused) el.play();
          clearInterval(timer);
        }
        if (tries > 100) clearInterval(timer);
      }, 100);
      return true;
    },
    // Sleep timer: lower the volume over a few seconds, then pause.
    fadeOutAndPause: (seconds) => withMedia((el) => {
      clearInterval(fadeTimer);
      const start = el.volume;
      const steps = Math.max(1, Math.round(seconds * 10));
      let step = 0;
      fadeTimer = setInterval(() => {
        step += 1;
        el.volume = Math.max(0, start * (1 - step / steps));
        if (step >= steps) { clearInterval(fadeTimer); el.pause(); el.volume = start; }
      }, 100);
    }),
  };
})();
