const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shareFloater', {
  action: action => ipcRenderer.send('screenshare-floater-action', action),
  media: action => ipcRenderer.send('screenshare-floater-media', action),
  showMeeting: () => ipcRenderer.send('screenshare-floater-show-meeting'),
  hover: hovering => ipcRenderer.send('screenshare-floater-hover', Boolean(hovering)),
  getState: () => ipcRenderer.invoke('screenshare-floater-get-state'),
  onState: handler => ipcRenderer.on('screenshare-floater-state', (_event, state) => handler(state)),
});
