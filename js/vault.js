/* vault.js
   Handles connecting to the BAKER vault via the Google Drive API,
   reading/writing the 08-Closet folder: category .md files, images/, outfit-log/
   Works on desktop and mobile (iOS Safari included) since it's all HTTP calls,
   no File System Access API involved.
*/

const Vault = (() => {
  const CLIENT_ID = '886712443087-ak82gqvech24jhbe82n4mcgh8k2mk5n9.apps.googleusercontent.com';
  const API_KEY = 'AIzaSyDLY-4ijnA4YSSrHM3pv1k0m30pWA45f2M';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const CLOSET_FOLDER_NAME = '08-Closet';
  const IMAGES_FOLDER_NAME = 'images';
  const LOG_FOLDER_NAME = 'outfit-log';
  const VAULT_FOLDER_ID_KEY = 'threads_vault_folder_id';

  let accessToken = null;
  let tokenClient = null;
  let pickerLoaded = false;

  let vaultFolderId = null;   // the BAKER vault root folder, chosen once via Picker
  let closetFolderId = null;
  let imagesFolderId = null;
  let logFolderId = null;

  // Simple in-memory cache of file name -> file id within known folders,
  // to avoid repeated search calls.
  const fileIdCache = new Map();

  // ---------- Auth ----------

  function loadGis() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(script);
    });
  }

  function loadPicker() {
    return new Promise((resolve, reject) => {
      if (pickerLoaded) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        gapi.load('picker', () => {
          pickerLoaded = true;
          resolve();
        });
      };
      script.onerror = () => reject(new Error('Failed to load Google Picker'));
      document.head.appendChild(script);
    });
  }

  async function signIn() {
    await loadGis();
    accessToken = await new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) reject(new Error(resp.error));
          else resolve(resp.access_token);
        },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  // Opens the Google Picker so the user selects their real BAKER vault folder.
  // Because THREADS uses the narrow drive.file scope, this is the only way
  // for it to gain access to a folder it didn't create itself.
  async function pickVaultFolder() {
    await loadPicker();
    return new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true);

      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(API_KEY)
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const folder = data.docs[0];
            resolve(folder.id);
          } else if (data.action === google.picker.Action.CANCEL) {
            reject(new Error('Folder selection cancelled'));
          }
        })
        .build();
      picker.setVisible(true);
    });
  }

  async function getFolderName(folderId) {
    try {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=name`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      return data.name || '';
    } catch (err) {
      return '';
    }
  }

  async function connect() {
    try {
      await signIn();

      // Reuse a previously-picked vault folder if we have one saved
      const savedFolderId = localStorage.getItem(VAULT_FOLDER_ID_KEY);
      if (savedFolderId) {
        vaultFolderId = savedFolderId;
      } else {
        vaultFolderId = await pickVaultFolder();
        localStorage.setItem(VAULT_FOLDER_ID_KEY, vaultFolderId);
      }

      // Guard against nesting: if the user picked the 08-Closet folder itself
      // (instead of its parent vault folder), use it directly rather than
      // creating another 08-Closet inside it.
      const pickedName = await getFolderName(vaultFolderId);
      if (pickedName === CLOSET_FOLDER_NAME) {
        closetFolderId = vaultFolderId;
      } else {
        closetFolderId = await findOrCreateFolder(CLOSET_FOLDER_NAME, vaultFolderId);
      }

      imagesFolderId = await findOrCreateFolder(IMAGES_FOLDER_NAME, closetFolderId);
      logFolderId = await findOrCreateFolder(LOG_FOLDER_NAME, closetFolderId);

      return true;
    } catch (err) {
      console.error('Vault connect failed:', err);
      return false;
    }
  }

  // Lets the user pick a different vault folder (forgets the saved one first)
  async function reselectVaultFolder() {
    localStorage.removeItem(VAULT_FOLDER_ID_KEY);
    fileIdCache.clear();
    return connect();
  }

  function isConnected() {
    return !!accessToken && !!closetFolderId;
  }

  function getConnectedFolderId() {
    return closetFolderId;
  }

  function authHeaders(extra = {}) {
    return { Authorization: `Bearer ${accessToken}`, ...extra };
  }

  // ---------- Low-level Drive helpers ----------

  async function findOrCreateFolder(name, parentId) {
    const q = encodeURIComponent(
      `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
      { headers: authHeaders() }
    );

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      throw new Error(`Folder search failed for "${name}": ${searchRes.status} ${errText}`);
    }

    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      if (searchData.files.length > 1) {
        console.warn(
          `Found ${searchData.files.length} folders named "${name}" under the same parent — using the first one. Consider merging/deleting the extras in Drive.`
        );
      }
      return searchData.files[0].id;
    }

    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    };
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(metadata),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Folder creation failed for "${name}": ${createRes.status} ${errText}`);
    }

    const createData = await createRes.json();
    if (!createData.id) {
      throw new Error(`Folder creation for "${name}" returned no id: ` + JSON.stringify(createData));
    }
    return createData.id;
  }

  async function findFileInFolder(name, parentId) {
    const cacheKey = `${parentId}:${name}`;
    if (fileIdCache.has(cacheKey)) return fileIdCache.get(cacheKey);

    const q = encodeURIComponent(`'${parentId}' in parents and name = '${name}' and trashed = false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
      { headers: authHeaders() }
    );
    const data = await res.json();
    const id = data.files && data.files.length > 0 ? data.files[0].id : null;
    if (id) fileIdCache.set(cacheKey, id);
    return id;
  }

  async function listFilesInFolder(parentId, nameFilter) {
    const filterClause = nameFilter ? ` and name contains '${nameFilter}'` : '';
    const q = encodeURIComponent(`'${parentId}' in parents and trashed = false${filterClause}`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000`,
      { headers: authHeaders() }
    );
    const data = await res.json();
    return data.files || [];
  }

  async function downloadFileText(fileId) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return await res.text();
  }

  async function uploadTextFile(name, parentId, content, existingFileId) {
    const boundary = 'threads-boundary-' + Date.now();
    const metadata = existingFileId ? {} : { name, parents: [parentId], mimeType: 'text/markdown' };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/markdown\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;

    const url = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

    const res = await fetch(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: authHeaders({ 'Content-Type': `multipart/related; boundary=${boundary}` }),
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Text file save failed for "${name}": ${res.status} ${errText}`);
    }

    const data = await res.json();
    if (!data.id) {
      throw new Error(`Text file save for "${name}" returned no id: ` + JSON.stringify(data));
    }
    fileIdCache.set(`${parentId}:${name}`, data.id);
    return data.id;
  }

  async function uploadBlobFile(name, parentId, blob) {
    const boundary = 'threads-boundary-' + Date.now();
    const metadata = { name, parents: [parentId], mimeType: blob.type || 'image/jpeg' };
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const preamble =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${blob.type || 'image/jpeg'}\r\n\r\n`;
    const closing = `\r\n--${boundary}--`;

    const bodyParts = [
      new TextEncoder().encode(preamble),
      bytes,
      new TextEncoder().encode(closing),
    ];
    const bodyBlob = new Blob(bodyParts);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': `multipart/related; boundary=${boundary}` }),
        body: bodyBlob,
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Image upload failed: ${res.status} ${errText}`);
    }

    const data = await res.json();
    if (!data.id) {
      throw new Error('Image upload returned no file id: ' + JSON.stringify(data));
    }
    return data.id;
  }

  // ---------- Category files ----------

  async function listCategoryFiles() {
    const files = await listFilesInFolder(closetFolderId);
    return files
      .filter((f) => f.name.endsWith('.md'))
      .map((f) => f.name.replace(/\.md$/, ''));
  }

  async function readCategoryFile(category) {
    const fileId = await findFileInFolder(`${category}.md`, closetFolderId);
    if (!fileId) return null;
    return await downloadFileText(fileId);
  }

  async function writeCategoryFile(category, content) {
    const existingId = await findFileInFolder(`${category}.md`, closetFolderId);
    await uploadTextFile(`${category}.md`, closetFolderId, content, existingId);
  }

  async function appendItem(category, itemMarkdown) {
    let existing = await readCategoryFile(category);
    if (!existing) {
      existing = `# ${category}\n\n`;
    }
    const updated = existing.trimEnd() + '\n\n' + itemMarkdown + '\n';
    await writeCategoryFile(category, updated);
  }

  // Splits a category file's body into { header, items[] } where each item
  // is the raw "### ..." block text (without the leading "### ").
  function splitCategoryContent(content) {
    if (!content) return { header: '', items: [] };
    const firstBlockIdx = content.search(/^### /m);
    if (firstBlockIdx === -1) return { header: content, items: [] };
    const header = content.slice(0, firstBlockIdx);
    const rest = content.slice(firstBlockIdx);
    const items = rest.split(/^### /m).filter(Boolean);
    return { header, items };
  }

  // Replace the item at the given index (0-based, in file order) within a
  // category file with new markdown content (without the "### " prefix).
  async function updateItem(category, itemIndex, newItemMarkdown) {
    const content = await readCategoryFile(category);
    const { header, items } = splitCategoryContent(content);
    if (itemIndex < 0 || itemIndex >= items.length) {
      throw new Error('Item index out of range');
    }
    items[itemIndex] = newItemMarkdown.trim() + '\n';
    const rebuilt = header.trimEnd() + '\n\n' + items.map((b) => '### ' + b.trim()).join('\n\n') + '\n';
    await writeCategoryFile(category, rebuilt);
  }

  // Remove the item at the given index within a category file.
  async function deleteItem(category, itemIndex) {
    const content = await readCategoryFile(category);
    const { header, items } = splitCategoryContent(content);
    if (itemIndex < 0 || itemIndex >= items.length) {
      throw new Error('Item index out of range');
    }
    items.splice(itemIndex, 1);
    const rebuilt = items.length
      ? header.trimEnd() + '\n\n' + items.map((b) => '### ' + b.trim()).join('\n\n') + '\n'
      : header.trimEnd() + '\n';
    await writeCategoryFile(category, rebuilt);
  }

  // Increments the "worn" count on an item, matched by its title line
  // (e.g. "Black Tee") within a category file. Adds a "- worn: 1" line if
  // the item doesn't have one yet. Silently no-ops if the item can't be found,
  // since outfit descriptions from the AI are free text and may not match exactly.
  async function incrementWorn(category, itemTitle) {
    const content = await readCategoryFile(category);
    if (!content) return false;
    const { header, items } = splitCategoryContent(content);

    const idx = items.findIndex((block) => {
      const firstLine = block.split('\n')[0].trim().toLowerCase();
      return firstLine === itemTitle.trim().toLowerCase();
    });
    if (idx === -1) return false;

    const block = items[idx];
    const wornMatch = block.match(/- worn: (\d+)/);
    let updatedBlock;
    if (wornMatch) {
      const newCount = parseInt(wornMatch[1], 10) + 1;
      updatedBlock = block.replace(/- worn: \d+/, `- worn: ${newCount}`);
    } else {
      updatedBlock = block.trim() + `\n- worn: 1`;
    }
    items[idx] = updatedBlock.trim() + '\n';

    const rebuilt = header.trimEnd() + '\n\n' + items.map((b) => '### ' + b.trim()).join('\n\n') + '\n';
    await writeCategoryFile(category, rebuilt);
    return true;
  }

  // ---------- Images ----------

  async function saveImage(filename, blob) {
    await uploadBlobFile(filename, imagesFolderId, blob);
    return `images/${filename}`;
  }

  // Read an image back out of the vault and return a displayable object URL.
  // path is expected in the form "images/filename.jpg"
  async function loadImageURL(path) {
    try {
      const filename = path.replace(/^images\//, '');
      const fileId = await findFileInFolder(filename, imagesFolderId);
      if (!fileId) return null;
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: authHeaders(),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (err) {
      console.warn('Could not load image', path, err);
      return null;
    }
  }

  // ---------- Outfit log ----------

  async function appendOutfitLog(dateStr, entryMarkdown) {
    const filename = `${dateStr}.md`;
    const existingId = await findFileInFolder(filename, logFolderId);
    let existing = '';
    if (existingId) {
      existing = (await downloadFileText(existingId)) || '';
    } else {
      existing = `# Outfit Log — ${dateStr}\n\n`;
    }
    const updated = existing.trimEnd() + '\n\n' + entryMarkdown + '\n';
    await uploadTextFile(filename, logFolderId, updated, existingId);
  }

  // Returns the N most recent outfit log entries (by filename date, descending),
  // as an array of raw markdown strings — used to avoid repeating outfits.
  async function readRecentOutfitLogs(limit = 7) {
    const files = await listFilesInFolder(logFolderId);
    const mdFiles = files
      .filter((f) => f.name.endsWith('.md'))
      .sort((a, b) => (a.name < b.name ? 1 : -1)) // filenames are YYYY-MM-DD.md, so string sort works
      .slice(0, limit);

    const entries = [];
    for (const f of mdFiles) {
      const text = await downloadFileText(f.id);
      if (text) entries.push(text);
    }
    return entries;
  }

  async function readAllCategories() {
    const categories = await listCategoryFiles();
    const result = {};
    for (const cat of categories) {
      result[cat] = await readCategoryFile(cat);
    }
    return result;
  }

  // ---------- Weekly plan ----------
  // Stored as one file per ISO week in outfit-log/, e.g. "week-2026-W29.md",
  // with one line per day: "YYYY-MM-DD: style — weather | item, item, item"

  function getWeekFilename(dateInWeek) {
    const d = new Date(dateInWeek);
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7; // Monday = 0
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const weekNumber =
      1 +
      Math.round(
        ((target - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7
      );
    return `week-${target.getFullYear()}-W${String(weekNumber).padStart(2, '0')}.md`;
  }

  async function readWeekPlan(dateInWeek) {
    const filename = getWeekFilename(dateInWeek);
    const fileId = await findFileInFolder(filename, logFolderId);
    if (!fileId) return {};
    const text = await downloadFileText(fileId);
    if (!text) return {};

    const plan = {};
    const lines = text.split('\n').filter((l) => /^\d{4}-\d{2}-\d{2}:/.test(l));
    for (const line of lines) {
      const [datePart, ...rest] = line.split(':');
      plan[datePart.trim()] = rest.join(':').trim();
    }
    return plan;
  }

  async function saveWeekPlanDay(dateStr, summary) {
    const filename = getWeekFilename(dateStr);
    const existingId = await findFileInFolder(filename, logFolderId);
    let existing = existingId ? (await downloadFileText(existingId)) || '' : `# Week Plan\n\n`;

    const lines = existing.split('\n');
    const otherLines = lines.filter((l) => !l.startsWith(`${dateStr}:`));
    const newLine = `${dateStr}: ${summary}`;
    const updated = [...otherLines, newLine].join('\n').trimEnd() + '\n';

    await uploadTextFile(filename, logFolderId, updated, existingId);
  }

  return {
    connect,
    reselectVaultFolder,
    isConnected,
    getConnectedFolderId,
    listCategoryFiles,
    readCategoryFile,
    writeCategoryFile,
    appendItem,
    updateItem,
    deleteItem,
    incrementWorn,
    saveImage,
    appendOutfitLog,
    readRecentOutfitLogs,
    readAllCategories,
    readWeekPlan,
    saveWeekPlanDay,
    loadImageURL,
  };
})();
