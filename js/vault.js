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

  let vaultFolderId = null;
  let closetFolderId = null;
  let imagesFolderId = null;
  let logFolderId = null;

  const fileIdCache = new Map();

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

  async function connect() {
    try {
      await signIn();

      const savedFolderId = localStorage.getItem(VAULT_FOLDER_ID_KEY);
      if (savedFolderId) {
        vaultFolderId = savedFolderId;
      } else {
        vaultFolderId = await pickVaultFolder();
        localStorage.setItem(VAULT_FOLDER_ID_KEY, vaultFolderId);
      }

      closetFolderId = await findOrCreateFolder(CLOSET_FOLDER_NAME, vaultFolderId);
      imagesFolderId = await findOrCreateFolder(IMAGES_FOLDER_NAME, closetFolderId);
      logFolderId = await findOrCreateFolder(LOG_FOLDER_NAME, closetFolderId);

      return true;
    } catch (err) {
      console.error('Vault connect failed:', err);
      return false;
    }
  }

  async function reselectVaultFolder() {
    localStorage.removeItem(VAULT_FOLDER_ID_KEY);
    fileIdCache.clear();
    return connect();
  }

  function isConnected() {
    return !!accessToken && !!closetFolderId;
  }

  function authHeaders(extra = {}) {
    return { Authorization: `Bearer ${accessToken}`, ...extra };
  }

  async function findOrCreateFolder(name, parentId) {
    const q = encodeURIComponent(
      `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
      { headers: authHeaders() }
    );
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
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
    const createData = await createRes.json();
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
    const data = await res.json();
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
    const data = await res.json();
    return data.id;
  }

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

  async function saveImage(filename, blob) {
    await uploadBlobFile(filename, imagesFolderId, blob);
    return `images/${filename}`;
  }

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

  async function readAllCategories() {
    const categories = await listCategoryFiles();
    const result = {};
    for (const cat of categories) {
      result[cat] = await readCategoryFile(cat);
    }
    return result;
  }

  return {
    connect,
    reselectVaultFolder,
    isConnected,
    listCategoryFiles,
    readCategoryFile,
    writeCategoryFile,
    appendItem,
    saveImage,
    appendOutfitLog,
    readAllCategories,
    loadImageURL,
  };
})();
