// YouTube videos in the app's own player (NativeVideoPlayer), when Settings → YouTube → Video Player says so.
//
// The page's media is dead from birth (as on YouTube Music: it can't load or play, Media Source is gone) and the page
// only shows the video's title, actions, comments and related videos. It tells the app which video it is on; the app
// asks YouTube for that video's streams itself (`VideoStreamSource`), signed in or not.
//
// A video the app's player couldn't play (`window.__abtVideoNativeSkip`, its id, or "*" for every video while the
// app's player rests) plays in YouTube's player as usual; the page still says which video it moves on to, so the
// app can take the next one back.
(() => {
  if (window.__abtVideoNative !== undefined || !/(^|\.)youtube\.com$/.test(location.hostname)) return;

  const post = (body) => {
    try { window.webkit.messageHandlers.abtVideoNative.postMessage(body); } catch (_) {}
  };
  const videoID = () => {
    try { return new URL(location.href).searchParams.get('v'); } catch (_) { return null; }
  };
  const skip = window.__abtVideoNativeSkip;
  const skipped = !!skip && (skip === '*' || skip === videoID());
  window.__abtVideoNative = !skipped;
  post({ kind: 'page', native: !skipped, id: videoID(), reason: skipped ? 'skip' : undefined });

  // 1. The video the page is on: its first, and each one YouTube's in-page navigation moves to.
  let last = null;
  const check = () => {
    const id = videoID();
    if (!id || id === last) return;
    last = id;
    post({ kind: 'video', id });
  };
  for (const name of ['yt-navigate-finish', 'state-navigateend', 'popstate']) {
    window.addEventListener(name, () => setTimeout(check, 0));
  }
  setInterval(check, 500);
  check();
  if (skipped) return;

  // 2. Media that can't play.
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
  const sweep = () => document.querySelectorAll('video, audio').forEach(deaden);
  new MutationObserver(sweep).observe(document, { childList: true, subtree: true });
})();
