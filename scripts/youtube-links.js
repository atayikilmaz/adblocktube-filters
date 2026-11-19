// YouTube browsing tabs: videos open in the app's native player (so the feed never navigates away and keeps
// its scroll position), and Shorts open in the Shorts tab. Matched on link targets, not YouTube's class names.
// Other pages (a channel, a playlist) open as a new page pushed over this one (`openPage`), as in a native app:
// YouTube rebuilds a page it goes back to with fresh items, so a feed left for a channel came back somewhere
// else entirely (16 Nov). A channel's own tabs (Videos, Playlists) stay in its page.
// Most ways into a channel are not links: the avatar beside a video is a button YouTube's own code follows. Its
// address is in the data YouTube keeps on the item's element (the avatar's own part of it, found by the avatar's
// element name), read as it is tapped. Stopping YouTube later, at its `pushState`, came too late: it empties the
// page whatever happens to the address.
(() => {
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };
  const isYouTube = (url) => /(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === 'youtu.be';
  // The page a URL belongs to: a channel with all its tabs, or the path and query.
  const pageOf = (url) => {
    const channel = url.pathname.match(/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/);
    return channel ? channel[1] : url.pathname + url.search;
  };
  // Not Home (YouTube's logo), searches (the app's Search tab takes them) or signing in and out.
  const staysInPage = (url) => url.pathname === '/' || url.pathname === '/results'
    || /^\/(signin|logout)/.test(url.pathname);
  // Only apps that can push pages say so (`__abtPushesPages`); older ones get this bundle too.
  const opensAsPage = (url) => !!window.__abtPushesPages && isYouTube(url) && url.hostname !== 'youtu.be'
    && url.pathname !== '/watch' && !url.pathname.startsWith('/shorts') && !staysInPage(url)
    && pageOf(url) !== pageOf(new URL(location.href));

  // A button's address, from the data of the item it sits in: `yt-decorated-avatar-view-model` is that data's
  // `decoratedAvatarViewModel`, whose tap command carries the URL. Only the element's own part: the item's data
  // holds every address in it (the video, the channel).
  const camel = (tag) => tag.toLowerCase().replace(/^(yt|ytm)-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const commandURL = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    const meta = obj.webCommandMetadata;
    if (meta && typeof meta.url === 'string') return meta.url;
    for (const key of Object.keys(obj)) {
      const found = commandURL(obj[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  const part = (obj, key, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    for (const k of Object.keys(obj)) {
      const found = part(obj[k], key, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const buttonURL = (target) => {
    const button = target.closest && target.closest('[role="button"], button');
    if (!button) return null;
    const tags = [];
    for (let el = button; el && el !== document.body; el = el.parentElement) {
      if (el.data && typeof el.data === 'object' && tags.length) {
        for (const tag of tags.slice(0, 2)) {
          const own = part(el.data, camel(tag), 0);
          if (own) return commandURL(own, 0);
        }
        return null;
      }
      if (el.tagName.includes('-')) tags.push(el.tagName);
    }
    return null;
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href]');
    let href = link && link.getAttribute('href');
    if (!link && window.__abtPushesPages) {
      try { href = buttonURL(event.target); } catch (_) { href = null; }
      // Only buttons that lead to another page; the rest (menus, likes) are YouTube's.
      if (!href) return;
      let target;
      try { target = new URL(href, location.href); } catch (_) { return; }
      if (!opensAsPage(target)) return;
    }
    if (!href) return;
    let url;
    try { url = new URL(href, location.href); } catch (_) { return; }
    if (!isYouTube(url)) return;
    const isVideo = (url.pathname === '/watch' && url.searchParams.get('v')) || url.hostname === 'youtu.be';
    const isShort = url.pathname.startsWith('/shorts/') && !location.pathname.startsWith('/shorts');
    const isPage = !isVideo && !isShort && opensAsPage(url);
    if (!isVideo && !isShort && !isPage) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    post({ type: isVideo ? 'openVideo' : isShort ? 'openShorts' : 'openPage', url: url.href });
  }, true);
})();

// YouTube's mobile web routes `/feed/you` to `browseId: "FEyou"` for a large experiment slice (~60% of accounts),
// returning an empty `ytInitialData` stub (only `responseContext`, no `contents`) that leaves `<ytm-browse>` blank
// with no error and no failed API call. YouTube's own mobile web "You" tab points to `/feed/library` (`FElibrary`),
// which always returns full contents. Rescue any restored or linked `/feed/you` page that comes back empty.
(() => {
  if (!/^\/feed\/you\/?$/.test(location.pathname)) return;
  const redirect = () => { location.replace('/feed/library'); };
  const checkInitial = () => {
    const browseId = window.ytCommand && window.ytCommand.browseEndpoint && window.ytCommand.browseEndpoint.browseId;
    const data = window.ytInitialData;
    if (browseId === 'FEyou' || (data && typeof data === 'object' && !data.contents)) {
      redirect();
      return;
    }
    setTimeout(() => {
      if (!/^\/feed\/you\/?$/.test(location.pathname)) return;
      const browse = document.querySelector('ytm-browse');
      const spinner = [...document.querySelectorAll('ytm-spinner, .spinner, [role="progressbar"]')]
        .some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (!spinner && (!browse || browse.innerText.trim().length === 0)) redirect();
    }, 3000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkInitial, { once: true });
  else checkInitial();
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
