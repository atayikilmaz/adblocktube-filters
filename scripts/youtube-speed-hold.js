// Hold for 2× on YouTube Shorts (and on regular videos when `holdForSpeedOnVideos` is on).
// - Press and hold the video: 2× while held, back to normal on release.
// - While holding, slide down to lock 2×; the app's badge fills a ring as the finger slides (as in X). The lock
//   carries over to the next Short. Holding and sliding down again while locked fills the ring back to 1×.
// - The app shows a native "2×" pill; tapping it calls `__abt.unlockSpeed()`.
// A vertical swipe before the hold kicks in is left alone, so scrolling Shorts still works.
(() => {
  const HOLD_MS = 350;
  const MOVE_CANCEL_PX = 12;
  const LOCK_SLIDE_PX = 90;
  const FAST = 2;

  const post = (state, progress = 0) => {
    try { window.webkit.messageHandlers.abtMedia.postMessage({ type: 'speedHold', state, progress }); } catch (_) {}
  };
  let sentProgress = 0;

  let timer = null;
  let holding = false;
  // Holding while 2× is locked: a slide down returns to 1×.
  let unlocking = false;
  let locked = false;
  let startX = 0;
  let startY = 0;
  let video = null;
  let normalRate = 1;
  let touchTarget = null;

  // YouTube opens its own menu on long-press. Tell it the touch was cancelled once our hold takes over.
  const cancelSiteLongPress = (touch) => {
    if (!touchTarget) return;
    try {
      const t = new Touch({ identifier: touch.identifier, target: touchTarget, clientX: touch.clientX,
        clientY: touch.clientY, pageX: touch.pageX, pageY: touch.pageY });
      touchTarget.dispatchEvent(new TouchEvent('touchcancel', {
        bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t],
      }));
    } catch (_) {}
  };

  const onShorts = () => location.pathname.startsWith('/shorts/');
  const enabledHere = () =>
    onShorts() || (location.pathname === '/watch' && (window.__abtConfig || {}).holdForSpeedOnVideos);

  const videoUnder = (touch) => {
    const hit = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!hit) return null;
    // Only on the video itself: a hold on a list item (the related videos under the player) is for its menu.
    const container = hit.closest('ytm-reel-video-renderer, ytm-shorts-player, #player, .player-container, ytm-reel-player-overlay-renderer, #player-container-id, .html5-video-player');
    if (!container) return null;
    const found = container.querySelector('video');
    return found && !found.paused ? found : null;
  };

  const cancelTimer = () => { clearTimeout(timer); timer = null; };

  const lock = () => {
    if (locked || !holding) return;
    locked = true;
    post('locked');
  };

  const release = () => {
    if (unlocking) {
      unlocking = false;
      holding = false;
      window.__abtSpeedHolding = false;
      window.__abtSpeedHoldEndedAt = Date.now();
      post(locked ? 'locked' : 'off');
      return;
    }
    holding = false;
    window.__abtSpeedHolding = false;
    window.__abtSpeedHoldEndedAt = Date.now();
    if (!locked && video) video.playbackRate = normalRate;
    post(locked ? 'locked' : 'off');
  };

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || !enabledHere()) return;
    const touch = event.touches[0];
    const target = videoUnder(touch);
    if (!target) return;
    startX = touch.clientX;
    startY = touch.clientY;
    touchTarget = event.target;
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      cancelSiteLongPress(touch);
      if (locked) {
        video = target;
        holding = true;
        unlocking = true;
        window.__abtSpeedHolding = true;
        sentProgress = 0;
        post('unlocking');
        return;
      }
      video = target;
      normalRate = locked ? 1 : (video.playbackRate === FAST ? 1 : video.playbackRate);
      video.playbackRate = FAST;
      holding = true;
      window.__abtSpeedHolding = true;
      sentProgress = 0;
      post(locked ? 'locked' : 'holding');
    }, HOLD_MS);
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (timer && Math.hypot(dx, dy) > MOVE_CANCEL_PX) { cancelTimer(); return; }
    if (!holding) return;
    // While holding: stop the feed from scrolling, and slide down to lock.
    event.preventDefault();
    event.stopPropagation();
    if (unlocking) {
      if (!locked) return;
      if (dy >= LOCK_SLIDE_PX) {
        locked = false;
        normalRate = 1;
        if (video) video.playbackRate = 1;
        post('off');
        return;
      }
      const back = Math.max(0, dy) / LOCK_SLIDE_PX;
      if (Math.abs(back - sentProgress) >= 0.03) { sentProgress = back; post('unlocking', back); }
      return;
    }
    if (locked) return;
    if (dy >= LOCK_SLIDE_PX) { lock(); return; }
    // The ring follows the finger; only send when it has moved noticeably.
    const progress = Math.max(0, dy) / LOCK_SLIDE_PX;
    if (Math.abs(progress - sentProgress) >= 0.03) {
      sentProgress = progress;
      post('holding', progress);
    }
  }, { capture: true, passive: false });

  const end = (event) => {
    if (!event.isTrusted) return;
    if (timer) { cancelTimer(); return; }
    if (!holding) return;
    // Swallow the tap that would otherwise pause the video.
    event.preventDefault();
    event.stopPropagation();
    release();
  };
  document.addEventListener('touchend', end, { capture: true, passive: false });
  document.addEventListener('touchcancel', end, { capture: true, passive: false });
  document.addEventListener('click', (event) => {
    if (holding) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  // YouTube's own long-press menu would fight the hold.
  document.addEventListener('contextmenu', (event) => { if (holding) event.preventDefault(); }, true);

  // The lock carries to every new Short (and survives YouTube resetting the rate).
  const reapply = (event) => {
    const el = event.target;
    if (!locked || !(el instanceof HTMLVideoElement) || !enabledHere()) return;
    if (el.playbackRate !== FAST) el.playbackRate = FAST;
    video = el;
  };
  document.addEventListener('playing', reapply, true);
  document.addEventListener('ratechange', reapply, true);

  const install = () => {
    if (!window.__abt) return setTimeout(install, 50);
    window.__abt.unlockSpeed = () => {
      locked = false;
      holding = false;
      if (video) video.playbackRate = 1;
      post('off');
    };
  };
  install();
})();
