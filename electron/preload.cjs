const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('refhub', {
  captureImage: (payload) => ipcRenderer.invoke('capture-image', payload),
  listAssets: (opts) => ipcRenderer.invoke('list-assets', opts),
  countAssets: (opts) => ipcRenderer.invoke('count-assets', opts),
  getAsset: (id) => ipcRenderer.invoke('get-asset', id),
  deleteAsset: (id) => ipcRenderer.invoke('delete-asset', id),
  deleteAssets: (ids) => ipcRenderer.invoke('delete-assets', ids),
  addToBoardMany: (boardId, ids) => ipcRenderer.invoke('add-to-board-many', boardId, ids),
  updateAsset: (id, fields) => ipcRenderer.invoke('update-asset', id, fields),
  listBoards: () => ipcRenderer.invoke('list-boards'),
  createBoard: (name) => ipcRenderer.invoke('create-board', name),
  renameBoard: (id, name) => ipcRenderer.invoke('rename-board', id, name),
  deleteBoard: (id) => ipcRenderer.invoke('delete-board', id),
  boardAssets: (boardId) => ipcRenderer.invoke('board-assets', boardId),
  addToBoard: (boardId, assetId) => ipcRenderer.invoke('add-to-board', boardId, assetId),
  updateBoardItem: (itemId, layout) => ipcRenderer.invoke('update-board-item', itemId, layout),
  duplicateBoardItem: (itemId, dx, dy) => ipcRenderer.invoke('duplicate-board-item', itemId, dx, dy),
  restoreBoardItem: (boardId, assetId, layout) => ipcRenderer.invoke('restore-board-item', boardId, assetId, layout),
  listCategories: () => ipcRenderer.invoke('list-categories'),
  addCategory: (name) => ipcRenderer.invoke('add-category', name),
  addAssetToCategory: (assetId, categoryId) => ipcRenderer.invoke('add-asset-category', assetId, categoryId),
  removeAssetFromCategory: (assetId, categoryId) => ipcRenderer.invoke('remove-asset-category', assetId, categoryId),
  removeAssetsFromCategory: (assetIds, categoryId) => ipcRenderer.invoke('remove-assets-category', assetIds, categoryId),
  toggleAssetPin: (assetId, categoryId) => ipcRenderer.invoke('toggle-asset-pin', assetId, categoryId),
  deleteCategory: (id) => ipcRenderer.invoke('delete-category', id),
  createIdea: () => ipcRenderer.invoke('create-idea'),
  listIdeas: () => ipcRenderer.invoke('list-ideas'),
  getIdea: (id) => ipcRenderer.invoke('get-idea', id),
  updateIdea: (id, fields) => ipcRenderer.invoke('update-idea', id, fields),
  deleteIdea: (id) => ipcRenderer.invoke('delete-idea', id),
  boardWidgets: (boardId) => ipcRenderer.invoke('board-widgets', boardId),
  addBoardWidget: (boardId, w) => ipcRenderer.invoke('add-board-widget', boardId, w),
  updateBoardWidget: (id, fields) => ipcRenderer.invoke('update-board-widget', id, fields),
  deleteBoardWidget: (id) => ipcRenderer.invoke('delete-board-widget', id),
  removeFromBoard: (itemId) => ipcRenderer.invoke('remove-from-board', itemId),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  pasteImage: () => ipcRenderer.invoke('paste-image'),
  importFile: (filePath, opts) => ipcRenderer.invoke('import-file', filePath, opts),
  importImagesDialog: () => ipcRenderer.invoke('import-images-dialog'),
  importUrl: (url, opts) => ipcRenderer.invoke('import-url', url, opts),
  saveBoardPng: (dataUrl, name) => ipcRenderer.invoke('save-board-png', dataUrl, name),
  boardExportDlb: (boardId, name) => ipcRenderer.invoke('board-export-dlb', boardId, name),
  boardImportDlb: () => ipcRenderer.invoke('board-import-dlb'),
  assetUnhide: (id) => ipcRenderer.invoke('asset-unhide', id),
  setLangCfg: (lang) => ipcRenderer.invoke('set-lang', lang),
  copyImageToClipboard: (id) => ipcRenderer.invoke('copy-image-clipboard', id),
  fetchImageBytes: (url) => ipcRenderer.invoke('fetch-image-bytes', url),
  copyImageBuffer: (buf) => ipcRenderer.invoke('copy-image-buffer', buf),
  startDrag: (id) => ipcRenderer.send('asset-start-drag', id),
  getFilePath: (file) => webUtils.getPathForFile(file),
  getPaths: () => ipcRenderer.invoke('get-paths'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  pickLibraryDir: () => ipcRenderer.invoke('pick-library-dir'),
  confirmSetup: (root, personaKey) => ipcRenderer.invoke('confirm-setup', root, personaKey),
  setClipboardWatch: (v) => ipcRenderer.invoke('set-clipboard-watch', v),
  cleanBrokenAssets: () => ipcRenderer.invoke('clean-broken-assets'),
  openBoardFloat: (boardId, name) => ipcRenderer.invoke('open-board-float', boardId, name),
  changeLibraryRoot: () => ipcRenderer.invoke('change-library-root'),
  openLibraryFolder: () => ipcRenderer.invoke('open-library-folder'),
  onLibraryChanged: (cb) => {
    const handler = (_e, root) => cb(root);
    ipcRenderer.on('library-changed', handler);
    return () => ipcRenderer.removeListener('library-changed', handler);
  },
  onCaptureFailed: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('capture-failed', handler);
    return () => ipcRenderer.removeListener('capture-failed', handler);
  },
  onAssetAdded: (cb) => {
    const handler = (_e, asset) => cb(asset);
    ipcRenderer.on('asset-added', handler);
    return () => ipcRenderer.removeListener('asset-added', handler);
  },
});
