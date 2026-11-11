// Removes ads from YouTube and YouTube Music playback.
// 1) Strips ad fields from player data before the player reads it (initial page data, JSON.parse, fetch).
// 2) Fallback: if an ad still starts, mute it, jump to its end and press skip.
(() => {
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  // Shorts ads arrive as entries in the Shorts feed, marked as ads in their watch command.
  const isShortsAd = (entry) => {
    const endpoint = entry && entry.command && entry.command.reelWatchEndpoint;
    return !!(endpoint && endpoint.adClientParams && endpoint.adClientParams.isAd);
  };
  // Tells the app an ad was removed (Settings shows the count): once per video, since the same player data
  // is read several times.
  const counted = new Set();
  const report = (key, count = 1) => {
    if (counted.has(key)) return;
    if (counted.size > 200) counted.clear();
    counted.add(key);
    try { window.webkit.messageHandlers.abtNav.postMessage({ type: 'adBlocked', count }); } catch (_) {}
  };
  const strip = (value) => {
    if (!value || typeof value !== 'object') return value;
    let hadAds = false;
    for (const key of AD_KEYS) {
      if (key in value) {
        // Ad breaks, not the heartbeat field alone (it comes without ads too).
        if (key !== 'adBreakHeartbeatParams' && (!Array.isArray(value[key]) || value[key].length)) hadAds = true;
        delete value[key];
      }
    }
    if (hadAds) report((value.videoDetails && value.videoDetails.videoId) || location.href);
    if (value.playerResponse && typeof value.playerResponse === 'object') strip(value.playerResponse);
    if (Array.isArray(value.entries) && value.entries.some(isShortsAd)) {
      const kept = value.entries.filter((entry) => !isShortsAd(entry));
      const ids = value.entries.filter(isShortsAd).map((entry) => entry.command.reelWatchEndpoint.videoId || '');
      report('shorts:' + ids.join(','), value.entries.length - kept.length);
      value.entries = kept;
    }
    return value;
  };

  for (const name of ['ytInitialPlayerResponse', 'playerResponse']) {
    let stored;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => stored,
        set: (value) => { stored = strip(value); },
      });
    } catch (_) {}
  }

  const parse = JSON.parse;
  JSON.parse = function (...args) { return strip(parse.apply(this, args)); };

  // The next Shorts' first frames, fetched and decoded ahead. YouTube asks for a Short's frame only once the
  // one before it is on screen, so a quick swipe showed black where the next Short should be.
  const preloaded = new Set();
  const preloadShorts = (text) => {
    const ids = [...text.matchAll(/"reelWatchEndpoint":\{[^{}]*?"videoId":"([\w-]{11})"/g)].map((m) => m[1]);
    for (const id of ids.filter((id) => !preloaded.has(id)).slice(0, 4)) {
      preloaded.add(id);
      const image = new Image();
      image.src = `https://i.ytimg.com/vi/${id}/frame0.jpg`;
      image.decode().catch(() => {});
    }
  };

  const PLAYER_ENDPOINT = /\/youtubei\/v1\/(player|next|reel\/reel_watch_sequence)/;
  const HAS_ADS = /"(adPlacements|adSlots|playerAds|adBreakHeartbeatParams|adClientParams)"/;
  const fetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await fetch.call(this, input, init);
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!PLAYER_ENDPOINT.test(url)) return response;
    try {
      const text = await response.clone().text();
      if (url.includes('reel_watch_sequence')) preloadShorts(text);
      // Most responses carry no ads: they go through untouched, without being parsed and re-encoded on the
      // page's main thread (that work landed right as each Short started, and showed as a stutter).
      if (!HAS_ADS.test(text)) return response;
      return new Response(JSON.stringify(strip(parse(text))), {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } catch (_) {
      return response;
    }
  };

  const SKIP = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytm-skip-ad-button';
  let adShowing = false;
  const skipAd = () => {
    const player = document.querySelector('.ad-showing, .ad-interrupting');
    if (!player) { adShowing = false; return; }
    // An ad got through and is being skipped: one count per ad, not per check.
    if (!adShowing) { adShowing = true; report('shown:' + Date.now()); }
    const video = player.querySelector('video');
    // Shorts loop, so jumping to the end would seek forever (and stutter); there the skip button is enough.
    const isShorts = location.pathname.startsWith('/shorts');
    if (video && !isShorts) {
      video.muted = true;
      if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
    }
    const button = document.querySelector(SKIP);
    if (button) button.click();
  };
  // A cheap check twice a second (a page-wide class observer fires thousands of times while scrolling).
  setInterval(skipAd, 500);
})();
