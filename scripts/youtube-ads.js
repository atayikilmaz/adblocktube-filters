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
  // Page-load diagnostics for the app (`PageLoadReport`): the last YouTube API answers (endpoint and status, never
  // the query or body) and the last script errors, read when an account page (You, Subscriptions…) comes up empty.
  const requests = (window.__abtRequests = []);
  const errors = (window.__abtErrors = []);
  const note = (list, entry) => { list.push(entry); if (list.length > 20) list.shift(); };
  const API = /\/youtubei\/v1\/([\w/]+)/;
  window.addEventListener('error', (event) => {
    note(errors, String(event.message || 'error').slice(0, 80));
  });
  // An account page whose screen stays empty (Nov 2026: You shows nothing, signed in, every API answer fine): says
  // whether its content is in the page but hidden, what hides it, and what YouTube's own page data holds. It goes
  // to the app with the errors above (`PageLoadReport` sends the last three to Crashlytics).
  const describeEmptyPage = () => {
    const body = document.body;
    if (!body || body.innerText.trim().length > 0) return;
    const hides = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none') return 'display';
      if (s.visibility === 'hidden') return 'visibility';
      if (Number(s.opacity) === 0) return 'opacity';
      const r = el.getBoundingClientRect();
      if (r.height === 0 && s.overflow !== 'visible') return 'height';
      return '';
    };
    const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
      + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
    // The element holding the most text, and the highest box above it that hides it.
    let richest = null;
    // The page's own content, not YouTube's header and tab bar (always hidden: the app has its own).
    const CHROME = 'ytm-mobile-topbar-renderer, ytm-pivot-bar-renderer, style, script, noscript, template';
    for (const el of document.querySelectorAll('ytm-browse *, ytm-app *')) {
      if (el.children.length === 0 && el.textContent.trim().length > 3 && !el.closest(CHROME)) { richest = el; break; }
    }
    // The nearest box above it that hides it: display, visibility or opacity first; a zero height only when none
    // does (a box whose only child is hidden collapses too).
    let hidden = '';
    let collapsed = '';
    for (let el = richest; el && el !== document.documentElement; el = el.parentElement) {
      const why = hides(el);
      if (why === 'height') { collapsed = collapsed || name(el) + ':height'; continue; }
      if (why) { hidden = name(el) + ':' + why; break; }
    }
    hidden = hidden || collapsed || (richest ? 'none' : 'no text in page');
    let data = '-';
    try {
      const tabs = window.ytInitialData && ytInitialData.contents
        && Object.values(ytInitialData.contents)[0];
      const keys = JSON.stringify(tabs || {}).match(/"(\w+(Renderer|ViewModel))"/g) || [];
      data = [...new Set(keys.map((k) => k.slice(1, -1)))].slice(0, 8).join(',');
    } catch (_) {}
    const chain = [];
    for (let el = document.querySelector('ytm-app'), d = 0; el && d < 6; d += 1) {
      chain.push(name(el) + (hides(el) ? '!' + hides(el) : ''));
      el = [...el.children].sort((a, b) => b.textContent.length - a.textContent.length)[0];
    }
    const app = document.querySelector('ytm-app');
    const browseId = (window.ytCommand && window.ytCommand.browseEndpoint && window.ytCommand.browseEndpoint.browseId) || '-';
    const entry = `dom: text=${app ? app.textContent.trim().length : -1} ready=${document.readyState} browse=${browseId} hidden=${hidden}`
      + ` chain=${chain.join('>')} data=${data || '-'}`;
    const at = errors.findIndex((e) => e.startsWith('dom: '));
    if (at >= 0) errors.splice(at, 1);
    errors.push(entry.slice(0, 600));
  };
  if (/^\/(feed\/|playlist)/.test(location.pathname)) {
    setTimeout(describeEmptyPage, 6000);
    setTimeout(describeEmptyPage, 11000);
  }
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    note(errors, ('rejection: ' + String((reason && reason.message) || reason)).slice(0, 80));
  });

  const fetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && (input.url || input.href)) || '';
    const api = API.exec(url);
    let response;
    try {
      response = await fetch.call(this, input, init);
    } catch (error) {
      if (api) note(requests, api[1] + ':failed');
      throw error;
    }
    if (api) note(requests, api[1] + ':' + response.status);
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
