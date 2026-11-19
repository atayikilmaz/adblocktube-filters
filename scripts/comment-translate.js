// "Translate to …" under YouTube's comments, as in the YouTube app: the comment's text swaps for its translation
// into the user's language, and "See original" swaps it back. The app decides and translates (on the device, with
// Apple's Translation, `CommentTranslator`):
// - new comments go to the app as `abtNav` {type: 'commentLanguages', items: [{id, text}]}; it answers with the
//   ones written in another language: `__abtTranslate.offer(ids, labels)`;
// - a tap sends {type: 'translateComment', id, text}; the app answers `__abtTranslate.done(id, text)` (null when it
//   couldn't).
(() => {
  if (window.__abtTranslate) return;
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };

  const TEXT = 'ytm-comment-renderer .YtmCommentRendererText';
  let nextID = 1;
  let labels = { translate: 'Translate', original: 'See original', translating: 'Translating…', failed: 'Couldn’t translate' };
  // id → { el, original (copies of its nodes: YouTube's Trusted Types refuse innerHTML), translated, button }
  const comments = new Map();
  let timer = null;

  const textOf = (el) => (el.innerText || el.textContent || '').trim();

  const scan = () => {
    timer = null;
    const items = [];
    document.querySelectorAll(`${TEXT}:not([data-abt-cid])`).forEach((el) => {
      const text = textOf(el);
      if (!text) return;
      const id = String(nextID++);
      el.dataset.abtCid = id;
      comments.set(id, { el, original: [...el.childNodes].map((node) => node.cloneNode(true)), text });
      items.push({ id, text: text.slice(0, 600) });
    });
    if (items.length) post({ type: 'commentLanguages', items });
    // Comments scrolled far away and dropped by YouTube.
    for (const [id, entry] of comments) if (!entry.el.isConnected) comments.delete(id);
  };
  const schedule = () => { if (!timer) timer = setTimeout(scan, 400); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

  const setLabel = (entry, label) => { if (entry.button) entry.button.textContent = label; };

  const toggle = (id) => {
    const entry = comments.get(id);
    if (!entry || entry.busy) return;
    if (entry.showing) {
      entry.el.replaceChildren(...entry.original.map((node) => node.cloneNode(true)));
      entry.showing = false;
      setLabel(entry, labels.translate);
      return;
    }
    if (entry.translated) {
      entry.el.textContent = entry.translated;
      entry.showing = true;
      setLabel(entry, labels.original);
      return;
    }
    entry.busy = true;
    setLabel(entry, labels.translating);
    post({ type: 'translateComment', id, text: entry.text });
  };

  // The comment's text sits inside YouTube's own button (a tap opens the replies): the tap is ours alone. Taken
  // on touchend (whose default is cancelled, so no click follows), unless the finger moved (a scroll).
  let touch = null;
  let touchedAt = 0;
  const linkOf = (event) => event.target.closest && event.target.closest('.abt-translate');
  window.addEventListener('touchstart', (event) => {
    const link = linkOf(event);
    const point = event.touches[0];
    touch = link && point ? { link, x: point.clientX, y: point.clientY } : null;
  }, { capture: true, passive: true });
  window.addEventListener('touchend', (event) => {
    const link = linkOf(event);
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = event.changedTouches[0];
    const still = touch && touch.link === link && point
      && Math.hypot(point.clientX - touch.x, point.clientY - touch.y) < 10;
    touch = null;
    if (still) {
      touchedAt = Date.now();
      toggle(link.dataset.abtCid);
    }
  }, { capture: true, passive: false });
  const swallow = (event) => {
    const link = linkOf(event);
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'click' && Date.now() - touchedAt > 600) toggle(link.dataset.abtCid);
  };
  for (const type of ['click', 'mousedown', 'mouseup']) window.addEventListener(type, swallow, true);

  window.__abtTranslate = {
    offer(ids, newLabels) {
      labels = { ...labels, ...newLabels };
      for (const id of ids) {
        const entry = comments.get(id);
        if (!entry || entry.button || !entry.el.isConnected) continue;
        const button = document.createElement('span');
        button.className = 'abt-translate';
        button.setAttribute('role', 'button');
        button.dataset.abtCid = id;
        button.textContent = labels.translate;
        entry.el.insertAdjacentElement('afterend', button);
        entry.button = button;
      }
    },
    done(id, text) {
      const entry = comments.get(id);
      if (!entry) return;
      entry.busy = false;
      if (!text) { setLabel(entry, labels.failed); return; }
      entry.translated = text;
      entry.el.textContent = text;
      entry.showing = true;
      setLabel(entry, labels.original);
    },
  };
})();
