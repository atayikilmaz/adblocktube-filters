// Return YouTube Dislike: shows the dislike count (Return YouTube Dislike's estimate) next to the likes on a watch
// page, and under the dislike button on Shorts (in layouts that have one), in YouTube's own type.
// - The app fetches the count when asked with the `abtNav` message `dislikes`, and hands it in with
//   `__abtDislikes.set(videoID, {count, text, label})`: "12K", "12K dislikes", "12,345 dislikes".
// - On unless `__abtConfig.showDislikes` is false; `__abtDislikes.refresh()` runs whenever the config is sent again.
(() => {
  if (window.__abtDislikes) return;
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };
  const enabled = () => (window.__abtConfig || {}).showDislikes !== false;
  let appliedSetting = enabled();

  let requested = null;
  const counts = new Map();

  const currentID = () => {
    if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v');
    const short = location.pathname.match(/^\/shorts\/([\w-]{11})/);
    return short ? short[1] : null;
  };

  const removeAll = () => {
    document.querySelectorAll('.abt-dislikes').forEach((el) => el.remove());
    document.querySelectorAll('[data-abt-dislike-label]').forEach((el) => {
      el.textContent = el.dataset.abtDislikeLabel;
      delete el.dataset.abtDislikeLabel;
    });
  };

  // Watch page: "24K likes 1.2K dislikes 669K views", as one more piece of the line under the title.
  const showOnWatchPage = (info) => {
    const line = document.querySelector('ytm-slim-video-metadata-section-renderer .ytVideoSubtitleViewModelSubtitleContent');
    if (!line) return;
    let item = line.querySelector('.abt-dislikes');
    if (item && item.textContent === info.text) return;
    if (!item) {
      const parts = [...line.children].filter((el) => !el.classList.contains('abt-dislikes'));
      // The likes follow the channel name (the bold part); without a channel name they come first.
      const bold = parts.findIndex((el) => /Bold/.test(el.className));
      const likes = parts[bold + 1] || parts[0];
      if (!likes) return;
      item = document.createElement('span');
      item.className = likes.className.replace(/\S*Bold\S*/g, '') + ' abt-dislikes';
      item.setAttribute('role', 'text');
      likes.after(document.createTextNode(' '), item);
    }
    item.textContent = info.text;
    item.setAttribute('aria-label', info.label);
  };

  // Shorts: the count replaces the "Dislike" label under the button of the Short on screen.
  const showOnShort = (id, info) => {
    for (const button of document.querySelectorAll('dislike-button-view-model')) {
      const rect = button.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight) continue;
      const text = button.querySelector('.ytSpecButtonShapeWithLabelLabel, .yt-spec-button-shape-with-label__label, ' +
        '[class*="ButtonShapeWithLabelLabel"] span, [class*="ButtonShapeWithLabelLabel"]');
      if (!text) continue;
      const target = text.querySelector('span') || text;
      if (!target.dataset.abtDislikeLabel) target.dataset.abtDislikeLabel = target.textContent;
      if (target.textContent !== info.count) target.textContent = info.count;
      const press = button.querySelector('button');
      if (press) press.setAttribute('aria-label', info.label);
    }
  };

  const tick = () => {
    let id = enabled() ? currentID() : null;
    // Mobile Shorts mostly come without a dislike button; then there's nothing to show the count on.
    if (id && location.pathname !== '/watch' && !document.querySelector('dislike-button-view-model')) id = null;
    if (!id) {
      requested = null;
      return;
    }
    if (id !== requested) {
      requested = id;
      removeAll();
      if (!counts.has(id)) post({ type: 'dislikes', videoID: id });
    }
    const info = counts.get(id);
    if (!info) return;
    if (location.pathname === '/watch') showOnWatchPage(info);
    else showOnShort(id, info);
  };
  setInterval(tick, 700);

  window.__abtDislikes = {
    set(id, info) {
      if (!info || !info.text) return false;
      counts.set(id, info);
      if (counts.size > 100) counts.delete(counts.keys().next().value);
      tick();
      return true;
    },
    refresh() {
      if (enabled() === appliedSetting) return false;
      appliedSetting = enabled();
      requested = null;
      removeAll();
      tick();
      return true;
    },
  };
})();
