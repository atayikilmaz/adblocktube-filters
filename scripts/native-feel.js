// Pages behave like app screens: no pinch zoom (apps don't zoom their UI; videos still go fullscreen).
(() => {
  const lock = () => {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      (document.head || document.documentElement).appendChild(meta);
    }
    const content = (meta.getAttribute('content') || 'width=device-width, initial-scale=1')
      .split(',').map((part) => part.trim())
      .filter((part) => part && !/^(maximum-scale|minimum-scale|user-scalable)=/i.test(part));
    meta.setAttribute('content', content.concat(['maximum-scale=1', 'user-scalable=no']).join(', '));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lock); else lock();
})();

// Tells the app once the page has drawn real content, so the relaunch snapshot steps aside right away.
(() => {
  if (window.top !== window) return;
  const report = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    window.webkit?.messageHandlers?.abtNav?.postMessage({ type: 'painted' });
  }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', report, { once: true });
  else report();
})();

// The first touch in the page: from then on, whatever plays is the user's doing (see TabWebSession.quietUntil).
(() => {
  if (window.top !== window) return;
  document.addEventListener('touchstart', () => {
    window.webkit?.messageHandlers?.abtNav?.postMessage({ type: 'touched' });
  }, { capture: true, passive: true, once: true });
})();
