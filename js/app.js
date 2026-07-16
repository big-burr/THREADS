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
  tagColor: document.getElementById('tagColor'),
  tagStyleGroup: document.getElementById('tagStyleGroup'),
  tagSeason: document.getElementById('tagSeason'),
  cancelAddItem: document.getElementById('cancelAddItem'),
  saveItemBtn: document.getElementById('saveItemBtn'),

  styleSelect: document.getElementById('styleSelect'),
  weatherInput: document.getElementById('weatherInput'),
  suggestBtn: document.getElementById('suggestBtn'),
  outfitResult: document.getElementById('outfitResult'),
  weekGrid: document.getElementById('weekGrid'),

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
  cancelSettings: document.getElementById('cancelSettings'),
  saveSettings: document.getElementById('saveSettings'),

  detailModal: document.getElementById('detailModal'),
  detailForm: document.getElementById('detailForm'),
  detailPhotoPreview: document.getElementById('detailPhotoPreview'),
  detailCategory: document.getElementById('detailCategory'),
  detailColor: document.getElementById('detailColor'),
  detailStyleGroup: document.getElementById('detailStyleGroup'),
  detailSeason: document.getElementById('detailSeason'),
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
  els.tagColor.value = '';
  setCheckedStyles([]);
  els.tagSeason.value = '';
}

els.itemPhotoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  pendingPhotoBlob = file;
  pendingMediaType = file.type;

  const previewUrl = URL.createObjectURL(file);
  els.itemPhotoPreview.src = previewUrl;
  els.itemPhotoPreview.classList.remove('hidden');

  els.tagStatus.classList.remove('hidden');
  els.tagStatus.textContent = 'tagging with AI…';
  els.tagFields.classList.add('hidden');
  els.saveItemBtn.disabled = true;

  try {
    const knownCategories = await Vault.listCategoryFiles();
    const tags = await ClaudeAPI.tagClothingItem(file, file.type, knownCategories);
    pendingTags = tags;

    // Populate category dropdown: known categories + the suggested one
    const catSet = new Set(knownCategories);
    catSet.add(tags.category);
    els.tagCategory.innerHTML = '';
    for (const cat of catSet) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === tags.category) opt.selected = true;
      els.tagCategory.appendChild(opt);
    }

    els.tagColor.value = tags.color || '';
    setCheckedStyles(tags.styles || []);
    els.tagSeason.value = tags.season || '';

    els.tagStatus.classList.add('hidden');
    els.tagFields.classList.remove('hidden');
    els.saveItemBtn.disabled = false;
  } catch (err) {
    console.error('Tagging failed:', err);
    els.tagStatus.textContent = 'AI tagging failed — fill in tags manually below';
    const knownCategories = await Vault.listCategoryFiles();
    els.tagCategory.innerHTML = '';
    for (const cat of knownCategories.length ? knownCategories : ['Misc']) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      els.tagCategory.appendChild(opt);
    }
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

    const ext = (pendingMediaType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const timestamp = Date.now();
    const filename = `${category.toLowerCase()}-${timestamp}.${ext}`;

    const imagePath = await Vault.saveImage(filename, pendingPhotoBlob);

    const dateAdded = new Date().toISOString().slice(0, 10);
    const itemMarkdown = [
      `### ${color} ${category.replace(/s$/, '')}`,
      `![[${imagePath}]]`,
      `- color: ${color}`,
      `- style: ${styleText}`,
      `- season: ${season}`,
      `- added: ${dateAdded}`,
    ].join('\n');

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

async function renderCloset() {
  const categories = await Vault.readAllCategories();
  els.closetRails.innerHTML = '';
  closetItemsByCategory = {};

  const catNames = Object.keys(categories);
  if (catNames.length === 0) {
    els.closetRails.innerHTML = '<p class="status-line">no items yet — add your first piece</p>';
    return;
  }

  for (const cat of catNames) {
    const items = parseCategoryMarkdown(categories[cat]);
    closetItemsByCategory[cat] = items;

    const rail = document.createElement('section');
    rail.className = 'category-rail';
    rail.innerHTML = `
      <div class="rail-title">${cat} <span class="rail-count">${items.length} item${items.length === 1 ? '' : 's'}</span></div>
      <div class="rail-track">
        ${items.map((item) => renderGarmentCard(item, cat)).join('')}
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
}

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
  els.detailAddedDate.textContent = item.added ? `added ${item.added}` : '';

  els.detailPhotoPreview.src = '';
  if (item.image) {
    Vault.loadImageURL(item.image).then((url) => {
      if (url) els.detailPhotoPreview.src = url;
    });
  }

  els.detailModal.showModal();
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

    const newMarkdown = [
      `${color} ${detailCurrentCategory.replace(/s$/, '')}`,
      item.image ? `![[${item.image}]]` : null,
      `- color: ${color}`,
      `- style: ${styleText}`,
      `- season: ${season}`,
      item.added ? `- added: ${item.added}` : null,
    ]
      .filter(Boolean)
      .join('\n');

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
  };
  Settings.save(newSettings);
  els.settingsModal.close();

  // Re-render closet so the wear-badge setting takes effect immediately
  if (Vault.isConnected()) {
    await renderCloset();
  }
});
