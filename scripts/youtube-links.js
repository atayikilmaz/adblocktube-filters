// YouTube browsing tabs: videos open in the app's native player (so the feed never navigates away and keeps
// its scroll position), and Shorts open in the Shorts tab. Matched on link targets, not YouTube's class names.
(() => {
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };
  const isYouTube = (url) => /(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === 'youtu.be';

  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    let url;
    try { url = new URL(link.getAttribute('href'), location.href); } catch (_) { return; }
    if (!isYouTube(url)) return;
    const isVideo = (url.pathname === '/watch' && url.searchParams.get('v')) || url.hostname === 'youtu.be';
    const isShort = url.pathname.startsWith('/shorts/') && !location.pathname.startsWith('/shorts');
    if (!isVideo && !isShort) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    post({ type: isVideo ? 'openVideo' : 'openShorts', url: url.href });
  }, true);
})();

// Feeds don't autoplay muted previews: real playback happens in the native player, and previews in the
// background tabs only cost battery and smoothness. Shorts (which play in their own tab) are left alone.
(() => {
  document.addEventListener('play', (event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || location.pathname.startsWith('/shorts')) return;
    video.pause();
  }, true);
})();
