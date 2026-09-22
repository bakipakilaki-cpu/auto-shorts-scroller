document.addEventListener('DOMContentLoaded', () => {
  // Tabs Navigation
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(`tab-${btn.dataset.tab}`);
      if (targetPane) targetPane.classList.add('active');

      if (btn.dataset.tab === 'history') {
        loadHistory();
      }
    });
  });

  // Controls Elements
  const toggleAutoScroll = document.getElementById('toggleAutoScroll');
  const toggleSkipAds = document.getElementById('toggleSkipAds');
  const toggleSkipKey = document.getElementById('toggleSkipKey');
  const toggleSpaceSkip = document.getElementById('toggleSpaceSkip');
  const toggleIndicator = document.getElementById('toggleIndicator');
  const delayRange = document.getElementById('delayRange');
  const delayValue = document.getElementById('delayValue');
  const statusBadge = document.getElementById('statusBadge');

  // Auto-Like Elements
  const autoLikeRadios = document.querySelectorAll('input[name="autoLikeMode"]');
  const creatorInput = document.getElementById('creatorInput');
  const addCreatorBtn = document.getElementById('addCreatorBtn');
  const creatorsChipList = document.getElementById('creatorsChipList');

  // History Elements
  const historyList = document.getElementById('historyList');
  const historyCount = document.getElementById('historyCount');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  // Default Settings
  let settings = {
    autoScroll: true,
    autoSkipAds: true,
    skipKeyEnabled: true,
    allowSpaceSkip: false,
    showIndicator: true,
    delay: 0,
    autoLikeMode: 'favorites',
    favoriteCreators: ['@mrbeast']
  };

  // Load Saved Settings
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(settings, (items) => {
      settings = { ...settings, ...items };

      // Controls UI
      toggleAutoScroll.checked = settings.autoScroll !== false;
      toggleSkipAds.checked = settings.autoSkipAds !== false;
      toggleSkipKey.checked = settings.skipKeyEnabled !== false;
      toggleSpaceSkip.checked = settings.allowSpaceSkip === true;
      toggleIndicator.checked = settings.showIndicator !== false;

      const delay = settings.delay !== undefined ? settings.delay : 0;
      delayRange.value = delay;
      delayValue.textContent = `${Number(delay).toFixed(1)}s`;

      // Auto-Like Mode
      autoLikeRadios.forEach((radio) => {
        radio.checked = radio.value === settings.autoLikeMode;
      });

      // Render Creator Chips
      renderCreatorChips();
    });

    // Active Tab Check
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].url) {
          const url = tabs[0].url;
          if (url.includes('youtube.com/shorts')) {
            statusBadge.textContent = 'Active';
            statusBadge.className = 'badge';
          } else if (url.includes('youtube.com')) {
            statusBadge.textContent = 'YouTube';
            statusBadge.className = 'badge inactive';
          } else {
            statusBadge.textContent = 'Ready';
            statusBadge.className = 'badge inactive';
          }
        }
      });
    }
  }

  // Save Settings Helper
  function saveSettings() {
    const selectedMode = Array.from(autoLikeRadios).find((r) => r.checked)?.value || 'favorites';

    const newSettings = {
      autoScroll: toggleAutoScroll.checked,
      autoSkipAds: toggleSkipAds.checked,
      skipKeyEnabled: toggleSkipKey.checked,
      allowSpaceSkip: toggleSpaceSkip.checked,
      showIndicator: toggleIndicator.checked,
      delay: parseFloat(delayRange.value) || 0,
      autoLikeMode: selectedMode,
      favoriteCreators: settings.favoriteCreators
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(newSettings);
    }
  }

  // Event Listeners for Controls
  toggleAutoScroll.addEventListener('change', saveSettings);
  toggleSkipAds.addEventListener('change', saveSettings);
  toggleSkipKey.addEventListener('change', saveSettings);
  toggleSpaceSkip.addEventListener('change', saveSettings);
  toggleIndicator.addEventListener('change', saveSettings);

  delayRange.addEventListener('input', () => {
    const val = parseFloat(delayRange.value) || 0;
    delayValue.textContent = `${val.toFixed(1)}s`;
  });
  delayRange.addEventListener('change', saveSettings);

  autoLikeRadios.forEach((radio) => {
    radio.addEventListener('change', saveSettings);
  });

  // Creator Whitelist Chips
  function renderCreatorChips() {
    creatorsChipList.innerHTML = '';
    const list = settings.favoriteCreators || [];

    if (list.length === 0) {
      creatorsChipList.innerHTML = '<span style="font-size:11px;color:#666;">No favorite creators added yet.</span>';
      return;
    }

    list.forEach((creator, idx) => {
      const chip = document.createElement('div');
      chip.className = 'creator-chip';
      chip.innerHTML = `
        <span>${escapeHtml(creator)}</span>
        <span class="creator-chip-remove" data-index="${idx}">✕</span>
      `;
      creatorsChipList.appendChild(chip);
    });

    creatorsChipList.querySelectorAll('.creator-chip-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index, 10);
        settings.favoriteCreators.splice(index, 1);
        renderCreatorChips();
        saveSettings();
      });
    });
  }

  function addCreator() {
    let val = (creatorInput.value || '').trim();
    if (!val) return;

    if (!val.startsWith('@')) {
      val = '@' + val;
    }
    val = val.toLowerCase();

    if (!settings.favoriteCreators) settings.favoriteCreators = [];
    if (!settings.favoriteCreators.includes(val)) {
      settings.favoriteCreators.push(val);
      renderCreatorChips();
      saveSettings();
    }
    creatorInput.value = '';
  }

  addCreatorBtn.addEventListener('click', addCreator);
  creatorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCreator();
    }
  });

  // Watch History Helper
  function loadHistory() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['watchHistory'], (res) => {
        const list = res.watchHistory || [];
        renderHistoryList(list);
      });
    }
  }

  function renderHistoryList(list) {
    historyCount.textContent = `${list.length} Short${list.length === 1 ? '' : 's'}`;
    historyList.innerHTML = '';

    if (list.length === 0) {
      historyList.innerHTML = `
        <div class="history-empty">
          <span class="history-empty-icon">📺</span>
          <span>No Shorts watched yet.</span>
        </div>
      `;
      return;
    }

    list.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'history-item';
      card.innerHTML = `
        <div class="history-item-info">
          <span class="history-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
          <div class="history-meta">
            <span class="history-creator">${escapeHtml(item.creator)}</span>
            <span>•</span>
            <span>${timeAgo(item.timestamp)}</span>
          </div>
        </div>
        <span style="font-size:14px;color:#777;">↗</span>
      `;

      card.addEventListener('click', () => {
        if (chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: item.url });
        } else {
          window.open(item.url, '_blank');
        }
      });

      historyList.appendChild(card);
    });
  }

  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Clear all watched Shorts history?')) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ watchHistory: [] }, () => {
          renderHistoryList([]);
        });
      }
    }
  });

  // Utilities
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function timeAgo(ms) {
    if (!ms) return '';
    const diff = Math.floor((Date.now() - ms) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  // Load history initially
  loadHistory();
});
