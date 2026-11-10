const { contextBridge, ipcRenderer } = require('electron');

// 共享选择器只暴露本窗口需要的 IPC 能力，避免页面拿到无关的桌面端接口。
contextBridge.exposeInMainWorld('screenSharePicker', {
  getSources(requestId) {
    return ipcRenderer.invoke('screen-share-picker-get-sources', requestId);
  },
  select(requestId, sourceId, shareAudio) {
    ipcRenderer.send('screen-share-picker-select', { requestId, sourceId, shareAudio: Boolean(shareAudio) });
  },
  cancel(requestId) {
    ipcRenderer.send('screen-share-picker-cancel', requestId);
  },
});
