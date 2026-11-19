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

// Hide Suggested Posts (setting): Home stays on Instagram's own Following feed, which holds only posts from
// accounts the user follows, newest first. Instagram goes back to the suggested feed each time Home opens.
(() => {
  if (window.__abtInstagram) return;
  const following = () => {
    if (!(window.__abtConfig || {}).hideSuggestedPosts || location.pathname !== '/') return;
    if (new URLSearchParams(location.search).get('variant') === 'following') return;
    // Signed out, `/` is the login page: nothing to switch.
    if (!/(?:^|;\s*)ds_user_id=/.test(document.cookie)) return;
    location.replace('/?variant=following');
  };
  window.__abtInstagram = { refresh: following };
  following();
  setInterval(following, 1000);
})();

// Reels: the page fills the screen down to the app's tab bar, and ads are skipped.
(() => {
  if (window.__abtReels) return;
  window.__abtReels = true;
  // Instagram's own bottom bar (hidden for the app's) still took its 45 points under the Reels: a black band
  // between the video and the app's tab bar (16 Nov). The Reels page marks itself; its scroller fills the page.
  const markPage = () => document.documentElement.classList.toggle('abt-reels-page', location.pathname.startsWith('/reels'));
  // The label Instagram puts on a sponsored Reel, in the languages the app speaks, for when the item carries none
  // of the ad links below.
  const LABEL = /^(Ad|Sponsored|Reklam|Sponsorlu|Anzeige|Gesponsert|Publicidad|Patrocinado|Sponsorisé|Publicité|Sponsorizzato|広告|광고|广告|赞助内容|Реклама|إعلان|ممول|विज्ञापन|प्रायोजित)$/;
  const isAd = (item) => {
    if (item.querySelector('a[href*="/ads/"], a[href*="facebook.com/ads"], a[href*="l.instagram.com"]')) return true;
    for (const el of item.querySelectorAll('span, div')) {
      if (el.childElementCount === 0 && LABEL.test((el.textContent || '').trim())) return true;
    }
    return false;
  };
  let skipping = false;
  const check = () => {
    markPage();
    if (!document.documentElement.classList.contains('abt-reels-page') || skipping) return;
    const scroller = [...document.querySelectorAll('main div')].find((d) => d.scrollHeight > d.clientHeight + 10
      && getComputedStyle(d).overflowY === 'scroll' && d.querySelector('video'));
    if (!scroller) return;
    const top = scroller.getBoundingClientRect().top;
    const current = [...scroller.children].find((c) => Math.abs(c.getBoundingClientRect().top - top) < 40);
    if (!current || !isAd(current)) return;
    // Silent at once, then on to the next Reel, as a swipe would.
    for (const v of current.querySelectorAll('video')) { v.muted = true; v.pause(); }
    skipping = true;
    scroller.scrollBy({ top: scroller.clientHeight, behavior: 'smooth' });
    setTimeout(() => { skipping = false; }, 900);
  };
  markPage();
  setInterval(check, 300);
})();
