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
