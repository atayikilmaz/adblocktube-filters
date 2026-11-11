// YouTube Music's pages for the app's native Home, Explore, Library and album / artist / playlist screens.
// The request goes out from YouTube Music's own page, the way the page itself asks for the same page: its own client
// context (`ytcfg`), its own cookies and sign-in. The app never talks to YouTube Music's API itself.
// The answer is boiled down here to plain shelves and items, so a change at YouTube Music is fixed in this file
// (it updates over the air) rather than in the app.
(() => {
  if (window.__abtMusicBrowse) return;

  const cookie = (name) => {
    const found = document.cookie.split('; ').find((c) => c.startsWith(name + '='));
    return found ? found.slice(name.length + 1) : '';
  };
  // YouTube's signed-in header, as the page sends it: a hash of the time, the SAPISID cookie and the origin.
  const authorization = async () => {
    const sapisid = cookie('__Secure-3PAPISID') || cookie('SAPISID');
    if (!sapisid) return null;
    const time = Math.floor(Date.now() / 1000);
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${time} ${sapisid} ${location.origin}`));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `SAPISIDHASH ${time}_${hex}`;
  };
  const ready = async () => {
    for (let i = 0; i < 100; i += 1) {
      if (window.ytcfg && ytcfg.get && ytcfg.get('INNERTUBE_CONTEXT')) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('not ready');
  };
  const request = async (endpoint, body) => {
    await ready();
    const headers = {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': String(ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME') || 67),
      'X-Youtube-Client-Version': ytcfg.get('INNERTUBE_CLIENT_VERSION'),
      'X-Origin': location.origin,
    };
    const auth = await authorization();
    if (auth) {
      headers.Authorization = auth;
      headers['X-Goog-AuthUser'] = String(ytcfg.get('SESSION_INDEX') || 0);
    }
    const visitor = ytcfg.get('VISITOR_DATA');
    if (visitor) headers['X-Goog-Visitor-Id'] = visitor;
    const response = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), ...body }),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return response.json();
  };

  // MARK: Reading the answer

  const text = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join('') : '');
  // The largest picture, asked for at a size that's sharp on the phone (Google's image URLs take a size).
  const image = (renderer) => {
    const thumbs = renderer && (renderer.musicThumbnailRenderer || renderer.croppedSquareThumbnailRenderer || renderer);
    const list = (thumbs && thumbs.thumbnail && thumbs.thumbnail.thumbnails) || (thumbs && thumbs.thumbnails) || [];
    const last = list[list.length - 1];
    if (!last || !last.url) return null;
    const url = last.url.startsWith('//') ? 'https:' + last.url : last.url;
    return url.replace(/=w\d+-h\d+/, '=w544-h544').replace(/=s\d+/, '=s544');
  };
  const crop = (renderer) => renderer && renderer.musicThumbnailRenderer && renderer.musicThumbnailRenderer.thumbnailCrop;
  const pageType = (e) => {
    const config = e && e.browseEndpointContextSupportedConfigs;
    return (config && config.browseEndpointContextMusicConfig && config.browseEndpointContextMusicConfig.pageType) || null;
  };
  const browseTarget = (e, title) => (e && e.browseEndpoint && e.browseEndpoint.browseId
    ? { id: e.browseEndpoint.browseId, params: e.browseEndpoint.params || null,
        pageType: pageType(e.browseEndpoint), title: title || null }
    : null);
  const playTarget = (e) => {
    if (!e) return null;
    const watch = e.watchEndpoint;
    if (watch && (watch.videoId || watch.playlistId)) {
      return { videoID: watch.videoId || null, playlistID: watch.playlistId || null, params: watch.params || null,
        index: typeof watch.index === 'number' ? watch.index : null };
    }
    const list = e.watchPlaylistEndpoint;
    if (list && list.playlistId) return { videoID: null, playlistID: list.playlistId, params: list.params || null, index: null };
    return null;
  };
  // The play button over an item's artwork (albums and playlists play from it; tapping the item opens its page).
  const overlayPlay = (overlay) => {
    const content = overlay && overlay.musicItemThumbnailOverlayRenderer && overlay.musicItemThumbnailOverlayRenderer.content;
    return playTarget(content && content.musicPlayButtonRenderer && content.musicPlayButtonRenderer.playNavigationEndpoint);
  };
  const shapeOf = (renderer, aspect) => {
    if (crop(renderer) === 'MUSIC_THUMBNAIL_CROP_CIRCLE') return 'circle';
    if (aspect && /16_9/.test(aspect)) return 'wide';
    return 'square';
  };
  let counter = 0;
  const uid = (prefix) => `${prefix}-${(counter += 1)}`;

  // An item's ⋮ menu (Play next, Add to queue, Start mix, Go to artist…). The app gets the titles; the endpoints
  // stay here, and `choose` runs the one picked the way the page's own menu would.
  const menus = new Map();
  const menuEntries = (menu) => {
    const items = (menu && menu.menuRenderer && menu.menuRenderer.items) || [];
    return items.map((wrapper) => {
      const nav = wrapper.menuNavigationItemRenderer;
      const service = wrapper.menuServiceItemRenderer;
      const toggle = wrapper.toggleMenuServiceItemRenderer;
      const r = nav || service || toggle;
      if (!r) return null;
      const title = text(nav || service ? r.text : r.defaultText);
      const endpoint = nav ? r.navigationEndpoint : service ? r.serviceEndpoint : r.defaultServiceEndpoint;
      if (!title || !endpoint) return null;
      // Saving to a playlist opens a dialog in the page, which the app doesn't show; Share is the app's own.
      if (endpoint.addToPlaylistEndpoint || endpoint.shareEntityEndpoint) return null;
      return { title, endpoint };
    }).filter(Boolean);
  };
  const shareURL = (play, browse) => {
    if (play && play.videoID) return `https://music.youtube.com/watch?v=${play.videoID}`;
    if (play && play.playlistID) return `https://music.youtube.com/playlist?list=${play.playlistID}`;
    if (browse) {
      if (browse.id.startsWith('VL')) return `https://music.youtube.com/playlist?list=${browse.id.slice(2)}`;
      if (browse.id.startsWith('UC')) return `https://music.youtube.com/channel/${browse.id}`;
      if (browse.id.startsWith('MPRE')) return `https://music.youtube.com/browse/${browse.id}`;
    }
    return null;
  };
  // Adds what every item carries for its long-press menu.
  const withMenu = (item, menu) => {
    const entries = menuEntries(menu);
    // Pages read long ago are gone from the app's screens too.
    if (menus.size > 5000) menus.delete(menus.keys().next().value);
    menus.set(item.id, entries);
    item.menu = entries.map((e) => e.title);
    // Which entries queue the item ('next', 'last'): the app can still queue it should this page have been
    // loaded again since (the menus kept here are gone then).
    item.actions = entries.map((e) => (e.endpoint.queueAddEndpoint
      ? (e.endpoint.queueAddEndpoint.queueInsertPosition === 'INSERT_AT_END' ? 'last' : 'next') : null));
    item.share = shareURL(item.play, item.browse);
    return item;
  };

  const twoRow = (r) => {
    const title = text(r.title);
    const play = playTarget(r.navigationEndpoint);
    return withMenu({
      id: uid('i'),
      title,
      subtitle: text(r.subtitle).replace(/\s•\s*$/, ''),
      image: image(r.thumbnailRenderer),
      shape: shapeOf(r.thumbnailRenderer, r.aspectRatio),
      play,
      browse: browseTarget(r.navigationEndpoint, title),
      // Only for what opens a page when tapped (an album, a playlist); a song plays from anywhere on it.
      artworkPlay: play ? null : overlayPlay(r.thumbnailOverlay),
      index: null,
      color: null,
    }, r.menu);
  };
  const listItem = (r) => {
    const columns = (r.flexColumns || []).map((c) => c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text);
    const fixed = (r.fixedColumns || []).map((c) => c.musicResponsiveListItemFixedColumnRenderer && c.musicResponsiveListItemFixedColumnRenderer.text);
    const first = columns[0];
    const title = text(first);
    const firstRun = first && first.runs && first.runs[0];
    const videoID = r.playlistItemData && r.playlistItemData.videoId;
    let play = playTarget(r.navigationEndpoint) || playTarget(firstRun && firstRun.navigationEndpoint) ||
      overlayPlay(r.overlay);
    if (!play && videoID) play = { videoID, playlistID: null, params: null, index: null };
    const browse = play ? null : browseTarget(r.navigationEndpoint, title);
    const subtitle = columns.slice(1).map(text).filter(Boolean).join(' • ').replace(/\s•\s*$/, '');
    return withMenu({
      id: uid('i'),
      title,
      subtitle: [subtitle, ...fixed.map(text)].filter(Boolean).join(' • '),
      image: image(r.thumbnail),
      shape: shapeOf(r.thumbnail),
      play,
      browse,
      artworkPlay: null,
      index: r.index ? text(r.index) : null,
      color: null,
    }, r.menu);
  };
  // Moods & genres and the Explore buttons: a coloured tile that opens a page.
  const navigationButton = (r) => {
    const title = text(r.buttonText);
    const color = r.solid && typeof r.solid.leftStripeColor === 'number'
      ? '#' + (r.solid.leftStripeColor & 0xffffff).toString(16).padStart(6, '0') : null;
    return {
      id: uid('i'), title, subtitle: '', image: null, shape: 'tile', play: null,
      browse: browseTarget(r.clickCommand, title), artworkPlay: null, index: null, color,
    };
  };
  const item = (wrapper) => {
    if (wrapper.musicTwoRowItemRenderer) return twoRow(wrapper.musicTwoRowItemRenderer);
    if (wrapper.musicResponsiveListItemRenderer) return listItem(wrapper.musicResponsiveListItemRenderer);
    if (wrapper.musicNavigationButtonRenderer) return navigationButton(wrapper.musicNavigationButtonRenderer);
    return null;
  };
  const itemsAndContinuation = (list) => {
    const items = [];
    let continuation = null;
    for (const wrapper of list || []) {
      const cont = wrapper.continuationItemRenderer;
      if (cont) {
        const command = cont.continuationEndpoint && cont.continuationEndpoint.continuationCommand;
        continuation = (command && command.token) || null;
        continue;
      }
      const parsed = item(wrapper);
      if (parsed && parsed.title) items.push(parsed);
    }
    return { items, continuation };
  };
  const nextContinuation = (renderer) => {
    const first = renderer && renderer.continuations && renderer.continuations[0];
    return (first && first.nextContinuationData && first.nextContinuationData.continuation) || null;
  };

  const section = (wrapper) => {
    const carousel = wrapper.musicCarouselShelfRenderer;
    if (carousel) {
      const header = carousel.header && (carousel.header.musicCarouselShelfBasicHeaderRenderer || {});
      const title = text(header.title);
      const more = header.moreContentButton && header.moreContentButton.buttonRenderer;
      const { items } = itemsAndContinuation(carousel.contents);
      const rows = (carousel.contents || []).some((c) => c.musicResponsiveListItemRenderer);
      const tiles = items.length && items.every((i) => i.shape === 'tile');
      return {
        id: uid('s'), kind: tiles ? 'tiles' : rows ? 'rows' : 'carousel', title, strapline: text(header.strapline) || null,
        more: browseTarget(more && more.navigationEndpoint, title) ||
          browseTarget(header.title && header.title.runs && header.title.runs[0].navigationEndpoint, title),
        items, text: null, continuation: null,
      };
    }
    const shelf = wrapper.musicShelfRenderer || wrapper.musicPlaylistShelfRenderer;
    if (shelf) {
      const title = text(shelf.title) || text(shelf.header && shelf.header.musicShelfHeaderRenderer && shelf.header.musicShelfHeaderRenderer.title);
      const bottom = shelf.bottomEndpoint || (shelf.bottomButton && shelf.bottomButton.buttonRenderer && shelf.bottomButton.buttonRenderer.navigationEndpoint);
      const { items, continuation } = itemsAndContinuation(shelf.contents);
      return { id: uid('s'), kind: 'list', title: title || null, strapline: null, more: browseTarget(bottom, title),
        items, text: null, continuation: continuation || nextContinuation(shelf) };
    }
    const grid = wrapper.gridRenderer;
    if (grid) {
      const header = grid.header && grid.header.gridHeaderRenderer;
      const { items, continuation } = itemsAndContinuation(grid.items);
      const tiles = items.length && items.every((i) => i.shape === 'tile');
      return { id: uid('s'), kind: tiles ? 'tiles' : 'grid', title: text(header && header.title) || null, strapline: null,
        more: null, items, text: null, continuation: continuation || nextContinuation(grid) };
    }
    const description = wrapper.musicDescriptionShelfRenderer;
    if (description) {
      return { id: uid('s'), kind: 'text', title: text(description.header) || null, strapline: null, more: null,
        items: [], text: text(description.description), continuation: null };
    }
    return null;
  };
  const sections = (list) => (list || []).map(section).filter((s) => s && (s.items.length || s.text));

  const buttonsPlay = (buttons) => {
    for (const b of buttons || []) {
      const play = b.musicPlayButtonRenderer && playTarget(b.musicPlayButtonRenderer.playNavigationEndpoint);
      if (play) return play;
    }
    return null;
  };
  const header = (h) => {
    if (!h) return null;
    const responsive = h.musicResponsiveHeaderRenderer || h.musicDetailHeaderRenderer;
    if (responsive) {
      const strapline = responsive.straplineTextOne;
      const artistRun = strapline && strapline.runs && strapline.runs.find((r) => r.navigationEndpoint);
      return {
        style: 'collection',
        title: text(responsive.title),
        subtitle: [text(strapline), text(responsive.subtitle)].filter(Boolean).join('\n').replace(/\s•\s*$/, ''),
        detail: text(responsive.secondSubtitle).replace(/\s•\s*$/, '') || null,
        description: responsive.description && responsive.description.musicDescriptionShelfRenderer
          ? text(responsive.description.musicDescriptionShelfRenderer.description) : null,
        image: image(responsive.thumbnail),
        play: buttonsPlay(responsive.buttons),
        artist: artistRun ? browseTarget(artistRun.navigationEndpoint, artistRun.text) : null,
      };
    }
    const immersive = h.musicImmersiveHeaderRenderer || h.musicVisualHeaderRenderer;
    if (immersive) {
      const shuffle = immersive.playButton && immersive.playButton.buttonRenderer &&
        playTarget(immersive.playButton.buttonRenderer.navigationEndpoint);
      const radio = immersive.startRadioButton && immersive.startRadioButton.buttonRenderer &&
        playTarget(immersive.startRadioButton.buttonRenderer.navigationEndpoint);
      const subscribe = immersive.subscriptionButton && immersive.subscriptionButton.subscribeButtonRenderer;
      return {
        style: 'artist',
        title: text(immersive.title),
        subtitle: subscribe ? text(subscribe.longSubscriberCountText) || null : null,
        detail: null,
        description: text(immersive.description) || null,
        image: image(immersive.thumbnail || immersive.foregroundThumbnail),
        play: shuffle || radio,
        artist: null,
      };
    }
    return null;
  };
  const chips = (list) => {
    const cloud = list && list.header && list.header.chipCloudRenderer;
    return ((cloud && cloud.chips) || []).map((c) => {
      const chip = c.chipCloudChipRenderer;
      if (!chip) return null;
      const target = browseTarget(chip.isSelected ? chip.onDeselectedCommand : chip.navigationEndpoint, text(chip.text));
      return target ? { title: text(chip.text), target, isSelected: !!chip.isSelected } : null;
    }).filter(Boolean);
  };

  const page = (json) => {
    const contents = json.contents || {};
    const single = contents.singleColumnBrowseResultsRenderer;
    const double = contents.twoColumnBrowseResultsRenderer;
    const tabs = (single || double || {}).tabs || [];
    const tab = tabs[0] && tabs[0].tabRenderer && tabs[0].tabRenderer.content;
    const list = tab && tab.sectionListRenderer;
    let found = [];
    let top = header(json.header);
    if (double) {
      const firsts = (list && list.contents) || [];
      top = top || header(firsts[0]);
      const secondary = double.secondaryContents && double.secondaryContents.sectionListRenderer;
      found = sections(secondary && secondary.contents);
      // A long playlist goes on in its list; the page's own continuation only brings further shelves.
      const more = found.map((s) => s.continuation).filter(Boolean).pop();
      return { header: top, chips: [], sections: found, continuation: more || nextContinuation(secondary) };
    }
    found = sections(list && list.contents);
    return { header: top, chips: chips(list), sections: found, continuation: nextContinuation(list) };
  };
  // More of a page: further shelves (Home), or more of a list (a long playlist).
  const continued = (json) => {
    const section = json.continuationContents && json.continuationContents.sectionListContinuation;
    if (section) return { header: null, chips: [], sections: sections(section.contents), continuation: nextContinuation(section) };
    const shelf = json.continuationContents &&
      (json.continuationContents.musicShelfContinuation || json.continuationContents.musicPlaylistShelfContinuation);
    if (shelf) {
      const { items, continuation } = itemsAndContinuation(shelf.contents);
      return { header: null, chips: [], continuation: continuation || nextContinuation(shelf),
        sections: [{ id: uid('s'), kind: 'list', title: null, strapline: null, more: null, items, text: null, continuation: null }] };
    }
    const actions = json.onResponseReceivedActions || [];
    const append = actions.map((a) => a.appendContinuationItemsAction).find(Boolean);
    if (append) {
      const { items, continuation } = itemsAndContinuation(append.continuationItems);
      return { header: null, chips: [], continuation,
        sections: [{ id: uid('s'), kind: 'list', title: null, strapline: null, more: null, items, text: null, continuation: null }] };
    }
    return { header: null, chips: [], sections: [], continuation: null };
  };

  // Play next / Add to queue. YouTube Music's own handler only fills the queue while its player page is open (it
  // says "Song will play next" and adds nothing otherwise, and that page stays closed in the app), so the song is
  // read the way it reads it (`music/get_queue`) and put into the queue's store directly. With nothing playing,
  // the song just plays, as YouTube Music does.
  const queueAdd = async (endpoint) => {
    const add = endpoint.queueAddEndpoint;
    const target = add.queueTarget || {};
    const queueElement = document.querySelector('ytmusic-player-queue');
    const state = queueElement && queueElement.getState && queueElement.getState().queue;
    if (!state || !state.items || !state.items.length) {
      const play = playTarget(target.onEmptyQueue) ||
        { videoID: target.videoId || null, playlistID: target.playlistId || null, params: null, index: null };
      const query = new URLSearchParams();
      if (play.videoID) query.set('v', play.videoID);
      if (play.playlistID) query.set('list', play.playlistID);
      window.__abt && __abt.navigate(`/watch?${query}`);
      return true;
    }
    const body = target.videoId ? { videoIds: [target.videoId] } : target.playlistId ? { playlistId: target.playlistId } : null;
    if (!body) return false;
    const json = await request('music/get_queue', body);
    const items = (json.queueDatas || []).map((d) => d.content).filter(Boolean);
    if (!items.length) return false;
    const next = add.queueInsertPosition !== 'INSERT_AT_END';
    const current = Math.max(0, state.selectedItemIndex || 0);
    queueElement.dispatch({
      type: 'ADD_ITEMS',
      payload: {
        nextQueueItemId: state.nextQueueItemId,
        index: next ? current + 1 : state.items.length,
        items,
        shuffleEnabled: false,
        shouldAssignIds: true,
      },
    });
    return true;
  };

  window.__abtMusicBrowse = {
    // `{ id, params }` for a page, or `{ continuation }` for more of one. Answers JSON (see `MusicBrowsePage`).
    async browse(target) {
      if (target.continuation) {
        return JSON.stringify(continued(await request('browse', { continuation: target.continuation })));
      }
      const body = { browseId: target.id };
      if (target.params) body.params = target.params;
      return JSON.stringify(page(await request('browse', body)));
    },
    // Runs entry `index` of an item's menu. Answers what the app does next: open a page (`browse`), or nothing
    // more (`done`; the page plays or queues it itself, as its own menu would).
    async choose(itemID, index) {
      const entry = (menus.get(itemID) || [])[index];
      if (!entry) return JSON.stringify({ result: 'missing' });
      const endpoint = entry.endpoint;
      if (endpoint.queueAddEndpoint) {
        return JSON.stringify({ result: (await queueAdd(endpoint)) ? 'done' : 'missing' });
      }
      const browse = browseTarget(endpoint);
      if (browse) return JSON.stringify({ result: 'browse', browse });
      const play = playTarget(endpoint);
      if (play) {
        const query = new URLSearchParams();
        if (play.videoID) query.set('v', play.videoID);
        if (play.playlistID) query.set('list', play.playlistID);
        if (play.params) query.set('params', play.params);
        window.__abt && __abt.navigate(`/watch?${query}`);
        return JSON.stringify({ result: 'done' });
      }
      // Like, pin, not interested: the page's own action router, the way its ⋮ menu sends them.
      const app = document.querySelector('ytmusic-app');
      if (!app) return JSON.stringify({ result: 'missing' });
      app.dispatchEvent(new CustomEvent('yt-action', {
        bubbles: true, composed: true,
        detail: { actionName: 'yt-service-request', args: [app, endpoint], returnValue: [] },
      }));
      return JSON.stringify({ result: 'done' });
    },
    // Queues a song or playlist by its id alone (see `actions`).
    async queue(videoID, playlistID, next) {
      const queueTarget = videoID ? { videoId: videoID } : { playlistId: playlistID };
      const done = await queueAdd({
        queueAddEndpoint: { queueTarget, queueInsertPosition: next ? 'INSERT_AFTER_CURRENT_VIDEO' : 'INSERT_AT_END' },
      });
      return JSON.stringify({ result: done ? 'done' : 'missing' });
    },
    signedIn() {
      return !!(window.ytcfg && ytcfg.get && ytcfg.get('LOGGED_IN'));
    },
    // A request of the page's own, unread (the player's lyrics, `__abtMusic.lyrics`).
    raw: (endpoint, body) => request(endpoint, body),
  };
})();
