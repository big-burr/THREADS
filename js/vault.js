/* vault.js
   Handles connecting to the BAKER vault via File System Access API,
   reading/writing the 08-Closet folder: category .md files, images/, outfit-log/
*/

const Vault = (() => {
  let vaultHandle = null;   // handle to the BAKER root vault folder
  let closetHandle = null;  // handle to 08-Closet inside it
  let imagesHandle = null;
  let logHandle = null;

  const CLOSET_FOLDER = '08-Closet';
  const IMAGES_FOLDER = 'images';
  const LOG_FOLDER = 'outfit-log';

  async function connect() {
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support the File System Access API. Try Chrome or Edge on desktop.');
      return false;
    }
    try {
      vaultHandle = await window.showDirectoryPicker();
      closetHandle = await vaultHandle.getDirectoryHandle(CLOSET_FOLDER, { create: true });
      imagesHandle = await closetHandle.getDirectoryHandle(IMAGES_FOLDER, { create: true });
      logHandle = await closetHandle.getDirectoryHandle(LOG_FOLDER, { create: true });
      return true;
    } catch (err) {
      console.error('Vault connect failed or was cancelled:', err);
      return false;
    }
  }

  function isConnected() {
    return !!closetHandle;
  }

  // ---- Category files ----

  async function listCategoryFiles() {
    const files = [];
    for await (const entry of closetHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) {
        files.push(entry.name.replace(/\.md$/, ''));
      }
    }
    return files;
  }

  async function readCategoryFile(category) {
    try {
      const fileHandle = await closetHandle.getFileHandle(`${category}.md`);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (err) {
      return null; // doesn't exist yet
    }
  }

  async function writeCategoryFile(category, content) {
    const fileHandle = await closetHandle.getFileHandle(`${category}.md`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  // Append a new item entry to a category file, creating the file/header if needed
  async function appendItem(category, itemMarkdown) {
    let existing = await readCategoryFile(category);
    if (!existing) {
      existing = `# ${category}\n\n`;
    }
    const updated = existing.trimEnd() + '\n\n' + itemMarkdown + '\n';
    await writeCategoryFile(category, updated);
  }

  // ---- Images ----

  async function saveImage(filename, blob) {
    const fileHandle = await imagesHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return `images/${filename}`;
  }

  // Read an image back out of the vault and return a displayable object URL.
  // path is expected in the form "images/filename.jpg"
  async function loadImageURL(path) {
    try {
      const filename = path.replace(/^images\//, '');
      const fileHandle = await imagesHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      return URL.createObjectURL(file);
    } catch (err) {
      console.warn('Could not load image', path, err);
      return null;
    }
  }

  // ---- Outfit log ----

  async function appendOutfitLog(dateStr, entryMarkdown) {
    const filename = `${dateStr}.md`;
    let existing = '';
    try {
      const fileHandle = await logHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      existing = await file.text();
    } catch (err) {
      existing = `# Outfit Log — ${dateStr}\n\n`;
    }
    const updated = existing.trimEnd() + '\n\n' + entryMarkdown + '\n';
    const fileHandle = await logHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(updated);
    await writable.close();
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
