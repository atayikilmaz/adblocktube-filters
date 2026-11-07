// YouTube Music with the app's own player (NativeMusicPlayer): the page browses, picks and queues, the app plays.
//
// The page's media is dead from birth rather than muted: every video and audio element it makes can't load or play
// (play() resolves, so its player carries on as if playing), and Media Source is gone. WebKit then has no media at
// all: no audio session to fight over, no lock-screen card of its own, nothing it suspends in the background.
// The page's InnerTube answers (player, next, get_queue) go to the app, which plays the song and follows the queue.
(() => {
  if (window.__abtMusicNative) return;
  window.__abtMusicNative = true;

  const post = (body) => {
    window.__abtMusicNativePosts = (window.__abtMusicNativePosts || 0) + 1;
    try { window.webkit.messageHandlers.abtMusicNative.postMessage(body); } catch (e) { window.__abtMusicNativeError = String(e); }
  };

  // 1. Media that can't play.
  const deaden = (el) => {
    if (el.__abtDead) return el;
    el.__abtDead = true;
    try { el.muted = true; el.setAttribute('muted', ''); } catch (_) {}
    el.play = () => Promise.resolve();
    el.pause = () => {};
    el.load = () => {};
    for (const key of ['src', 'srcObject']) {
      try { Object.defineProperty(el, key, { configurable: true, get: () => (key === 'src' ? '' : null), set: () => {} }); } catch (_) {}
    }
    try { Element.prototype.removeAttribute.call(el, 'src'); } catch (_) {}
    return el;
  };
  const createElement = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, options) {
    const el = createElement.call(this, tag, options);
    if (typeof tag === 'string' && /^(video|audio)$/i.test(tag)) deaden(el);
    return el;
  };
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this.__abtDead && /^src$/i.test(name)) return undefined;
    return setAttribute.call(this, name, value);
  };
  for (const name of ['MediaSource', 'ManagedMediaSource', 'WebKitMediaSource']) {
    try { Object.defineProperty(window, name, { configurable: true, get: () => undefined }); } catch (_) {}
  }
  // Media the HTML itself brings.
  const sweep = () => document.querySelectorAll('video, audio').forEach(deaden);
  new MutationObserver(sweep).observe(document, { childList: true, subtree: true });

  // 2. The page's InnerTube answers.
  const kinds = [['/youtubei/v1/player', 'player'], ['/youtubei/v1/next', 'next'], ['/youtubei/v1/music/get_queue', 'queue']];
  const kindOf = (url) => (kinds.find(([path]) => url.includes(path)) || [])[1];
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const kind = kindOf(url);
    // The request's body is read from a copy made first: once fetched, a Request's body is used up, and cloning it
    // then threw, which failed the page's own request.
    let requestBody = Promise.resolve(null);
    if (kind) {
      try {
        if (init && typeof init.body === 'string') requestBody = Promise.resolve(init.body);
        else if (input && typeof input.clone === 'function') requestBody = input.clone().text().catch(() => null);
      } catch (_) {}
    }
    const result = originalFetch.apply(this, arguments);
    if (kind) {
      Promise.all([requestBody, result.then((response) => response.clone().text())])
        .then(([request, response]) => post({ kind, request, response }))
        .catch(() => {});
    }
    return result;
  };

  // 3. What the app needs to make the page's requests itself (a song with the page suspended): its player code
  // and InnerTube client, once the page has them.
  let tries = 0;
  const sendContext = () => {
    const get = (key) => { try { return window.ytcfg && ytcfg.get(key); } catch (_) { return undefined; } };
    const configs = get('WEB_PLAYER_CONTEXT_CONFIGS') || {};
    const first = Object.values(configs)[0] || {};
    const playerURL = get('PLAYER_JS_URL') || first.jsUrl;
    const clientVersion = get('INNERTUBE_CLIENT_VERSION');
    if (playerURL && clientVersion) {
      post({ kind: 'context', response: JSON.stringify({ playerURL: new URL(playerURL, location.href).href,
        clientVersion, visitorData: get('VISITOR_DATA') || null }) });
    } else if ((tries += 1) < 40) {
      setTimeout(sendContext, 500);
    }
  };
  sendContext();

  // 4. The app's player moved on (the end of a song, the lock screen): the page's queue follows, quietly.
  window.__abtMusicNativeSelect = (videoID) => {
    const item = [...document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item')]
      .find((i) => i.data && i.data.videoId === videoID);
    if (!item || item.hasAttribute('selected')) return false;
    (item.querySelector('ytmusic-play-button-renderer') || item.querySelector('.song-info, .song-title') || item).click();
    return true;
  };
})();
