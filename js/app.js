/* app.js — THREADS main controller */

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
    els.vaultStatus.querySelector('.status-line').innerHTML =
      'vault connected — <strong>08-Closet</strong> loaded';
    els.reselectVaultBtn.classList.remove('hidden');
    await renderCloset();
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
    els.vaultStatus.querySelector('.status-line').innerHTML =
      'vault connected — <strong>08-Closet</strong> loaded';
    await renderCloset();
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

let closetItemsByCategory = {};

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

    const photoEls = rail.querySelectorAll('.garment-photo[data-image-path]');
    for (const imgEl of photoEls) {
      const path = imgEl.getAttribute('data-image-path');
      Vault.loadImageURL(path).then((url) => {
        if (url) imgEl.src = url;
      });
    }

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
    return {
      index,
      raw: block,
      title,
      image: imgMatch ? imgMatch[1] : null,
      color: colorMatch ? colorMatch[1].trim() : '',
      style: styleMatch ? styleMatch[1].trim() : '',
      season: seasonMatch ? seasonMatch[1].trim() : '',
      added: addedMatch ? addedMatch[1].trim() : '',
    };
  });
}

function renderGarmentCard(item, category) {
  const imgTag = item.image
    ? `<img class="garment-photo" data-image-path="${item.image}" alt="${item.title}">`
    : '<div class="garment-photo"></div>';
  return `
    <div class="garment-card" data-category="${category}" data-index="${item.index}">
      ${imgTag}
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

// ---------- Outfit suggestion ----------

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
    const outfit = await ClaudeAPI.suggestOutfit(closetData, style, weather, []);

    els.outfitResult.innerHTML = `
      <div class="rail-title">today's pick</div>
      <ul>
        ${outfit.items.map((i) => `<li><strong>${i.category}:</strong> ${i.description}</li>`).join('')}
      </ul>
      <p class="garment-style">${outfit.reasoning}</p>
    `;
    els.outfitResult.classList.remove('hidden');

    const dateStr = new Date().toISOString().slice(0, 10);
    const logEntry = [
      `## ${style} — ${weather}`,
      ...outfit.items.map((i) => `- ${i.category}: ${i.description}`),
      `- reasoning: ${outfit.reasoning}`,
    ].join('\n');
    await Vault.appendOutfitLog(dateStr, logEntry);
  } catch (err) {
    console.error('Suggestion failed:', err);
    alert('Could not generate an outfit: ' + err.message);
  } finally {
    els.suggestBtn.disabled = false;
    els.suggestBtn.textContent = 'pick an outfit';
  }
});
