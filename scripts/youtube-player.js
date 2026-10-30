// The native video player's page (a YouTube watch page): related videos stay in the player; other links
// (channels, hashtags) open in the app and the player shrinks; a swipe down on the video minimizes it,
// like the YouTube app.
(() => {
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    let url;
    try { url = new URL(link.getAttribute('href'), location.href); } catch (_) { return; }
    if (url.pathname === '/watch' || url.href.startsWith('javascript:')) return;
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
})();
