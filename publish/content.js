/**
 * Auto Shorts Scroller for YouTube v1.5.0
 * Pro Suite:
 * - Auto-Scroll completed Shorts
 * - Auto-Skip Sponsored Ads & Video Ads
 * - Instant 'G' key skip
 * - Auto-Like for all or favorite creators
 * - Watch History tracking
 * - On-screen HUD and interactive controls
 */

(function () {
  'use strict';

  console.log('[Auto Shorts Scroller v1.5.0] Initialized on:', window.location.href);

  // Configuration
  let settings = {
    autoScroll: true,
    autoSkipAds: true,
    skipKeyEnabled: true,
    allowSpaceSkip: false,
    showIndicator: true,
    delay: 0,
    autoLikeMode: 'favorites', // 'off' | 'favorites' | 'all'
    favoriteCreators: ['@mrbeast'], // Lowercase handles/names
    minWatchBeforeLike: 2.5, // seconds
    isProActivated: true,
    requireLicenseLink: false
  };

  // State
  let isAdvancing = false;
  let lastAdvanceTime = 0;
  let lastAdSkipTime = 0;
  let lastTime = 0;
  let maxTimeReached = 0;
  let stallCount = 0;
  let toastTimeout = null;

  const attachedVideos = new WeakSet();
  const likedShorts = new Set();
  const recordedShorts = new Set();

  // Load settings from storage
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(settings, (stored) => {
        if (stored) settings = { ...settings, ...stored };
        renderHud();
      });
    }
  }

  // Real-time settings listener
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        for (const [key, change] of Object.entries(changes)) {
          settings[key] = change.newValue;
        }
        renderHud();
      }
    });
  }

  loadSettings();

  // Helper: Is this YouTube Shorts?
  function isShortsPage() {
    if (window.location.href.includes('/shorts')) return true;
    if (document.querySelector('ytd-shorts, ytd-reel-video-renderer, #shorts-container')) return true;
    return false;
  }

  // Get all reel/card elements from Shorts inner container
  function getAllReels() {
    const inner = document.querySelector('#shorts-inner-container');
    if (inner && inner.children && inner.children.length > 0) {
      return Array.from(inner.children);
    }
    return Array.from(
      document.querySelectorAll(
        'ytd-reel-video-renderer, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, .reel-video-in-sequence'
      )
    );
  }

  // Comprehensive detection for Sponsored Shorts / Ad Reels
  function isAdShort(reel) {
    if (!reel) reel = getActiveReel();
    if (!reel) return false;

    // 1. Tag name check
    const tag = (reel.tagName || '').toLowerCase();
    if (tag === 'ytd-ad-slot-renderer' || tag === 'ytd-in-feed-ad-layout-renderer' || tag.includes('ad-renderer')) {
      return true;
    }

    // 2. Attributes on reel
    if (
      reel.hasAttribute('is-sponsored') ||
      reel.hasAttribute('is-ad') ||
      reel.getAttribute('ad-format') ||
      reel.getAttribute('ad-cpn')
    ) {
      return true;
    }

    // 3. Ad sub-elements inside reel
    const adSelectors = [
      'ytd-ad-slot-renderer',
      'ad-badge-view-model',
      '.ytd-in-feed-ad-layout-renderer',
      'ytd-in-feed-ad-layout-renderer',
      'ytd-action-companion-ad-renderer',
      '.ytp-ad-player-overlay',
      '.ytp-ad-badge',
      '.ytp-ad-text',
      '.ad-showing',
      '.ad-interrupting',
      '#action-button ytd-button-renderer.ytd-ad-slot-renderer',
      '#action-button ytd-button-renderer',
      '#sponsor-button',
      '#advertiser-name',
      'ytd-badge-supported-renderer[aria-label*="Sponsored" i]',
      'ytd-badge-supported-renderer[aria-label*="Ad" i]',
      '[aria-label*="Sponsored" i]',
      '[aria-label*="Sponzorisano" i]',
      '[aria-label*="Sponzorirano" i]',
      '[aria-label*="Oglas" i]',
      '[aria-label*="Promoted" i]',
      'a[href*="googleadservices.com"]',
      'a[href*="/pagead/aclk"]',
      'a[href*="doubleclick.net"]',
      'a[href*="ad_type="]',
      'a[href*="/ad/"]'
    ];

    for (const sel of adSelectors) {
      try {
        if (reel.querySelector(sel)) return true;
      } catch (e) {}
    }

    // 4. CTA button checks (Install, Shop now, Download, Learn more)
    const ctaBtn = reel.querySelector('#action-button, .ytd-action-companion-ad-renderer, yt-button-shape.ytd-ad-slot-renderer');
    if (ctaBtn) {
      const ctaText = (ctaBtn.textContent || '').trim().toLowerCase();
      const actionWords = [
        'install', 'download', 'shop', 'learn more', 'visit', 'order', 'sign up',
        'play now', 'apply', 'get offer', 'open app', 'buy', 'book', 'watch now'
      ];
      if (actionWords.some((w) => ctaText.includes(w))) {
        return true;
      }
    }

    // 5. Look for ad words in badges, labels, headers, or spans
    const textCandidates = reel.querySelectorAll(
      'badge-shape, .badge-shape-wiz, ytd-badge-supported-renderer, yt-reel-channel-bar-view-model, span.ytd-badge-supported-renderer, .badge-shape-wiz__text, .yt-core-attributed-string, #channel-name, #text-container, span, div'
    );

    const adWords = [
      'sponsored', 'ad', 'promoted', 'advertisement', 'sponzorisano', 'sponzorirano',
      'oglas', 'plaćeni oglas', 'placeni oglas', 'gesponsert', 'anzeige', 'patrocinado',
      'publicidad', 'sponsorisé', 'sponsorise', 'annonce'
    ];

    for (const b of textCandidates) {
      const txt = (b.textContent || '').trim().toLowerCase();
      if (txt.length > 0 && txt.length < 45) {
        if (
          adWords.some(
            (w) =>
              txt === w ||
              txt.startsWith(w + ' ') ||
              txt.startsWith(w + '·') ||
              txt.startsWith(w + '•') ||
              txt.endsWith(' ' + w) ||
              txt.includes('sponsored') ||
              txt.includes('sponzorisano') ||
              txt.includes('sponzorirano') ||
              txt.includes('gesponsert') ||
              txt.includes('patrocinado')
          )
        ) {
          return true;
        }
      }
    }

    // 6. External advertiser links
    const externalLinks = reel.querySelectorAll('a[href^="http"]');
    for (const a of externalLinks) {
      const href = a.getAttribute('href') || '';
      if (!href.includes('youtube.com') && !href.includes('youtu.be') && !href.includes('google.com/url')) {
        return true;
      }
    }

    return false;
  }

  // Universal Video Ad Skipper (works on Shorts + standard YouTube player)
  function skipVideoAd() {
    if (!settings.autoSkipAds) return;

    // 1. Click all YouTube skip buttons immediately
    const skipSelectors = [
      '.ytp-ad-skip-button',
      '.ytp-ad-skip-button-modern',
      '.ytp-skip-ad-button',
      'button.ytp-ad-skip-button-modern',
      'button.ytp-ad-skip-button-text',
      '.ytp-ad-overlay-close-button',
      '[id^="skip-button"] button',
      '.ytp-ad-skip-button-container button',
      'button[aria-label*="Skip" i]',
      'button[aria-label*="skip" i]'
    ];

    for (const sel of skipSelectors) {
      const btns = document.querySelectorAll(sel);
      for (const btn of btns) {
        try { btn.click(); } catch (e) {}
      }
    }

    // 2. Fast-forward & mute any playing in-player ad video
    const adContainer = document.querySelector('.ad-showing, .ad-interrupting, #movie_player.ad-showing, .html5-video-player.ad-showing, .ytp-ad-player-overlay');
    if (adContainer) {
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        try {
          v.muted = true;
          v.volume = 0;
          v.playbackRate = 16.0;
          if (v.duration && isFinite(v.duration)) {
            v.currentTime = v.duration;
          }
        } catch (e) {}
      }
    }
  }

  // Active/Visible Shorts reel ad check & skip
  function checkAndHandleAds() {
    if (!settings.autoSkipAds) return false;

    skipVideoAd();

    if (!isShortsPage()) return false;

    const reels = getAllReels();
    const vh = window.innerHeight || 800;
    const now = Date.now();

    for (const reel of reels) {
      const rect = reel.getBoundingClientRect();
      const isInView = rect.top >= -vh * 0.45 && rect.top < vh * 0.65;
      const isActive = reel.hasAttribute('is-active') || reel.classList.contains('is-active');

      if ((isInView || isActive) && isAdShort(reel)) {
        console.log('[Auto Shorts Scroller] Ad Reel detected! Muting & skipping...');
        const v = reel.querySelector('video');
        if (v) {
          v.muted = true;
          v.volume = 0;
          try { v.pause(); } catch (e) {}
        }

        if (now - lastAdSkipTime > 150) {
          advanceToNextShort(false, true);
        }
        return true;
      }
    }

    // Global overlay fallback
    const globalOverlay = document.querySelector('ytd-shorts #overlay, ytd-shorts-player-overlay');
    if (globalOverlay && isAdShort(globalOverlay)) {
      console.log('[Auto Shorts Scroller] Ad detected in global overlay! Skipping...');
      if (now - lastAdSkipTime > 150) {
        advanceToNextShort(false, true);
      }
      return true;
    }

    return false;
  }

  // Extract Short ID from URL or DOM
  function getCurrentShortId() {
    const urlMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];
    const activeReel = getActiveReel();
    if (activeReel) {
      const id = activeReel.getAttribute('id') || activeReel.getAttribute('video-id');
      if (id) return id;
    }
    return window.location.href;
  }

  // Extract Creator Information
  function getCreatorInfo(reel) {
    if (!reel) reel = getActiveReel();
    if (!reel) return { name: '', handle: '' };

    const channelLink =
      reel.querySelector('yt-reel-channel-bar-view-model a') ||
      reel.querySelector('ytd-channel-name a') ||
      reel.querySelector('#channel-name a') ||
      reel.querySelector('a[href*="/@"]') ||
      reel.querySelector('#text-container a');

    let name = '';
    let handle = '';

    if (channelLink) {
      name = (channelLink.textContent || '').trim();
      const href = channelLink.getAttribute('href') || '';
      const handleMatch = href.match(/@([a-zA-Z0-9._-]+)/);
      if (handleMatch) {
        handle = '@' + handleMatch[1].toLowerCase();
      } else if (name.startsWith('@')) {
        handle = name.toLowerCase();
      } else if (name) {
        handle = '@' + name.toLowerCase().replace(/\s+/g, '');
      }
    }

    return { name, handle };
  }

  // Extract Short Title
  function getShortTitle(reel) {
    if (!reel) reel = getActiveReel();
    if (!reel) return 'YouTube Short';

    const titleEl =
      reel.querySelector('#overlay-title') ||
      reel.querySelector('#title yt-formatted-string') ||
      reel.querySelector('h2.title') ||
      reel.querySelector('yt-formatted-string.title') ||
      reel.querySelector('#title');

    return titleEl ? (titleEl.textContent || '').trim() : 'YouTube Short';
  }

  // Record viewed Short into Watch History
  function recordWatchHistory() {
    const shortId = getCurrentShortId();
    if (!shortId || recordedShorts.has(shortId)) return;

    const reel = getActiveReel();
    if (isAdShort(reel)) return; // Don't record ads into watch history!

    recordedShorts.add(shortId);

    const creator = getCreatorInfo(reel);
    const title = getShortTitle(reel);

    const historyItem = {
      id: shortId,
      title: title || 'YouTube Short',
      creator: creator.name || creator.handle || 'Creator',
      handle: creator.handle || '',
      url: window.location.href,
      timestamp: Date.now()
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['watchHistory'], (res) => {
        let list = res.watchHistory || [];
        list = list.filter((item) => item.id !== shortId);
        list.unshift(historyItem);
        if (list.length > 30) list = list.slice(0, 30);
        chrome.storage.local.set({ watchHistory: list });
      });
    }
  }

  // Auto-Like engine
  function checkAndAutoLike(curTime) {
    if (settings.autoLikeMode === 'off' || !isShortsPage()) return;
    if (curTime < (settings.minWatchBeforeLike || 2.5)) return;

    const reel = getActiveReel();
    if (!reel || isAdShort(reel)) return; // Don't like ads!

    const shortId = getCurrentShortId();
    if (!shortId || likedShorts.has(shortId)) return;

    const creator = getCreatorInfo(reel);
    let shouldLike = false;

    if (settings.autoLikeMode === 'all') {
      shouldLike = true;
    } else if (settings.autoLikeMode === 'favorites') {
      const favorites = (settings.favoriteCreators || []).map((c) => c.toLowerCase().trim());
      const handle = (creator.handle || '').toLowerCase();
      const name = (creator.name || '').toLowerCase();

      shouldLike = favorites.some((fav) => {
        if (!fav) return false;
        const cleanFav = fav.startsWith('@') ? fav : '@' + fav;
        return handle === cleanFav || name === fav || name.includes(fav);
      });
    }

    if (!shouldLike) return;

    const likeBtn =
      reel.querySelector('like-button-view-model button') ||
      reel.querySelector('#like-button yt-button-shape button') ||
      reel.querySelector('#like-button button') ||
      reel.querySelector('button[aria-label*="like this video" i]') ||
      reel.querySelector('button[aria-label*="like" i]');

    if (!likeBtn) return;

    const isAlreadyLiked =
      likeBtn.getAttribute('aria-pressed') === 'true' ||
      likeBtn.classList.contains('yt-spec-button-shape-next--tonal');

    if (isAlreadyLiked) {
      likedShorts.add(shortId);
      return;
    }

    likeBtn.click();
    likedShorts.add(shortId);

    const displayName = creator.name || creator.handle || 'Creator';
    showToast(`❤️ Auto-Liked ${displayName}`);
  }

  // Safe check: Is user typing in an active text input?
  function isUserTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(type);
    }
    if (tag === 'textarea') return true;
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  // Toast indicator
  function showToast(message) {
    let toast = document.getElementById('yt-shorts-scroller-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'yt-shorts-scroller-toast';
      (document.body || document.documentElement).appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      if (toast) toast.classList.remove('visible');
    }, 1200);
  }

  // Floating Badge / HUD in bottom-right corner
  function renderHud() {
    if (!isShortsPage()) {
      const existing = document.getElementById('yt-shorts-scroller-hud');
      if (existing) existing.remove();
      return;
    }

    if (!settings.showIndicator) {
      const existing = document.getElementById('yt-shorts-scroller-hud');
      if (existing) existing.style.display = 'none';
      return;
    }

    let hud = document.getElementById('yt-shorts-scroller-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'yt-shorts-scroller-hud';
      hud.title = 'Click to toggle Auto-Scroll ON/OFF';
      hud.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.autoScroll = !settings.autoScroll;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.set({ autoScroll: settings.autoScroll });
        }
        showToast(settings.autoScroll ? '🟢 Auto-Scroll: ON' : '⚪ Auto-Scroll: OFF');
        renderHud();
      });

      const parent = document.documentElement || document.body;
      if (parent) parent.appendChild(hud);
    }

    hud.style.display = 'flex';
    if (settings.requireLicenseLink && !settings.isProActivated) {
      hud.className = 'disabled';
      hud.innerHTML = `
        <span class="hud-dot" style="background:#f39c12;box-shadow:none;"></span>
        <span class="hud-text">🔒 Enter VIP Link</span>
        <span class="hud-hint">VIP</span>
      `;
    } else if (settings.autoScroll) {
      hud.className = '';
      hud.innerHTML = `
        <span class="hud-dot"></span>
        <span class="hud-text">Auto-Scroll ON</span>
        <span class="hud-hint">G: Skip</span>
      `;
    } else {
      hud.className = 'disabled';
      hud.innerHTML = `
        <span class="hud-dot"></span>
        <span class="hud-text">Auto-Scroll OFF</span>
        <span class="hud-hint">G: Skip</span>
      `;
    }
  }

  // Find active Short reel container
  function getActiveReel() {
    const reels = getAllReels();
    for (const reel of reels) {
      if (reel.hasAttribute('is-active') || reel.classList.contains('is-active')) {
        return reel;
      }
    }
    const vh = window.innerHeight || 800;
    for (const reel of reels) {
      const rect = reel.getBoundingClientRect();
      if (rect.top >= -vh * 0.4 && rect.top < vh * 0.6) {
        return reel;
      }
    }
    return reels[0] || null;
  }

  // Multi-method advance to next Short
  function advanceToNextShort(isManualSkip = false, isAdSkip = false) {
    if (!isShortsPage()) return;

    const now = Date.now();

    // Cooldown management
    if (isAdSkip) {
      if (now - lastAdSkipTime < 150) return;
      lastAdSkipTime = now;
      lastAdvanceTime = now;
    } else if (isManualSkip) {
      if (now - lastAdvanceTime < 250) return;
      lastAdvanceTime = now;
      if (!settings.skipKeyEnabled) return;
    } else {
      if (isAdvancing || now - lastAdvanceTime < 600) return;
      lastAdvanceTime = now;
    }

    isAdvancing = true;
    lastTime = 0;
    maxTimeReached = 0;
    stallCount = 0;

    if (isAdSkip) {
      showToast('⚡ Ad Skipped');
    } else if (isManualSkip) {
      showToast('⏭️ Skipped (G)');
      recordWatchHistory();
    } else {
      showToast('⏭️ Auto-Next');
      recordWatchHistory();
    }

    // 1. YouTube native Next Video button - click ALL possible matches
    const nextBtnSelectors = [
      '#navigation-button-down yt-button-shape button',
      '#navigation-button-down button',
      '#navigation-button-down',
      'ytd-shorts #navigation-button-down button',
      'button[aria-label="Next video"]',
      'button[aria-label="Next short"]',
      'button[aria-label="Next"]',
      'button[aria-label*="next" i]',
      'ytd-shorts [aria-label*="next" i] button',
      'ytd-shorts [aria-label*="next" i]'
    ];

    for (const sel of nextBtnSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        try { btn.click(); } catch (e) {}
        break;
      }
    }

    // 2. Next reel scrollIntoView
    const reels = getAllReels();
    let currentIndex = -1;
    for (let i = 0; i < reels.length; i++) {
      if (reels[i].hasAttribute('is-active') || reels[i].classList.contains('is-active')) {
        currentIndex = i;
        break;
      }
    }
    if (currentIndex === -1) {
      for (let i = 0; i < reels.length; i++) {
        const rect = reels[i].getBoundingClientRect();
        if (rect.top >= -window.innerHeight * 0.4 && rect.top < window.innerHeight * 0.6) {
          currentIndex = i;
          break;
        }
      }
    }

    if (currentIndex !== -1) {
      let targetIndex = currentIndex + 1;
      // If the upcoming reel is already detected as an ad, target the one after it
      if (isAdShort(reels[targetIndex]) && reels[targetIndex + 1]) {
        targetIndex = currentIndex + 2;
      }
      if (reels[targetIndex]) {
        const behavior = isAdSkip ? 'auto' : 'smooth';
        try {
          reels[targetIndex].scrollIntoView({ behavior, block: 'start' });
          reels[targetIndex].scrollIntoView({ behavior, block: 'nearest' });
        } catch (e) {}
      }
    }

    // 3. Container scrollBy and scrollTop
    const scrollContainers = [
      document.querySelector('#shorts-inner-container'),
      document.querySelector('#shorts-container'),
      document.querySelector('ytd-shorts'),
      document.documentElement,
      document.body
    ];
    for (const c of scrollContainers) {
      if (c) {
        try {
          if (c.scrollBy) c.scrollBy({ top: window.innerHeight, behavior: isAdSkip ? 'auto' : 'smooth' });
          c.scrollTop += window.innerHeight;
        } catch (e) {}
      }
    }

    // 4. Dispatch KeyboardEvent ArrowDown to all candidate nodes
    const keyTargets = [
      document.activeElement,
      document.querySelector('#movie_player'),
      document.querySelector('ytd-shorts'),
      document.querySelector('#shorts-container'),
      document.body,
      window
    ];
    const keyOpts = {
      key: 'ArrowDown',
      code: 'ArrowDown',
      keyCode: 40,
      which: 40,
      bubbles: true,
      cancelable: true
    };
    keyTargets.forEach((t) => {
      if (t && t.dispatchEvent) {
        try {
          t.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
          t.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        } catch (e) {}
      }
    });

    // 5. Synthetic wheel event (Mac trackpad swipe emulation)
    try {
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: window.innerHeight || 800,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        view: window
      });
      (document.querySelector('#shorts-container') || document.querySelector('ytd-shorts') || window).dispatchEvent(wheelEvent);
    } catch (e) {}

    setTimeout(() => {
      isAdvancing = false;
    }, isAdSkip ? 200 : 700);
  }

  function triggerAutoAdvance() {
    if (isAdvancing) return;
    const delayMs = (settings.delay || 0) * 1000;
    if (delayMs > 0) {
      setTimeout(() => advanceToNextShort(false, false), delayMs);
    } else {
      advanceToNextShort(false, false);
    }
  }

  // Hook all video elements
  function hookVideo(video) {
    if (!video || attachedVideos.has(video)) return;
    attachedVideos.add(video);

    video.removeAttribute('loop');
    try {
      video.loop = false;
    } catch (e) {}

    video.addEventListener('ended', () => {
      if (settings.autoScroll && isShortsPage()) {
        triggerAutoAdvance();
      }
    });

    video.addEventListener('play', () => {
      isAdvancing = false;
      video.removeAttribute('loop');
      try {
        video.loop = false;
      } catch (e) {}
    });

    video.addEventListener('timeupdate', () => {
      if (!isShortsPage()) return;
      const cur = video.currentTime;
      const dur = video.duration;

      // Auto-Like check
      checkAndAutoLike(cur);

      // History recording after 3s
      if (cur >= 3.0) {
        recordWatchHistory();
      }

      if (!settings.autoScroll || isAdvancing) return;
      if (dur > 0 && isFinite(dur) && cur >= dur - 0.45) {
        triggerAutoAdvance();
      }
    });
  }

  // High-resolution 35ms monitoring tick
  function detectionTick() {
    // 1. Global video ad skipping across all YouTube players
    if (settings.autoSkipAds) {
      skipVideoAd();
    }

    if (!isShortsPage()) return;

    renderHud();

    // 2. Check and handle any active or visible Shorts ads immediately
    const adHandled = checkAndHandleAds();
    if (adHandled) return;

    // 3. Hook video elements
    const allVideos = document.querySelectorAll('video');
    for (const v of allVideos) {
      hookVideo(v);
    }

    // Find currently active video
    let playingVideo = null;
    for (const v of allVideos) {
      if (!v.paused && v.currentTime > 0) {
        playingVideo = v;
        break;
      }
    }

    if (!playingVideo) {
      if (activeReel) playingVideo = activeReel.querySelector('video');
    }

    if (!playingVideo) return;

    // Strip loop
    if (playingVideo.hasAttribute('loop')) playingVideo.removeAttribute('loop');
    if (playingVideo.loop) playingVideo.loop = false;

    const cur = playingVideo.currentTime;
    const dur = playingVideo.duration;

    // Trigger auto-like if applicable
    checkAndAutoLike(cur);

    if (cur >= 3.0) {
      recordWatchHistory();
    }

    if (!settings.autoScroll || isAdvancing) return;

    if (cur > maxTimeReached) {
      maxTimeReached = cur;
    }

    // Signal 1: Native ended
    if (playingVideo.ended) {
      triggerAutoAdvance();
      return;
    }

    // Signal 2: Approaching duration end
    if (dur > 0 && isFinite(dur)) {
      const endThreshold = Math.max(0.42, dur * 0.02);
      if (cur >= dur - endThreshold) {
        triggerAutoAdvance();
        return;
      }

      // Signal 3: Loop wrap-around
      if (maxTimeReached >= Math.max(2.0, dur - 1.8) && cur < 1.0 && cur < lastTime) {
        triggerAutoAdvance();
        return;
      }
    } else {
      if (maxTimeReached > 3.0 && cur < 1.0 && cur < lastTime) {
        triggerAutoAdvance();
        return;
      }
    }

    // Signal 4: End stall
    if (dur > 0 && cur >= dur - 0.65 && Math.abs(cur - lastTime) < 0.01 && !playingVideo.paused) {
      stallCount++;
      if (stallCount >= 8) {
        triggerAutoAdvance();
        return;
      }
    } else {
      stallCount = 0;
    }

    lastTime = cur;
  }

  setInterval(detectionTick, 35);

  // Immediate MutationObserver for ultra-responsive ad interception
  const observer = new MutationObserver((mutations) => {
    if (!settings.autoSkipAds) return;

    skipVideoAd();

    if (!isShortsPage()) return;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            const tag = (node.tagName || '').toLowerCase();
            if (
              tag.includes('ad') ||
              tag === 'badge-shape' ||
              (node.classList && (node.classList.contains('ytp-ad-player-overlay') || node.classList.contains('ad-showing')))
            ) {
              checkAndHandleAds();
              return;
            }
          }
        }
      } else if (mutation.type === 'attributes') {
        if (mutation.attributeName === 'is-active' || mutation.attributeName === 'class') {
          checkAndHandleAds();
        }
      }
    }
  });

  try {
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['is-active', 'class', 'is-sponsored', 'is-ad']
    });
  } catch (e) {}

  // Keydown listener: 'G' key skips immediately
  function handleKeyDown(e) {
    if (!isShortsPage()) return;
    if (isUserTyping()) return;

    const key = (e.key || '').toLowerCase();
    const code = e.code || '';
    const keyCode = e.keyCode || e.which;

    const isG = key === 'g' || code === 'KeyG' || keyCode === 71;
    const isSpace = settings.allowSpaceSkip && (code === 'Space' || key === ' ' || keyCode === 32);

    if (isG || isSpace) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      advanceToNextShort(true, false);
    }
  }

  window.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('keydown', handleKeyDown, true);

  // SPA navigation handling
  window.addEventListener('yt-navigate-finish', () => {
    isAdvancing = false;
    lastTime = 0;
    maxTimeReached = 0;
    stallCount = 0;
    setTimeout(renderHud, 250);
  });

  window.addEventListener('popstate', () => {
    isAdvancing = false;
    lastTime = 0;
    maxTimeReached = 0;
    stallCount = 0;
    setTimeout(renderHud, 250);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderHud);
  } else {
    renderHud();
  }
})();
