// Keeps media playing when the tab is hidden, the app is in the background or the screen is locked.
// Sites pause on `visibilitychange`; the page always sees itself as visible.
(() => {
  const define = (target, key, value) => {
    try { Object.defineProperty(target, key, { configurable: true, get: () => value }); } catch (_) {}
  };
  define(Document.prototype, 'hidden', false);
  define(Document.prototype, 'webkitHidden', false);
  define(Document.prototype, 'visibilityState', 'visible');
  define(Document.prototype, 'webkitVisibilityState', 'visible');
  const swallow = (event) => event.stopImmediatePropagation();
  for (const type of ['visibilitychange', 'webkitvisibilitychange']) {
    document.addEventListener(type, swallow, true);
    window.addEventListener(type, swallow, true);
  }
  Document.prototype.hasFocus = () => true;
})();
