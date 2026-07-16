/* app.js — THREADS main controller */

// ---------- Settings ----------

const Settings = (() => {
  const STORAGE_KEY = 'threads_settings';
  const DEFAULTS = {
    resultDisplay: 'both',       // 'both' | 'photos' | 'text'
    showWornBadges: 'yes',       // 'yes' | 'no'
    historyDays: 7,              // number of past outfit-log days to include for repeat-avoidance
    model: 'claude-haiku-4-5-20251001', // API model id
    imageQuality: 'medium',      // 'low' | 'medium' | 'high'
    autoTag: 'yes',              // 'yes' | 'no' — whether to call the AI to tag new items
    pinnedCategories: '',        // comma-separated list of category names to show first, in that order
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    } catch (err) {
      console.warn('Failed to load settings, using defaults:', err);
      return { ...DEFAULTS };
    }
  }

  function save(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function get(key) {
    return load()[key];
  }

  // Maps imageQuality setting to (maxDimension, quality) numbers used by
  // the image-compression step before sending to Claude for tagging.
  function getImageCompressionParams() {
    const q = get('imageQuality');
    if (q === 'low') return { maxDim: 512, quality: 0.7 };
    if (q === 'high') return { maxDim: 1200, quality: 0.9 };
    return { maxDim: 800, quality: 0.8 }; // medium / default
  }

  return { load, save, get, getImageCompressionParams };
})();

let pendingPhotoBlob = null;
let pendingMediaType = null;
let pendingTags = null;

const els = {
  connectVaultBtn: document.getElementById('connectVaultBtn'),
  reselectVaultBtn: document.getElementById('reselectVaultBtn'),
  addItemBtn: document.getElementById('addItemBtn'),
  vaultStatus: document.getElementById('vaultStatus'),
  closetRails: document.getElementById('closetRails'),

  addItemModal: document.getElementById('addItemModal'),
  addItemForm: document.getElementById('addItemForm'),
  itemPhotoInput: document.getElementById('itemPhotoInput'),
  itemPhotoPreview: document.getElementById('itemPhotoPreview'),
  tagStatus: document.getElementById('tagStatus'),
  tagFields: document.getElementById('tagFields'),
  tagCategory: document.getElementById('tagCategory'),
  tagCategoryOptions: document.getElementById('tagCategoryOptions'),
  tagColor: document.getElementById('tagColor'),
  tagStyleGroup: document.getElementById('tagStyleGroup'),
  tagSeason: document.getElementById('tagSeason'),
  tagBrand: document.getElementById('tagBrand'),
  tagMaterial: document.getElementById('tagMaterial'),
  tagSize: document.getElementById('tagSize'),
  tagPurchaseDate: document.getElementById('tagPurchaseDate'),
  tagPrice: document.getElementById('tagPrice'),
  tagNotes: document.getElementById('tagNotes'),
  cancelAddItem: document.getElementById('cancelAddItem'),
  saveItemBtn: document.getElementById('saveItemBtn'),

  styleSelect: document.getElementById('styleSelect'),
  weatherInput: document.getElementById('weatherInput'),
  suggestBtn: document.getElementById('suggestBtn'),
  outfitResult: document.getElementById('outfitResult'),
  weekGrid: document.getElementById('weekGrid'),
  closetSearch: document.getElementById('closetSearch'),

  closetInsights: document.getElementById('closetInsights'),
  insightsGrid: document.getElementById('insightsGrid'),
  toggleInsights: document.getElementById('toggleInsights'),

  lightboxModal: document.getElementById('lightboxModal'),
  lightboxImage: document.getElementById('lightboxImage'),
  closeLightbox: document.getElementById('closeLightbox'),

  dayPlanModal: document.getElementById('dayPlanModal'),
  dayPlanForm: document.getElementById('dayPlanForm'),
  dayPlanTitle: document.getElementById('dayPlanTitle'),
  dayPlanStyle: document.getElementById('dayPlanStyle'),
  dayPlanWeather: document.getElementById('dayPlanWeather'),
  cancelDayPlan: document.getElementById('cancelDayPlan'),
  submitDayPlan: document.getElementById('submitDayPlan'),

  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  settingsForm: document.getElementById('settingsForm'),
  settingResultDisplay: document.getElementById('settingResultDisplay'),
  settingShowWornBadges: document.getElementById('settingShowWornBadges'),
  settingHistoryDays: document.getElementById('settingHistoryDays'),
  settingModel: document.getElementById('settingModel'),
  settingImageQuality: document.getElementById('settingImageQuality'),
  settingAutoTag: document.getElementById('settingAutoTag'),
  settingPinnedCategories: document.getElementById('settingPinnedCategories'),
  cancelSettings: document.getElementById('cancelSettings'),
  saveSettings: document.getElementById('saveSettings'),

  detailModal: document.getElementById('detailModal'),
  detailForm: document.getElementById('detailForm'),
  detailPhotoPreview: document.getElementById('detailPhotoPreview'),
  detailCategory: document.getElementById('detailCategory'),
  detailColor: document.getElementById('detailColor'),
  detailStyleGroup: document.getElementById('detailStyleGroup'),
  detailSeason: document.getElementById('detailSeason'),
  detailBrand: document.getElementById('detailBrand'),
  detailMaterial: document.getElementById('detailMaterial'),
  detailSize: document.getElementById('detailSize'),
  detailPurchaseDate: document.getElementById('detailPurchaseDate'),
  detailPrice: document.getElementById('detailPrice'),
  detailNotes: document.getElementById('detailNotes'),
  detailStatsRow: document.getElementById('detailStatsRow'),
  detailAddedDate: document.getElementById('detailAddedDate'),
  deleteItemBtn: document.getElementById('deleteItemBtn'),
  closeDetailBtn: document.getElementById('closeDetailBtn'),
  saveDetailBtn: document.getElementById('saveDetailBtn'),
};

// ---------- Vault connection ----------

els.connectVaultBtn.addEventListener('click', async () => {
  els.vaultStatus.querySelector('.status-line').textContent = 'connecting…';
  const ok = await Vault.connect();
  if (ok) {
    const folderId = Vault.getConnectedFolderId();
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    els.vaultStatus.querySelector('.status-line').innerHTML =
      `vault connected — <a href="${folderUrl}" target="_blank" style="color:inherit">open 08-Closet in Drive</a>`;
    els.reselectVaultBtn.classList.remove('hidden');
    await renderCloset();
    await renderWeekPlanner();
  } else {
    els.vaultStatus.querySelector('.status-line').textContent =
      'connection cancelled or failed — try again';
  }
});

els.reselectVaultBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    'This lets you pick a different folder to use as your closet. Pick the folder that already contains "08-Closet", or your BAKER vault root — not the 08-Closet folder itself.'
  );
  if (!confirmed) return;
  els.vaultStatus.querySelector('.status-line').textContent = 'reselecting…';
  const ok = await Vault.reselectVaultFolder();
  if (ok) {
    const folderId = Vault.getConnectedFolderId();
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    els.vaultStatus.querySelector('.status-line').innerHTML =
      `vault connected — <a href="${folderUrl}" target="_blank" style="color:inherit">open 08-Closet in Drive</a>`;
    await renderCloset();
    await renderWeekPlanner();
  } else {
    els.vaultStatus.querySelector('.status-line').textContent =
      'connection cancelled or failed — try again';
  }
});

// ---------- Add item modal ----------

els.addItemBtn.addEventListener('click', () => {
  if (!Vault.isConnected()) {
    alert('Connect your vault first so THREADS knows where to save items.');
    return;
  }
  resetModal();
  els.addItemModal.showModal();
});

els.cancelAddItem.addEventListener('click', () => {
  els.addItemModal.close();
  resetModal();
});

function getCheckedStyles() {
  return Array.from(els.tagStyleGroup.querySelectorAll('input[type="checkbox"]:checked')).map(
    (cb) => cb.value
  );
}

function setCheckedStyles(styles) {
  const set = new Set((styles || []).map((s) => s.toLowerCase()));
  els.tagStyleGroup.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = set.has(cb.value);
  });
}

function resetModal() {
  pendingPhotoBlob = null;
  pendingMediaType = null;
  pendingTags = null;
  els.itemPhotoInput.value = '';
  els.itemPhotoPreview.classList.add('hidden');
  els.tagStatus.classList.add('hidden');
  els.tagFields.classList.add('hidden');
  els.saveItemBtn.disabled = true;
  els.tagCategory.value = '';
  els.tagColor.value = '';
  setCheckedStyles([]);
  els.tagSeason.value = '';
  els.tagBrand.value = '';
  els.tagMaterial.value = '';
  els.tagSize.value = '';
  els.tagPurchaseDate.value = '';
  els.tagPrice.value = '';
  els.tagNotes.value = '';
}

// Fills the category input's datalist with autocomplete suggestions (existing
// categories + optional extra defaults), preserving a typeable free-text input.
function populateCategoryOptions(categoriesArr) {
  els.tagCategoryOptions.innerHTML = '';
  // Deduplicate while preserving order
  const seen = new Set();
  for (const cat of categoriesArr) {
    if (!cat || seen.has(cat)) continue;
    seen.add(cat);
    const opt = document.createElement('option');
    opt.value = cat;
    els.tagCategoryOptions.appendChild(opt);
  }
}

els.itemPhotoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  pendingPhotoBlob = file;
  pendingMediaType = file.type;

  const previewUrl = URL.createObjectURL(file);
  els.itemPhotoPreview.src = previewUrl;
  els.itemPhotoPreview.classList.remove('hidden');

  const autoTagEnabled = Settings.get('autoTag') === 'yes';
  const knownCategories = await Vault.listCategoryFiles();

  // Manual tagging mode: skip AI, show empty tag fields for user to fill in
  if (!autoTagEnabled) {
    els.tagStatus.classList.add('hidden');
    const cats = knownCategories.length ? knownCategories : ['Tees', 'Shirts', 'Flannels', 'Sweaters', 'Hoodies', 'Jackets', 'Coats', 'Pants', 'Jeans', 'Cargos', 'Shorts', 'Shoes', 'Sneakers', 'Boots', 'Hats', 'Accessories'];
    populateCategoryOptions(cats);
    els.tagCategory.value = '';
    els.tagColor.value = '';
    setCheckedStyles([]);
    els.tagSeason.value = '';
    els.tagFields.classList.remove('hidden');
    els.saveItemBtn.disabled = false;
    return;
  }

  // AI tagging mode
  els.tagStatus.classList.remove('hidden');
  els.tagStatus.textContent = 'tagging with AI…';
  els.tagFields.classList.add('hidden');
  els.saveItemBtn.disabled = true;

  try {
    const tags = await ClaudeAPI.tagClothingItem(file, file.type, knownCategories);
    pendingTags = tags;

    // Populate datalist with known categories + AI's suggestion, pre-fill input with the suggestion
    populateCategoryOptions([tags.category, ...knownCategories]);
    els.tagCategory.value = tags.category || '';

    els.tagColor.value = tags.color || '';
    setCheckedStyles(tags.styles || []);
    els.tagSeason.value = tags.season || '';

    els.tagStatus.classList.add('hidden');
    els.tagFields.classList.remove('hidden');
    els.saveItemBtn.disabled = false;
  } catch (err) {
    console.error('Tagging failed:', err);
    els.tagStatus.textContent = 'AI tagging failed — fill in tags manually below';
    const fallbackCats = knownCategories.length ? knownCategories : ['Tees', 'Shirts', 'Flannels', 'Sweaters', 'Hoodies', 'Jackets', 'Coats', 'Pants', 'Jeans', 'Cargos', 'Shorts', 'Shoes', 'Sneakers', 'Boots', 'Hats', 'Accessories'];
    populateCategoryOptions(fallbackCats);
    els.tagCategory.value = '';
    els.tagFields.classList.remove('hidden');
    els.saveItemBtn.disabled = false;
  }
});

els.addItemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pendingPhotoBlob) return;

  els.saveItemBtn.disabled = true;
  els.saveItemBtn.textContent = 'saving…';

  try {
    const category = els.tagCategory.value.trim();
    const color = els.tagColor.value.trim();
    const styles = getCheckedStyles();
    const styleText = styles.join(', ');
    const season = els.tagSeason.value.trim();
    const brand = els.tagBrand.value.trim();
    const material = els.tagMaterial.value.trim();
    const size = els.tagSize.value.trim();
    const purchaseDate = els.tagPurchaseDate.value.trim();
    const price = els.tagPrice.value.trim();
    const notes = els.tagNotes.value.trim();

    const ext = (pendingMediaType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const timestamp = Date.now();
    const filename = `${category.toLowerCase()}-${timestamp}.${ext}`;

    const imagePath = await Vault.saveImage(filename, pendingPhotoBlob);

    const dateAdded = new Date().toISOString().slice(0, 10);
    const lines = [
      `### ${color} ${category.replace(/s$/, '')}`,
      `![[${imagePath}]]`,
      `- color: ${color}`,
      `- style: ${styleText}`,
      `- season: ${season}`,
    ];
    if (brand) lines.push(`- brand: ${brand}`);
    if (material) lines.push(`- material: ${material}`);
    if (size) lines.push(`- size: ${size}`);
    if (purchaseDate) lines.push(`- purchased: ${purchaseDate}`);
    if (price) lines.push(`- price: ${price}`);
    if (notes) lines.push(`- notes: ${notes.replace(/\n/g, ' ')}`);
    lines.push(`- added: ${dateAdded}`);

    const itemMarkdown = lines.join('\n');

    await Vault.appendItem(category, itemMarkdown);

    els.addItemModal.close();
    resetModal();
    await renderCloset();
  } catch (err) {
    console.error('Save failed:', err);
    alert('Failed to save item to vault: ' + err.message);
  } finally {
    els.saveItemBtn.disabled = false;
    els.saveItemBtn.textContent = 'save to closet';
  }
});

// ---------- Render closet rails ----------

let closetItemsByCategory = {}; // cache for opening detail view without re-parsing
let currentSearchQuery = '';

// Debounce timer for search input to avoid re-rendering on every keystroke
let searchDebounceTimer = null;

els.closetSearch.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentSearchQuery = els.closetSearch.value.trim().toLowerCase();
    renderCloset();
  }, 200);
});

// Filters an array of parsed items by the current search query, matching
// against title/color/brand/material/style/notes. Blank query returns all.
function filterItemsBySearch(items) {
  if (!currentSearchQuery) return items;
  const q = currentSearchQuery;
  return items.filter((item) => {
    const searchable = [
      item.title,
      item.color,
      item.style,
      item.season,
      item.brand,
      item.material,
      item.size,
      item.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return searchable.includes(q);
  });
}

async function renderCloset() {
  const categories = await Vault.readAllCategories();
  els.closetRails.innerHTML = '';
  closetItemsByCategory = {};

  // Sort categories: pinned first (in specified order), then remaining alphabetically
  const pinnedRaw = Settings.get('pinnedCategories') || '';
  const pinnedList = pinnedRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allCatNames = Object.keys(categories);
  const pinnedPresent = pinnedList.filter((p) =>
    allCatNames.some((c) => c.toLowerCase() === p.toLowerCase())
  );
  // Normalize to the actual casing used in the vault
  const pinnedNormalized = pinnedPresent.map(
    (p) => allCatNames.find((c) => c.toLowerCase() === p.toLowerCase())
  );
  const remaining = allCatNames
    .filter((c) => !pinnedNormalized.includes(c))
    .sort((a, b) => a.localeCompare(b));
  const catNames = [...pinnedNormalized, ...remaining];

  if (catNames.length === 0) {
    els.closetRails.innerHTML = '<p class="status-line">no items yet — add your first piece</p>';
    return;
  }

  for (const cat of catNames) {
    const items = parseCategoryMarkdown(categories[cat]);
    closetItemsByCategory[cat] = items;

    // Filter items if search query is active
    const filteredItems = filterItemsBySearch(items);
    const hidden = items.length - filteredItems.length;

    const totalWear = items.reduce((sum, item) => sum + (item.worn || 0), 0);
    const wearText = totalWear > 0 ? ` · worn ${totalWear}× total` : '';
    const hiddenText = hidden > 0 ? ` · <span class="rail-hidden">${hidden} hidden by search</span>` : '';

    // Skip category entirely if all items filtered out
    if (filteredItems.length === 0 && currentSearchQuery) continue;

    const rail = document.createElement('section');
    rail.className = 'category-rail';
    rail.innerHTML = `
      <div class="rail-title">${cat} <span class="rail-count">${items.length} item${items.length === 1 ? '' : 's'}${wearText}${hiddenText}</span></div>
      <div class="rail-track">
        ${filteredItems.map((item) => renderGarmentCard(item, cat)).join('')}
      </div>
    `;
    els.closetRails.appendChild(rail);

    // Async-load each item's photo from the vault and swap it in
    const photoEls = rail.querySelectorAll('.garment-photo[data-image-path]');
    for (const imgEl of photoEls) {
      const path = imgEl.getAttribute('data-image-path');
      Vault.loadImageURL(path).then((url) => {
        if (url) imgEl.src = url;
      });
    }

    // Tap a card to open detail/edit view
    rail.querySelectorAll('.garment-card').forEach((card) => {
      card.addEventListener('click', () => {
        const category = card.getAttribute('data-category');
        const index = parseInt(card.getAttribute('data-index'), 10);
        openDetailModal(category, index);
      });
    });
  }

  renderInsights();
}

// ---------- Closet insights dashboard ----------

const INSIGHTS_COLLAPSED_KEY = 'threads_insights_collapsed';

function renderInsights() {
  if (!closetItemsByCategory || Object.keys(closetItemsByCategory).length === 0) {
    els.closetInsights.classList.add('hidden');
    return;
  }

  const allItems = [];
  for (const cat of Object.keys(closetItemsByCategory)) {
    for (const item of closetItemsByCategory[cat]) {
      allItems.push({ ...item, category: cat });
    }
  }

  if (allItems.length === 0) {
    els.closetInsights.classList.add('hidden');
    return;
  }
  els.closetInsights.classList.remove('hidden');

  // Restore collapsed state
  const collapsed = localStorage.getItem(INSIGHTS_COLLAPSED_KEY) === 'yes';
  els.insightsGrid.style.display = collapsed ? 'none' : '';
  els.toggleInsights.textContent = collapsed ? 'show' : 'hide';

  // --- Compute stats ---
  const totalItems = allItems.length;

  // Total closet value: sum all parseable prices
  let totalValue = 0;
  let itemsWithPrice = 0;
  for (const item of allItems) {
    const priceNum = item.price ? parseFloat(String(item.price).replace(/[^0-9.]/g, '')) : NaN;
    if (!isNaN(priceNum) && priceNum > 0) {
      totalValue += priceNum;
      itemsWithPrice++;
    }
  }

  // Total wears across everything
  const totalWears = allItems.reduce((sum, item) => sum + (item.worn || 0), 0);

  // Most worn item
  const mostWorn = allItems.reduce((best, item) => {
    const w = item.worn || 0;
    return w > (best ? best.worn || 0 : 0) ? item : best;
  }, null);

  // Least worn item that has been worn at least once
  const wornItems = allItems.filter((i) => (i.worn || 0) > 0);
  const leastWorn = wornItems.length > 0
    ? wornItems.reduce((worst, item) => ((item.worn || 0) < (worst.worn || 0) ? item : worst))
    : null;

  // Items never worn
  const neverWornCount = allItems.filter((i) => (i.worn || 0) === 0).length;

  // Oldest item by purchase date
  let oldestItem = null;
  for (const item of allItems) {
    if (!item.purchased) continue;
    const d = new Date(item.purchased);
    if (isNaN(d.getTime())) continue;
    if (!oldestItem || d < new Date(oldestItem.purchased)) oldestItem = item;
  }

  // Average cost-per-wear across items that have both price and wear count
  let cpwSum = 0;
  let cpwCount = 0;
  for (const item of allItems) {
    const priceNum = item.price ? parseFloat(String(item.price).replace(/[^0-9.]/g, '')) : NaN;
    if (isNaN(priceNum) || priceNum <= 0) continue;
    if (!item.worn || item.worn <= 0) continue;
    cpwSum += priceNum / item.worn;
    cpwCount++;
  }
  const avgCpw = cpwCount > 0 ? cpwSum / cpwCount : null;

  // Category breakdown text
  const catCounts = Object.keys(closetItemsByCategory)
    .map((cat) => ({ cat, n: closetItemsByCategory[cat].length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((c) => `${c.cat} (${c.n})`)
    .join(', ');

  // --- Render cards ---
  const cards = [
    {
      value: totalItems,
      label: 'total items',
      sub: catCounts ? `top: ${catCounts}` : '',
    },
    {
      value: totalValue > 0 ? `$${totalValue.toFixed(0)}` : '—',
      label: 'wardrobe value',
      sub: itemsWithPrice > 0 ? `${itemsWithPrice} of ${totalItems} items priced` : 'add prices to track',
    },
    {
      value: totalWears,
      label: 'total wears logged',
      sub: neverWornCount > 0 ? `${neverWornCount} never worn` : 'all items worn at least once',
    },
    {
      value: avgCpw !== null ? (avgCpw < 10 ? `$${avgCpw.toFixed(2)}` : `$${avgCpw.toFixed(1)}`) : '—',
      label: 'avg $/wear',
      sub: cpwCount > 0 ? `across ${cpwCount} items with data` : 'need prices + wears',
    },
    {
      value: mostWorn && mostWorn.worn > 0 ? `${mostWorn.worn}×` : '—',
      label: 'most worn',
      sub: mostWorn && mostWorn.worn > 0 ? `${mostWorn.title} (${mostWorn.category})` : '',
    },
    {
      value: leastWorn ? `${leastWorn.worn}×` : '—',
      label: 'least worn (of used)',
      sub: leastWorn ? `${leastWorn.title} (${leastWorn.category})` : '',
    },
    {
      value: oldestItem ? computeAgeText(oldestItem.purchased) : '—',
      label: 'oldest item',
      sub: oldestItem ? `${oldestItem.title} (${oldestItem.category})` : 'add purchase dates',
    },
  ];

  els.insightsGrid.innerHTML = cards
    .map(
      (c) => `
        <div class="insight-card">
          <div class="insight-value">${c.value}</div>
          <div class="insight-label">${c.label}</div>
          ${c.sub ? `<div class="insight-sub">${c.sub}</div>` : ''}
        </div>
      `
    )
    .join('');
}

els.toggleInsights.addEventListener('click', () => {
  const isHidden = els.insightsGrid.style.display === 'none';
  els.insightsGrid.style.display = isHidden ? '' : 'none';
  els.toggleInsights.textContent = isHidden ? 'hide' : 'show';
  localStorage.setItem(INSIGHTS_COLLAPSED_KEY, isHidden ? 'no' : 'yes');
});

function parseCategoryMarkdown(content) {
  if (!content) return [];
  const blocks = content.split(/^### /m).slice(1);
  return blocks.map((block, index) => {
    const lines = block.split('\n');
    const title = lines[0].trim();
    const imgMatch = block.match(/!\[\[(.+?)\]\]/);
    const colorMatch = block.match(/- color: (.+)/);
    const styleMatch = block.match(/- style: (.+)/);
    const seasonMatch = block.match(/- season: (.+)/);
    const addedMatch = block.match(/- added: (.+)/);
    const wornMatch = block.match(/- worn: (\d+)/);
    const brandMatch = block.match(/- brand: (.+)/);
    const materialMatch = block.match(/- material: (.+)/);
    const sizeMatch = block.match(/- size: (.+)/);
    const purchasedMatch = block.match(/- purchased: (.+)/);
    const priceMatch = block.match(/- price: (.+)/);
    const notesMatch = block.match(/- notes: (.+)/);
    return {
      index,
      raw: block,
      title,
      image: imgMatch ? imgMatch[1] : null,
      color: colorMatch ? colorMatch[1].trim() : '',
      style: styleMatch ? styleMatch[1].trim() : '',
      season: seasonMatch ? seasonMatch[1].trim() : '',
      added: addedMatch ? addedMatch[1].trim() : '',
      worn: wornMatch ? parseInt(wornMatch[1], 10) : 0,
      brand: brandMatch ? brandMatch[1].trim() : '',
      material: materialMatch ? materialMatch[1].trim() : '',
      size: sizeMatch ? sizeMatch[1].trim() : '',
      purchased: purchasedMatch ? purchasedMatch[1].trim() : '',
      price: priceMatch ? priceMatch[1].trim() : '',
      notes: notesMatch ? notesMatch[1].trim() : '',
    };
  });
}

function renderGarmentCard(item, category) {
  const imgTag = item.image
    ? `<img class="garment-photo" data-image-path="${item.image}" alt="${item.title}">`
    : '<div class="garment-photo"></div>';
  const showBadges = Settings.get('showWornBadges') === 'yes';
  const wornBadge = showBadges && item.worn > 0
    ? `<span class="garment-worn-badge">worn ${item.worn}×</span>`
    : '';
  return `
    <div class="garment-card" data-category="${category}" data-index="${item.index}">
      ${imgTag}
      ${wornBadge}
      <div class="garment-meta">
        <div class="garment-color">${item.color}</div>
        <div class="garment-style">${item.style}</div>
      </div>
    </div>
  `;
}

// ---------- Detail / edit modal ----------

let detailCurrentCategory = null;
let detailCurrentIndex = null;

function getDetailCheckedStyles() {
  return Array.from(els.detailStyleGroup.querySelectorAll('input[type="checkbox"]:checked')).map(
    (cb) => cb.value
  );
}

function setDetailCheckedStyles(styles) {
  const set = new Set((styles || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  els.detailStyleGroup.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = set.has(cb.value);
  });
}

async function openDetailModal(category, index) {
  const items = closetItemsByCategory[category];
  if (!items || !items[index]) return;
  const item = items[index];

  detailCurrentCategory = category;
  detailCurrentIndex = index;

  els.detailCategory.value = category;
  els.detailColor.value = item.color;
  setDetailCheckedStyles(item.style);
  els.detailSeason.value = item.season;
  els.detailBrand.value = item.brand || '';
  els.detailMaterial.value = item.material || '';
  els.detailSize.value = item.size || '';
  els.detailPurchaseDate.value = item.purchased || '';
  els.detailPrice.value = item.price || '';
  els.detailNotes.value = item.notes || '';
  els.detailAddedDate.textContent = item.added ? `added ${item.added}` : '';

  // Stats row: wear count + computed age from purchase date + cost-per-wear
  const worn = item.worn || 0;
  const ageText = computeAgeText(item.purchased);
  const cpwText = computeCostPerWear(item.price, worn);
  els.detailStatsRow.innerHTML = `
    <div class="detail-stat">
      <div class="detail-stat-value">${worn}</div>
      <div class="detail-stat-label">times worn</div>
    </div>
    <div class="detail-stat">
      <div class="detail-stat-value">${ageText || '—'}</div>
      <div class="detail-stat-label">age</div>
    </div>
    <div class="detail-stat">
      <div class="detail-stat-value">${cpwText || '—'}</div>
      <div class="detail-stat-label">$/wear</div>
    </div>
  `;

  els.detailPhotoPreview.src = '';
  if (item.image) {
    Vault.loadImageURL(item.image).then((url) => {
      if (url) els.detailPhotoPreview.src = url;
    });
  }

  els.detailModal.showModal();
}

// Computes a short readable age from a YYYY-MM-DD purchase date.
// Client-side only, no API cost.
function computeAgeText(purchasedDateStr) {
  if (!purchasedDateStr) return '';
  const purchased = new Date(purchasedDateStr);
  if (isNaN(purchased.getTime())) return '';
  const now = new Date();
  const msDiff = now - purchased;
  const days = Math.floor(msDiff / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}mo`;
  const years = (days / 365.25).toFixed(1);
  return `${years}y`;
}

// Computes cost-per-wear from a price string (e.g. "$45", "45", "$45.99")
// and wear count. Client-side only, no API cost. Returns empty string if
// either field is missing or price can't be parsed.
function computeCostPerWear(priceStr, wornCount) {
  if (!priceStr || !wornCount || wornCount <= 0) return '';
  // Extract a number from the price string, ignoring $ or other currency chars
  const priceNum = parseFloat(String(priceStr).replace(/[^0-9.]/g, ''));
  if (isNaN(priceNum) || priceNum <= 0) return '';
  const cpw = priceNum / wornCount;
  // Format: under $10 shows two decimals, above shows one
  return cpw < 10 ? `$${cpw.toFixed(2)}` : `$${cpw.toFixed(1)}`;
}

els.closeDetailBtn.addEventListener('click', () => {
  els.detailModal.close();
});

els.detailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (detailCurrentCategory === null || detailCurrentIndex === null) return;

  const items = closetItemsByCategory[detailCurrentCategory];
  const item = items[detailCurrentIndex];

  els.saveDetailBtn.disabled = true;
  els.saveDetailBtn.textContent = 'saving…';

  try {
    const color = els.detailColor.value.trim();
    const styles = getDetailCheckedStyles();
    const styleText = styles.join(', ');
    const season = els.detailSeason.value.trim();
    const brand = els.detailBrand.value.trim();
    const material = els.detailMaterial.value.trim();
    const size = els.detailSize.value.trim();
    const purchased = els.detailPurchaseDate.value.trim();
    const price = els.detailPrice.value.trim();
    const notes = els.detailNotes.value.trim();

    const lines = [
      `${color} ${detailCurrentCategory.replace(/s$/, '')}`,
    ];
    if (item.image) lines.push(`![[${item.image}]]`);
    lines.push(`- color: ${color}`);
    lines.push(`- style: ${styleText}`);
    lines.push(`- season: ${season}`);
    if (brand) lines.push(`- brand: ${brand}`);
    if (material) lines.push(`- material: ${material}`);
    if (size) lines.push(`- size: ${size}`);
    if (purchased) lines.push(`- purchased: ${purchased}`);
    if (price) lines.push(`- price: ${price}`);
    if (notes) lines.push(`- notes: ${notes.replace(/\n/g, ' ')}`);
    if (item.added) lines.push(`- added: ${item.added}`);
    if (item.worn && item.worn > 0) lines.push(`- worn: ${item.worn}`);

    const newMarkdown = lines.join('\n');

    await Vault.updateItem(detailCurrentCategory, detailCurrentIndex, newMarkdown);

    els.detailModal.close();
    await renderCloset();
  } catch (err) {
    console.error('Update failed:', err);
    alert('Failed to save changes: ' + err.message);
  } finally {
    els.saveDetailBtn.disabled = false;
    els.saveDetailBtn.textContent = 'save changes';
  }
});

els.deleteItemBtn.addEventListener('click', async () => {
  if (detailCurrentCategory === null || detailCurrentIndex === null) return;
  const confirmed = confirm('Delete this item from your closet? This removes it from the vault file (the photo stays in Drive).');
  if (!confirmed) return;

  els.deleteItemBtn.disabled = true;
  els.deleteItemBtn.textContent = 'deleting…';

  try {
    await Vault.deleteItem(detailCurrentCategory, detailCurrentIndex);
    els.detailModal.close();
    await renderCloset();
  } catch (err) {
    console.error('Delete failed:', err);
    alert('Failed to delete item: ' + err.message);
  } finally {
    els.deleteItemBtn.disabled = false;
    els.deleteItemBtn.textContent = 'delete';
  }
});

let lastSuggestedOutfit = null;

// Finds the closest matching real closet item for an outfit suggestion's
// category + description text, so we can show its actual photo.
function findMatchingClosetItem(category, description) {
  const items = closetItemsByCategory[category];
  if (!items || items.length === 0) return null;

  const descLower = description.toLowerCase();
  // Prefer an item whose title or color appears in the description text
  let match = items.find(
    (item) =>
      (item.title && descLower.includes(item.title.toLowerCase())) ||
      (item.color && descLower.includes(item.color.toLowerCase()))
  );
  if (!match) match = items[0]; // fallback: just show something from that category
  return match;
}

async function renderOutfitPhotos(outfit) {
  const photoHtml = outfit.items
    .map((i) => {
      const match = findMatchingClosetItem(i.category, i.description);
      if (!match || !match.image) return '';
      return `<div class="outfit-photo-item" data-image-path="${match.image}">
        <img class="outfit-photo" data-image-path="${match.image}" alt="${i.description}">
        <div class="outfit-photo-label">${i.category}</div>
      </div>`;
    })
    .join('');
  return photoHtml;
}

els.suggestBtn.addEventListener('click', async () => {
  if (!Vault.isConnected()) {
    alert('Connect your vault first.');
    return;
  }

  const style = els.styleSelect.value;
  const weather = els.weatherInput.value.trim() || 'not specified';

  els.suggestBtn.disabled = true;
  els.suggestBtn.textContent = 'thinking…';
  els.outfitResult.classList.add('hidden');

  try {
    const closetData = await Vault.readAllCategories();
    const recentLogs = await Vault.readRecentOutfitLogs(Settings.get("historyDays"));
    const outfit = await ClaudeAPI.suggestOutfit(closetData, style, weather, recentLogs);
    lastSuggestedOutfit = { outfit, style, weather };

    const displayMode = Settings.get('resultDisplay'); // 'both' | 'photos' | 'text'
    const showPhotos = displayMode === 'both' || displayMode === 'photos';
    const showText = displayMode === 'both' || displayMode === 'text';

    const photoHtml = showPhotos ? await renderOutfitPhotos(outfit) : '';

    els.outfitResult.innerHTML = `
      <div class="rail-title">today's pick</div>
      ${photoHtml ? `<div class="outfit-photo-row">${photoHtml}</div>` : ''}
      ${showText ? '<ul></ul>' : ''}
    `;

    if (showText) {
      const listEl = els.outfitResult.querySelector('ul');
      listEl.innerHTML = outfit.items.map((i) => `<li><strong>${i.category}:</strong> ${i.description}</li>`).join('');
    }
    const reasoningP = document.createElement('p');
    reasoningP.className = 'garment-style';
    reasoningP.textContent = outfit.reasoning;
    els.outfitResult.appendChild(reasoningP);

    const wearBtn = document.createElement('button');
    wearBtn.type = 'button';
    wearBtn.id = 'wearOutfitBtn';
    wearBtn.className = 'btn-tag btn-tag--accent btn-tag--wide';
    wearBtn.style.marginTop = '12px';
    wearBtn.textContent = 'wear this outfit';
    wearBtn.addEventListener('click', confirmWearOutfit);
    els.outfitResult.appendChild(wearBtn);

    els.outfitResult.classList.remove('hidden');

    // Load real photos into the outfit result async
    els.outfitResult.querySelectorAll('.outfit-photo[data-image-path]').forEach((imgEl) => {
      const path = imgEl.getAttribute('data-image-path');
      Vault.loadImageURL(path).then((url) => {
        if (url) imgEl.src = url;
      });
    });
  } catch (err) {
    console.error('Suggestion failed:', err);
    alert('Could not generate an outfit: ' + err.message);
  } finally {
    els.suggestBtn.disabled = false;
    els.suggestBtn.textContent = 'pick an outfit';
  }
});

// Logs the outfit to history and bumps wear counts on each item — only
// called when the user confirms they're actually wearing the suggestion,
// so wear counts reflect real use rather than every generated idea.
async function confirmWearOutfit() {
  if (!lastSuggestedOutfit) return;
  const { outfit, style, weather } = lastSuggestedOutfit;

  const btn = document.getElementById('wearOutfitBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'saving…';
  }

  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    const logEntry = [
      `## ${style} — ${weather}`,
      ...outfit.items.map((i) => `- ${i.category}: ${i.description}`),
      `- reasoning: ${outfit.reasoning}`,
    ].join('\n');
    await Vault.appendOutfitLog(dateStr, logEntry);

    for (const item of outfit.items) {
      await Vault.incrementWorn(item.category, item.description);
    }

    if (btn) {
      btn.textContent = 'logged ✓';
    }
    await renderCloset();
  } catch (err) {
    console.error('Failed to log outfit:', err);
    alert('Could not save this outfit to your log: ' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'wear this outfit';
    }
  }
}

// ---------- Week planner ----------

function getWeekDates() {
  const today = new Date();
  const dayNr = (today.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayNr);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function formatDateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function renderWeekPlanner() {
  if (!Vault.isConnected()) {
    els.weekGrid.innerHTML = '<p class="status-line">connect your vault to plan your week</p>';
    return;
  }

  const dates = getWeekDates();
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const plan = await Vault.readWeekPlan(formatDateStr(dates[0]));

  els.weekGrid.innerHTML = dates
    .map((d, i) => {
      const dateStr = formatDateStr(d);
      const summary = plan[dateStr];
      const hasPlan = !!summary;
      return `
        <div class="week-day-card ${hasPlan ? 'has-plan' : ''}" data-date="${dateStr}">
          <div>
            <div class="week-day-label">${dayLabels[i]}</div>
            <div class="week-day-date">${d.getDate()}</div>
          </div>
          <div class="week-day-summary">${hasPlan ? summary : 'tap to plan'}</div>
        </div>
      `;
    })
    .join('');

  els.weekGrid.querySelectorAll('.week-day-card').forEach((card) => {
    card.addEventListener('click', () => planDay(card.getAttribute('data-date')));
  });
}

let dayPlanCurrentDate = null;

function planDay(dateStr) {
  dayPlanCurrentDate = dateStr;
  els.dayPlanTitle.textContent = `plan ${dateStr}`;
  els.dayPlanStyle.value = 'casual';
  els.dayPlanWeather.value = '';
  els.dayPlanModal.showModal();
}

els.cancelDayPlan.addEventListener('click', () => {
  els.dayPlanModal.close();
  dayPlanCurrentDate = null;
});

els.dayPlanForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!dayPlanCurrentDate) {
    alert('No date selected — please close and tap a day again.');
    return;
  }

  const style = els.dayPlanStyle.value;
  const weather = els.dayPlanWeather.value.trim() || 'not specified';

  els.submitDayPlan.disabled = true;
  els.submitDayPlan.textContent = 'generating…';

  try {
    const closetData = await Vault.readAllCategories();

    let outfit;
    try {
      const recentLogs = await Vault.readRecentOutfitLogs(Settings.get("historyDays"));
      outfit = await ClaudeAPI.suggestOutfit(closetData, style, weather, recentLogs);
    } catch (aiErr) {
      throw new Error('AI suggestion step failed: ' + aiErr.message);
    }

    if (!outfit || !Array.isArray(outfit.items)) {
      throw new Error('AI returned an unexpected format: ' + JSON.stringify(outfit));
    }

    const summary = outfit.items.map((i) => i.description).join(', ');

    try {
      await Vault.saveWeekPlanDay(dayPlanCurrentDate, `${style}: ${summary}`);
    } catch (saveErr) {
      throw new Error('Saving to vault failed: ' + saveErr.message);
    }

    try {
      for (const item of outfit.items) {
        await Vault.incrementWorn(item.category, item.description);
      }
    } catch (wornErr) {
      console.warn('Wear count update failed (non-fatal):', wornErr);
    }

    els.dayPlanModal.close();
    dayPlanCurrentDate = null;
    await renderWeekPlanner();
    await renderCloset();
  } catch (err) {
    console.error('Failed to plan day:', err);
    alert('Could not plan this day:\n\n' + err.message);
  } finally {
    els.submitDayPlan.disabled = false;
    els.submitDayPlan.textContent = 'generate';
  }
});

// ---------- Settings modal ----------

els.settingsBtn.addEventListener('click', () => {
  const current = Settings.load();
  els.settingResultDisplay.value = current.resultDisplay;
  els.settingShowWornBadges.value = current.showWornBadges;
  els.settingHistoryDays.value = String(current.historyDays);
  els.settingModel.value = current.model;
  els.settingImageQuality.value = current.imageQuality;
  els.settingAutoTag.value = current.autoTag;
  els.settingPinnedCategories.value = current.pinnedCategories || '';
  els.settingsModal.showModal();
});

els.cancelSettings.addEventListener('click', () => {
  els.settingsModal.close();
});

els.settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const newSettings = {
    resultDisplay: els.settingResultDisplay.value,
    showWornBadges: els.settingShowWornBadges.value,
    historyDays: parseInt(els.settingHistoryDays.value, 10),
    model: els.settingModel.value,
    imageQuality: els.settingImageQuality.value,
    autoTag: els.settingAutoTag.value,
    pinnedCategories: els.settingPinnedCategories.value.trim(),
  };
  Settings.save(newSettings);
  els.settingsModal.close();

  // Re-render closet so setting changes take effect immediately
  if (Vault.isConnected()) {
    await renderCloset();
  }
});

// ---------- Photo lightbox ----------

function openLightbox(imgSrc, altText) {
  if (!imgSrc) return;
  els.lightboxImage.src = imgSrc;
  els.lightboxImage.alt = altText || '';
  els.lightboxModal.showModal();
}

els.closeLightbox.addEventListener('click', () => {
  els.lightboxModal.close();
  els.lightboxImage.src = '';
});

// Close when tapping backdrop / anywhere outside the image
els.lightboxModal.addEventListener('click', (e) => {
  if (e.target === els.lightboxModal || e.target === els.lightboxImage) {
    els.lightboxModal.close();
    els.lightboxImage.src = '';
  }
});

// Wire the profile modal's photo to open lightbox on tap
els.detailPhotoPreview.style.cursor = 'zoom-in';
els.detailPhotoPreview.addEventListener('click', () => {
  if (els.detailPhotoPreview.src && !els.detailPhotoPreview.src.endsWith('#')) {
    openLightbox(els.detailPhotoPreview.src, els.detailPhotoPreview.alt);
  }
});
