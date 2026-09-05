const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("resenhazinhaDesktop", {
  isDesktop: true,
  platform: process.platform,
  listScreenSources: () => ipcRenderer.invoke("resenhazinha:list-screen-sources"),
  selectScreenSource: (sourceId) => ipcRenderer.sendSync("resenhazinha:select-screen-source", sourceId),
  startFilteredAudioCapture: (excludedProcessIds) => (
    ipcRenderer.invoke("resenhazinha:start-filtered-audio", excludedProcessIds)
  ),
  stopFilteredAudioCapture: () => ipcRenderer.invoke("resenhazinha:stop-filtered-audio"),
  onFilteredAudioChunk: (callback) => {
    ipcRenderer.removeAllListeners("resenhazinha:filtered-audio-chunk");
    ipcRenderer.on("resenhazinha:filtered-audio-chunk", (_event, chunk) => callback(chunk));
  },
  clearFilteredAudioChunkListener: () => {
    ipcRenderer.removeAllListeners("resenhazinha:filtered-audio-chunk");
  },
  copyText: (text) => ipcRenderer.invoke("resenhazinha:copy", text),
  loadProfile: () => ipcRenderer.invoke("resenhazinha:load-profile"),
  saveProfileText: (payload) => ipcRenderer.invoke("resenhazinha:save-profile-text", payload),
  loadServerState: () => ipcRenderer.invoke("resenhazinha:load-server-state"),
  saveServerState: (payload) => ipcRenderer.invoke("resenhazinha:save-server-state", payload),
  cacheMemberProfile: (payload) => ipcRenderer.invoke("resenhazinha:cache-member-profile", payload),
  loadMemberProfiles: () => ipcRenderer.invoke("resenhazinha:load-member-profiles"),
  deleteMemberProfile: (clientId) => ipcRenderer.invoke("resenhazinha:delete-member-profile", clientId),
  chooseAvatar: () => ipcRenderer.invoke("resenhazinha:choose-avatar"),
  chooseProfileBanner: () => ipcRenderer.invoke("resenhazinha:choose-profile-banner"),
  chooseAppBackground: () => ipcRenderer.invoke("resenhazinha:choose-app-background"),
  chooseServerIcon: () => ipcRenderer.invoke("resenhazinha:choose-server-icon"),
  saveChatAttachment: (payload) => ipcRenderer.invoke("resenhazinha:save-chat-attachment", payload),
  readChatAttachment: (attachmentId) => ipcRenderer.invoke("resenhazinha:read-chat-attachment", attachmentId),
  deleteChatAttachment: (attachmentId) => ipcRenderer.invoke("resenhazinha:delete-chat-attachment", attachmentId),
  removeAppBackground: () => ipcRenderer.invoke("resenhazinha:remove-app-background"),
  removeProfileBanner: () => ipcRenderer.invoke("resenhazinha:remove-profile-banner"),
  removeAvatar: () => ipcRenderer.invoke("resenhazinha:remove-avatar"),
});
