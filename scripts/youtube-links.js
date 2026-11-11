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

// Feeds never play: real playback happens in the native player, and previews in the background tabs only cost
// battery and smoothness. They never make a sound either: every feed page carries the site's own player, sound
// on, and one that had a video in it was started again by WebKit with the app off screen, where the page's
// scripts are too slow (or asleep) to pause it: on 11 Nov a video from the home feed played over the one in the
// player. A muted video takes no audio, whoever starts it. Shorts (which play in their own tab) are left alone.
(() => {
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };
  const silence = (event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || location.pathname.startsWith('/shorts')) return;
    const loud = !video.muted;
    if (loud) video.muted = true;
    if (video.paused || event.type === 'loadstart' || event.type === 'volumechange') return;
    // For the debug journal: which feed video tried to play, and whether it had its sound on.
    if (event.type !== 'timeupdate' || loud) {
      post({ type: 'feedPlay', event: event.type, loud, time: Math.round(video.currentTime), url: location.pathname });
    }
    video.pause();
  };
  for (const type of ['loadstart', 'play', 'playing', 'timeupdate', 'volumechange']) {
    document.addEventListener(type, silence, true);
  }
  // The player that's already there when the page starts.
  const muteAll = () => { for (const video of document.querySelectorAll('video')) silence({ target: video, type: 'loadstart' }); };
  document.addEventListener('DOMContentLoaded', muteAll);
  window.addEventListener('load', muteAll);
})();
