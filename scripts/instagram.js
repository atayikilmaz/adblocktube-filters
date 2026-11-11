// Instagram's Profile tab opens /u/profile/, which only works signed out. Signed in, the profile lives at
// /<username>/, which the site's own (hidden) bottom bar links to as its last entry: go there.
(() => {
  if (location.pathname !== '/u/profile/') return;
  let tries = 0;
  const timer = setInterval(() => {
    const inbox = document.querySelector('a[href="/direct/inbox/"]');
    const row = inbox && inbox.closest('div[data-visualcompletion="ignore-dynamic"]');
    const links = row ? [...row.querySelectorAll('a[href]')] : [];
    const href = links.length ? links[links.length - 1].getAttribute('href') : '';
    if (/^\/[\w.]+\/$/.test(href) && !/^\/(explore|reels|direct|u)\//.test(href)) {
      clearInterval(timer);
      location.replace(href);
    } else if (++tries > 40) {
      clearInterval(timer);
    }
  }, 250);
})();
