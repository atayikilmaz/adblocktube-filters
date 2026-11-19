// SponsorBlock: skips (or mutes) the parts of a video that SponsorBlock users marked (sponsors, self-promotion,
// non-music sections, …) and marks them on the progress bar in SponsorBlock's colours.
// - The app fetches the segments (by a hash prefix of the video id) when asked with the `abtNav` message
//   `sponsorSegments`, and hands them in with `__abtSponsor.set(videoID, segments)`.
// - Each skip posts `sponsorSkipped`; the app's toast can take it back with `__abtSponsor.unskip(uuid)`.
// - Off unless `__abtConfig.skipSponsors`; `__abtSponsor.refresh()` runs whenever the config is sent again.
(() => {
  if (window.__abtSponsor) return;
  const post = (message) => {
    try { window.webkit.messageHandlers.abtNav.postMessage(message); } catch (_) {}
  };
  const MUSIC = location.hostname.startsWith('music.');
  const enabled = () => !!(window.__abtConfig || {}).skipSponsors;
  // What the segments depend on; the config is sent again for other changes too (quality, speed).
  const settings = () => `${enabled()}|${(window.__abtConfig || {}).sponsorCategories || ''}`;
  let appliedSettings = settings();

  let videoID = null; // the video `segments` belong to
  let requested = null; // the last id asked for
  let segments = [];
  let unskipped = new Set(); // segments the user took back: played as usual until the video changes
  let lastSkip = { uuid: null, at: 0 };
  let mutedFor = null; // the mute segment the video is muted for
  let timer = null;

  const player = () => document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  const mainVideo = () => {
    const p = player();
    return p && p.querySelector('video');
  };

  // The video on screen: the watch page's id, or on YouTube Music (where the page can be anywhere while a song
  // plays) the player's own. Feed previews and Shorts are left alone.
  const currentID = () => {
    if (location.pathname === '/watch') {
      const id = new URLSearchParams(location.search).get('v');
      if (id) return id;
    }
    if (!MUSIC) return null;
    try {
      const data = player() && player().getVideoData && player().getVideoData();
      return (data && data.video_id) || null;
    } catch (_) {
      return null;
    }
  };

  const isAd = () => {
    const p = player();
    return !!(p && p.classList.contains('ad-showing'));
  };

  // A segment submitted for a different cut of the video (its length then doesn't match) is ignored.
  const fits = (segment, duration) =>
    !segment.duration || !Number.isFinite(duration) || duration <= 0 || Math.abs(segment.duration - duration) <= 2;

  const setMuted = (video, segment) => {
    if (segment && mutedFor !== segment.uuid) {
      mutedFor = segment.uuid;
      // The mute guard (youtube-playback.js) lets this one through.
      window.__abtMuting = true;
      video.muted = true;
      window.__abtMuting = false;
      post({ type: 'sponsorSkipped', action: 'mute', category: segment.category, uuid: segment.uuid });
    } else if (!segment && mutedFor) {
      mutedFor = null;
      video.muted = false;
    }
  };

  const check = () => {
    clearTimeout(timer);
    timer = null;
    const video = mainVideo();
    if (!video || !enabled()) return;
    const id = currentID();
    if (id !== requested) {
      requested = id;
      videoID = null;
      segments = [];
      unskipped = new Set();
      removeMarks();
      if (mutedFor) setMuted(video, null);
      if (id) post({ type: 'sponsorSegments', videoID: id });
      return;
    }
    if (id !== videoID || !segments.length || isAd()) return;
    drawMarks(video.duration);
    const now = video.currentTime;
    let muteSegment = null;
    let next = Infinity;
    for (const segment of segments) {
      if (unskipped.has(segment.uuid) || !fits(segment, video.duration)) continue;
      if (now >= segment.start && now < segment.end - 0.25) {
        if (segment.action === 'mute') { muteSegment = segment; continue; }
        // A seek takes a moment to land; don't skip the same segment twice for it.
        if (lastSkip.uuid === segment.uuid && Date.now() - lastSkip.at < 1000) return;
        lastSkip = { uuid: segment.uuid, at: Date.now() };
        video.currentTime = Number.isFinite(video.duration) ? Math.min(segment.end, video.duration) : segment.end;
        post({ type: 'sponsorSkipped', action: 'skip', category: segment.category, uuid: segment.uuid });
        return;
      }
      if (segment.start > now) next = Math.min(next, segment.start);
    }
    setMuted(video, muteSegment);
    // Time updates come about four times a second; a timer lands the skip right on the segment's start.
    const wait = (next - now) / (video.playbackRate || 1);
    if (!video.paused && wait < 5) timer = setTimeout(check, Math.max(0, wait * 1000));
  };

  // Marks on the progress bar, over the page's own line (YouTube redraws it, so they're put back when missing).
  let marks = null;
  let marksFor = null;
  const LINES = MUSIC
    ? ['ytmusic-player-controls #progress-bar #progressContainer', 'ytmusic-player-bar #progress-bar #progressContainer']
    : ['yt-progress-bar yt-chaptered-progress-bar-line', 'yt-progress-bar .ytProgressBarLineProgressBarLine'];
  // The first one on screen (YouTube Music keeps hidden copies of its bars around).
  const progressLine = () => {
    for (const selector of LINES) {
      for (const line of document.querySelectorAll(selector)) {
        if (line.getClientRects().length && line.getBoundingClientRect().width > 0) return line;
      }
    }
    return null;
  };
  const removeMarks = () => {
    if (marks) marks.remove();
    marks = null;
    marksFor = null;
  };
  const drawMarks = (duration) => {
    const line = progressLine();
    if (!line || !Number.isFinite(duration) || duration <= 0) return;
    const key = videoID + duration;
    if (marks && marks.isConnected && marks.parentElement === line && marksFor === key) return;
    removeMarks();
    marks = document.createElement('div');
    marks.className = 'abt-sponsor-marks';
    marks.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;';
    for (const segment of segments) {
      if (!fits(segment, duration)) continue;
      const mark = document.createElement('div');
      const left = Math.max(0, segment.start / duration) * 100;
      const width = Math.max(0.4, (Math.min(segment.end, duration) - segment.start) / duration * 100);
      mark.style.cssText = `position:absolute;top:0;bottom:0;left:${left}%;width:${width}%;` +
        `background:${segment.color};opacity:0.9;`;
      marks.appendChild(mark);
    }
    if (getComputedStyle(line).position === 'static') line.style.position = 'relative';
    line.appendChild(marks);
    marksFor = key;
  };

  for (const type of ['timeupdate', 'playing', 'seeked', 'loadedmetadata']) {
    document.addEventListener(type, (event) => {
      if (event.target instanceof HTMLMediaElement && event.target === mainVideo()) check();
    }, true);
  }

  window.__abtSponsor = {
    set(id, list) {
      if (id !== requested) return false;
      videoID = id;
      segments = (list || []).slice().sort((a, b) => a.start - b.start);
      check();
      return true;
    },
    // Undo from the toast: back to the segment's start, and play it this time.
    unskip(uuid) {
      const segment = segments.find((s) => s.uuid === uuid);
      const video = mainVideo();
      if (!segment || !video) return false;
      unskipped.add(uuid);
      if (segment.action === 'mute') setMuted(video, null);
      else video.currentTime = segment.start;
      return true;
    },
    // SponsorBlock settings changed: fetch again for what's on screen (or clear up if it's been turned off).
    refresh() {
      if (settings() === appliedSettings) return false;
      appliedSettings = settings();
      requested = null;
      videoID = null;
      segments = [];
      removeMarks();
      const video = mainVideo();
      if (video && mutedFor) setMuted(video, null);
      check();
      return true;
    },
  };
})();
