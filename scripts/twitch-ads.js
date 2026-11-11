// Twitch stitches ads into the stream itself, so they can't be removed. While one runs (Twitch labels it),
// the stream is muted and its picture hidden (twitch.css); both come back when the ad ends.
(() => {
  const AD = '[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-test-selector="ad-banner-default-text"]';
  let muted = null; // the video's own mute state before the ad, while one runs
  setInterval(() => {
    const video = document.querySelector('video');
    const inAd = !!document.querySelector(AD);
    if (inAd && video && muted === null) {
      muted = video.muted;
      video.muted = true;
      document.documentElement.classList.add('abt-twitch-ad');
    } else if (!inAd && muted !== null) {
      if (video) video.muted = muted;
      muted = null;
      document.documentElement.classList.remove('abt-twitch-ad');
    } else if (inAd && video && !video.muted) {
      video.muted = true; // the player unmuted itself mid-ad
    }
  }, 500);
})();
