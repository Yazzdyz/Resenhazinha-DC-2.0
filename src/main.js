import Peer from "peerjs";
import "./styles.css";

const MAX_MEMBERS = 6;
const MAX_CHAT_HISTORY = 500;
const CHAT_GROUP_WINDOW_MS = 7 * 60 * 1000;
const MAX_CHAT_ATTACHMENTS = 4;
const MAX_CHAT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_CHUNK_BYTES = 192 * 1024;
const PROFILE_MEDIA_CHUNK_BYTES = 160 * 1024;
const SERVER_BINDING_KEY = "resenhazinha:server-binding";
const CLIENT_ID_KEY = "resenhazinha:client-id";
const FALLBACK_SERVER_STATE_KEY = "resenhazinha:persistent-server-state";
const MIC_DEVICE_KEY = "resenhazinha:microphone-device";
const NOISE_SUPPRESSION_KEY = "resenhazinha:noise-suppression";
const FALLBACK_PROFILE_STATE_KEY = "resenhazinha:profile-state";
const DEFAULT_BACKGROUND_BLUR = 8;
const DEFAULT_BACKGROUND_ZOOM = 100;
const DEFAULT_FONT_SCALE = 100;
const DEFAULT_THEME = "dark";
const DEFAULT_PRESENCE = "available";
const UI_SOUND_URLS = {
  message: "https://www.myinstants.com/media/sounds/discord-notification.mp3",
  voiceJoin: "https://www.myinstants.com/media/sounds/yt1s_nYWSz5R.mp3",
  voiceLeave: "https://www.myinstants.com/media/sounds/discord-leave-noise.mp3",
  screenStart: "https://www.myinstants.com/media/sounds/discord-stream-start_7MsfgpB.mp3",
  screenStop: "https://www.myinstants.com/media/sounds/discord-stream-stop.mp3",
  micMute: "https://www.myinstants.com/media/sounds/discord-mute-sound-effect.mp3",
  micUnmute: "https://www.myinstants.com/media/sounds/discord-unmute-sound.mp3",
  deafen: "https://www.myinstants.com/media/sounds/discord-deafen_jvTyxZk.mp3",
  undeafen: "https://www.myinstants.com/media/sounds/discord-undeafen.mp3",
};
const PEER_OPTIONS = {
  host: "0.peerjs.com",
  port: 443,
  path: "/",
  secure: true,
};

const state = {
  peer: null,
  hostConnection: null,
  guestConnections: new Map(),
  pendingGuestProfiles: new Map(),
  hostMembers: new Map(),
  memberRegistry: new Map(),
  revokedClientIds: new Set(),
  incomingProfileMedia: new Map(),
  members: [],
  voiceCalls: new Map(),
  screenCallsOut: new Map(),
  screenCallsIn: new Map(),
  chatMessages: [],
  pendingChatFiles: [],
  chatSending: false,
  incomingChatUploads: new Map(),
  attachmentCache: new Map(),
  attachmentRequests: new Set(),
  attachmentWaiters: new Map(),
  incomingAttachmentDownloads: new Map(),
  editingMessageId: null,
  profilePopoverPeerId: null,
  pendingDeleteMessageId: null,
  localStream: null,
  rawMicrophoneStream: null,
  micAudioContext: null,
  microphoneDeviceId: String(localStorage.getItem(MIC_DEVICE_KEY) || ""),
  noiseSuppressionLevel: normalizeNoiseSuppressionLevel(localStorage.getItem(NOISE_SUPPRESSION_KEY) || "medium"),
  screenStream: null,
  screenSources: [],
  excludedAudioProcessIds: new Set(),
  excludedAudioSourceNames: new Map(),
  filteredAudio: null,
  activeScreen: null, // compatibilidade com clientes 1.6
  activeScreens: new Map(),
  screenStreams: new Map(),
  screenAudioSettings: new Map(),
  screenLayout: "grid",
  focusedScreenPeerId: null,
  avatarData: null,
  bannerData: null,
  profileBio: "",
  appBackgroundData: null,
  appBackgroundBlur: DEFAULT_BACKGROUND_BLUR,
  appBackgroundZoom: DEFAULT_BACKGROUND_ZOOM,
  appFontScale: DEFAULT_FONT_SCALE,
  appTheme: DEFAULT_THEME,
  presenceStatus: DEFAULT_PRESENCE,
  voiceActivityContext: null,
  speakingDetectors: new Map(),
  speakingPeers: new Set(),
  activitySoundInitialized: false,
  lastVoicePeers: new Set(),
  lastScreenPeers: new Set(),
  mentionMatches: [],
  mentionMenuIndex: 0,
  nickname: "",
  clientId: getOrCreateClientId(),
  roomCode: "",
  serverBinding: loadServerBinding(),
  isHost: false,
  muted: false,
  serverMuted: false,
  deafened: false,
  mutedBeforeDeafen: false,
  inVoice: false,
  screenAudioMuted: false,
  screenVolume: 1,
  memberVolumes: new Map(),
  shareQuality: "1080p",
  shareFps: 30,
  currentScreenIsLocal: false,
  currentView: "text",
  unreadMessages: 0,
  roomEntered: false,
  selectedMemberPeerId: null,
  voiceContextPeerId: null,
  lastNonZeroMemberVolumes: new Map(),
  persistenceTimer: null,
  reconnectTimer: null,
  server: createDefaultServer(),
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  personalAppBackgroundMedia: $("#personal-app-background-media"),
  lobbyView: $("#lobby-view"), roomView: $("#room-view"), joinForm: $("#join-form"),
  nicknameInput: $("#nickname-input"), roomInput: $("#room-input"), serverNameInput: $("#server-name-input"),
  roomCodeLabel: $("#room-code-label"), serverNameLabel: $("#server-name-label"), lobbyNote: $("#lobby-note"), savedServerBanner: $("#saved-server-banner"), savedServerName: $("#saved-server-name"),
  randomCodeButton: $("#random-code-button"), createButton: $("#create-room-button"), joinButton: $("#join-room-button"),
  lobbyStatus: $("#lobby-status"), lobbyAvatar: $("#lobby-avatar"), lobbyAvatarButton: $("#lobby-avatar-button"),
  chooseAvatarButton: $("#choose-avatar-button"), removeAvatarButton: $("#remove-avatar-button"),
  serverNameDisplay: $("#server-name-display"), serverIconDisplay: $("#server-icon-display"), serverSettingsButton: $("#server-settings-button"), headerSettingsButton: $("#header-settings-button"),
  textChannelButton: $("#text-channel-button"), voiceChannelButton: $("#voice-channel-button"), textChannelName: $("#text-channel-name"), voiceChannelName: $("#voice-channel-name"),
  textChannelEmpty: $("#text-channel-empty"), voiceChannelEmpty: $("#voice-channel-empty"), createTextChannelButton: $("#create-text-channel-button"), createVoiceChannelButton: $("#create-voice-channel-button"),
  voiceMiniList: $("#voice-mini-list"), textView: $("#text-view"), voiceView: $("#voice-view"),
  contentChannelIcon: $("#content-channel-icon"), contentChannelKind: $("#content-channel-kind"), contentChannelTitle: $("#content-channel-title"),
  memberList: $("#member-list"), memberCount: $("#member-count"), onlineCount: $("#online-count"),
  selfAvatar: $("#self-avatar"), selfAvatarButton: $("#self-avatar-button"), selfName: $("#self-name"), selfState: $("#self-state"), userSettingsButton: $("#user-settings-button"),
  connectionPill: $("#connection-pill"), roomCodeDisplay: $("#room-code-display"), copyCodeButton: $("#copy-code-button"),
  stageEmpty: $("#stage-empty"), screenVideo: $("#screen-video"), screenBadge: $("#screen-badge"), screenOwner: $("#screen-owner"),
  screenAudioButton: $("#screen-audio-button"), screenAudioLabel: $("#screen-audio-label"), screenVolumeControl: $("#screen-volume-control"), screenVolumeRange: $("#screen-volume-range"), screenVolumeValue: $("#screen-volume-value"), screenQualityLabel: $("#screen-quality-label"), callHint: $("#call-hint"),
  screenGallery: $("#screen-gallery"), screenGrid: $("#screen-grid"), screenSwitcher: $("#screen-switcher"), screenGridButton: $("#screen-grid-button"),
  micButton: $("#mic-button"), deafenButton: $("#deafen-button"), shareButton: $("#share-button"),
  voiceJoinButton: $("#voice-join-button"), voiceLeaveButton: $("#voice-leave-button"), leaveButton: $("#leave-button"),
  audioContainer: $("#audio-container"), toastRegion: $("#toast-region"),
  sourceDialog: $("#source-dialog"), sourceGrid: $("#source-grid"), closeDialogButton: $("#close-dialog-button"),
  shareAudioCheckbox: $("#share-audio-checkbox"), audioExclusionStatus: $("#audio-exclusion-status"), shareQualitySelect: $("#share-quality-select"), shareFpsSelect: $("#share-fps-select"), shareQualityHint: $("#share-quality-hint"),
  chatToggleButton: $("#chat-toggle-button"), chatUnreadBadge: $("#chat-unread-badge"), chatMessages: $("#chat-messages"), chatEmpty: $("#chat-empty"),
  chatForm: $("#chat-form"), chatInput: $("#chat-input"), sendChatButton: $("#send-chat-button"), mentionMenu: $("#mention-menu"),
  chatPendingFiles: $("#chat-pending-files"), chatAttachmentButton: $("#chat-attachment-button"), chatFileInput: $("#chat-file-input"),
  serverDialog: $("#server-dialog"), closeServerDialogButton: $("#close-server-dialog-button"), serverNameSettings: $("#server-name-settings"), saveServerNameButton: $("#save-server-name-button"), serverIconPreview: $("#server-icon-preview"), chooseServerIconButton: $("#choose-server-icon-button"), removeServerIconButton: $("#remove-server-icon-button"),
  textChannelSettingRow: $("#text-channel-setting-row"), textChannelSettings: $("#text-channel-settings"), saveTextChannelButton: $("#save-text-channel-button"), deleteTextChannelButton: $("#delete-text-channel-button"), createTextChannelSettingsButton: $("#create-text-channel-settings-button"),
  voiceChannelSettingRow: $("#voice-channel-setting-row"), voiceChannelSettings: $("#voice-channel-settings"), saveVoiceChannelButton: $("#save-voice-channel-button"), deleteVoiceChannelButton: $("#delete-voice-channel-button"), createVoiceChannelSettingsButton: $("#create-voice-channel-settings-button"),
  roleList: $("#role-list"), roleNameInput: $("#role-name-input"), roleColorInput: $("#role-color-input"), roleAdminInput: $("#role-admin-input"), createRoleButton: $("#create-role-button"),
  userDialog: $("#user-dialog"), closeUserDialogButton: $("#close-user-dialog-button"), userBannerPreview: $("#user-banner-preview"), userChooseBannerButton: $("#user-choose-banner-button"), userRemoveBannerButton: $("#user-remove-banner-button"), userAvatarPreview: $("#user-avatar-preview"), userChooseAvatarButton: $("#user-choose-avatar-button"), userRemoveAvatarButton: $("#user-remove-avatar-button"), userNameSettings: $("#user-name-settings"), userBioSettings: $("#user-bio-settings"), presenceChoiceButtons: [...document.querySelectorAll("[data-presence-choice]")], themeChoiceButtons: [...document.querySelectorAll("[data-theme-choice]")], appBackgroundPreview: $("#app-background-preview"), chooseAppBackgroundButton: $("#choose-app-background-button"), removeAppBackgroundButton: $("#remove-app-background-button"), appBackgroundBlurRange: $("#app-background-blur-range"), appBackgroundBlurValue: $("#app-background-blur-value"), appBackgroundZoomRange: $("#app-background-zoom-range"), appBackgroundZoomValue: $("#app-background-zoom-value"), appFontScaleRange: $("#app-font-scale-range"), appFontScaleValue: $("#app-font-scale-value"), fontSizePreview: $("#font-size-preview"), microphoneDeviceSelect: $("#microphone-device-select"), refreshMicrophonesButton: $("#refresh-microphones-button"), noiseSuppressionSelect: $("#noise-suppression-select"), noiseLevelNote: $("#noise-level-note"), saveUserSettingsButton: $("#save-user-settings-button"),
  memberDialog: $("#member-dialog"), closeMemberDialogButton: $("#close-member-dialog-button"), memberDialogAvatar: $("#member-dialog-avatar"), memberDialogName: $("#member-dialog-name"),
  memberAudioSection: $("#member-audio-section"), memberVolumeRange: $("#member-volume-range"), memberVolumeValue: $("#member-volume-value"), memberModerationSection: $("#member-moderation-section"), memberRolesSection: $("#member-roles-section"),
  serverMuteMemberButton: $("#server-mute-member-button"), disconnectMemberButton: $("#disconnect-member-button"), kickMemberButton: $("#kick-member-button"), memberRoleOptions: $("#member-role-options"),
  voiceContextMenu: $("#voice-context-menu"), voiceContextProfileButton: $("#voice-context-profile-button"), voiceContextMentionButton: $("#voice-context-mention-button"), voiceContextVolumeSection: $("#voice-context-volume-section"), voiceContextVolumeRange: $("#voice-context-volume-range"), voiceContextVolumeValue: $("#voice-context-volume-value"), voiceContextLocalMuteButton: $("#voice-context-local-mute-button"), voiceContextAdminSection: $("#voice-context-admin-section"), voiceContextRolesButton: $("#voice-context-roles-button"), voiceContextServerMuteButton: $("#voice-context-server-mute-button"), voiceContextDisconnectButton: $("#voice-context-disconnect-button"), voiceContextKickButton: $("#voice-context-kick-button"),
  profilePopover: $("#member-profile-popover"), profileBanner: $("#member-profile-banner"), profileAvatar: $("#member-profile-avatar"), profileClose: $("#member-profile-close"), profileName: $("#member-profile-name"), profileOwner: $("#member-profile-owner"), profileStatus: $("#member-profile-status"), profileRoles: $("#member-profile-roles"), profileBioSection: $("#member-profile-bio-section"), profileBioText: $("#member-profile-bio-text"), profileActions: $("#member-profile-actions"), presencePopover: $("#presence-popover"),
  deleteMessageDialog: $("#delete-message-dialog"), closeDeleteMessageDialogButton: $("#close-delete-message-dialog-button"), deleteMessagePreviewAvatar: $("#delete-message-preview-avatar"), deleteMessagePreviewName: $("#delete-message-preview-name"), deleteMessagePreviewTime: $("#delete-message-preview-time"), deleteMessagePreviewText: $("#delete-message-preview-text"), deleteMessagePreviewAttachments: $("#delete-message-preview-attachments"), cancelDeleteMessageButton: $("#cancel-delete-message-button"), confirmDeleteMessageButton: $("#confirm-delete-message-button"),
};

const savedName = localStorage.getItem("resenhazinha:nickname") || localStorage.getItem("tropa:nickname");
if (savedName) elements.nicknameInput.value = savedName;
if (state.serverBinding) elements.roomInput.value = state.serverBinding.roomCode;
else elements.roomInput.value = generateRoomCode();
const profileReady = loadStoredProfile();
applySavedServerLobby();
const kickedNotice = sessionStorage.getItem("resenhazinha:kicked-notice");
if (kickedNotice) {
  sessionStorage.removeItem("resenhazinha:kicked-notice");
  window.setTimeout(() => setLobbyStatus(kickedNotice, "error"), 0);
}

profileReady.then(() => {
  if (state.serverBinding && cleanNickname(elements.nicknameInput.value)) {
    window.setTimeout(() => enterRoom(state.serverBinding.isOwner ? "resume-host" : "resume-join"), 120);
  }
});

elements.nicknameInput.addEventListener("input", renderLocalAvatars);
elements.roomInput.addEventListener("input", () => { elements.roomInput.value = normalizeRoomCode(elements.roomInput.value); });
elements.randomCodeButton.addEventListener("click", () => { elements.roomInput.value = generateRoomCode(); });
elements.createButton.addEventListener("click", () => enterRoom("create"));
elements.lobbyAvatarButton.addEventListener("click", chooseAvatar);
elements.chooseAvatarButton.addEventListener("click", chooseAvatar);
elements.removeAvatarButton.addEventListener("click", removeAvatar);
elements.selfAvatarButton.addEventListener("click", (event) => openMemberProfile(state.peer?.id, event.currentTarget));
elements.joinForm.addEventListener("submit", (event) => { event.preventDefault(); enterRoom("join"); });
elements.copyCodeButton.addEventListener("click", copyRoomCode);
elements.micButton.addEventListener("click", toggleMute);
elements.deafenButton.addEventListener("click", toggleDeafen);
elements.shareButton.addEventListener("click", handleShareButton);
elements.voiceJoinButton.addEventListener("click", joinVoiceChannel);
elements.voiceLeaveButton.addEventListener("click", leaveVoiceChannel);
elements.screenGridButton.addEventListener("click", () => setScreenLayout("grid"));
elements.leaveButton.addEventListener("click", leaveVoiceChannel);
elements.chatToggleButton.addEventListener("click", () => switchView("text"));
elements.textChannelButton.addEventListener("click", () => switchView("text"));
elements.voiceChannelButton.addEventListener("click", () => switchView("voice"));
elements.serverSettingsButton.addEventListener("click", openServerSettings);
elements.headerSettingsButton.addEventListener("click", openServerSettings);
elements.userSettingsButton.addEventListener("click", openUserSettings);
elements.createTextChannelButton.addEventListener("click", () => requestAdminAction("channel-create", { kind: "text" }));
elements.createVoiceChannelButton.addEventListener("click", () => requestAdminAction("channel-create", { kind: "voice" }));
elements.closeServerDialogButton.addEventListener("click", () => elements.serverDialog.close());
elements.closeUserDialogButton.addEventListener("click", () => elements.userDialog.close());
elements.closeMemberDialogButton.addEventListener("click", () => elements.memberDialog.close());
elements.serverDialog.addEventListener("click", (event) => { if (event.target === elements.serverDialog) elements.serverDialog.close(); });
elements.userDialog.addEventListener("click", (event) => { if (event.target === elements.userDialog) elements.userDialog.close(); });
elements.memberDialog.addEventListener("click", (event) => { if (event.target === elements.memberDialog) elements.memberDialog.close(); });
elements.deleteMessageDialog.addEventListener("click", (event) => { if (event.target === elements.deleteMessageDialog) closeDeleteMessageDialog(); });
elements.saveServerNameButton.addEventListener("click", () => requestAdminAction("server-name", { name: elements.serverNameSettings.value }));
elements.chooseServerIconButton.addEventListener("click", chooseServerIcon);
elements.removeServerIconButton.addEventListener("click", () => requestAdminAction("server-icon", { icon: null }));
elements.userChooseBannerButton.addEventListener("click", async () => { await chooseProfileBanner(); renderUserSettings(); });
elements.userRemoveBannerButton.addEventListener("click", async () => { await removeProfileBanner(); renderUserSettings(); });
elements.chooseAppBackgroundButton.addEventListener("click", async () => { await chooseAppBackground(); renderUserSettings(); });
elements.removeAppBackgroundButton.addEventListener("click", async () => { await removeAppBackground(); renderUserSettings(); });
elements.appBackgroundBlurRange.addEventListener("input", () => { state.appBackgroundBlur = normalizeBackgroundBlur(elements.appBackgroundBlurRange.value); applyAppBackground(); renderBackgroundBlurValue(); });
elements.appBackgroundZoomRange.addEventListener("input", () => { state.appBackgroundZoom = normalizeBackgroundZoom(elements.appBackgroundZoomRange.value); applyAppBackground(); renderAppBackgroundPreview(); renderAppearanceValues(); });
elements.appFontScaleRange.addEventListener("input", () => { state.appFontScale = normalizeFontScale(elements.appFontScaleRange.value); applyFontScale(); renderAppearanceValues(); });
elements.themeChoiceButtons.forEach((button) => button.addEventListener("click", () => { state.appTheme = normalizeTheme(button.dataset.themeChoice); applyUiTheme(); renderThemeChoices(); }));
elements.presenceChoiceButtons.forEach((button) => button.addEventListener("click", () => { void setPresenceStatus(button.dataset.presenceChoice); }));
elements.userChooseAvatarButton.addEventListener("click", async () => { await chooseAvatar(); renderUserSettings(); });
elements.userRemoveAvatarButton.addEventListener("click", async () => { await removeAvatar(); renderUserSettings(); });
elements.refreshMicrophonesButton.addEventListener("click", () => refreshMicrophoneDevices(true));
elements.noiseSuppressionSelect.addEventListener("change", renderNoiseSuppressionNote);
elements.saveUserSettingsButton.addEventListener("click", saveUserSettings);
elements.saveTextChannelButton.addEventListener("click", () => requestAdminAction("channel-rename", { kind: "text", name: elements.textChannelSettings.value }));
elements.saveVoiceChannelButton.addEventListener("click", () => requestAdminAction("channel-rename", { kind: "voice", name: elements.voiceChannelSettings.value }));
elements.deleteTextChannelButton.addEventListener("click", () => requestAdminAction("channel-delete", { kind: "text" }));
elements.deleteVoiceChannelButton.addEventListener("click", () => requestAdminAction("channel-delete", { kind: "voice" }));
elements.createTextChannelSettingsButton.addEventListener("click", () => requestAdminAction("channel-create", { kind: "text" }));
elements.createVoiceChannelSettingsButton.addEventListener("click", () => requestAdminAction("channel-create", { kind: "voice" }));
elements.createRoleButton.addEventListener("click", createRoleFromSettings);
elements.serverMuteMemberButton.addEventListener("click", toggleSelectedMemberServerMute);
elements.disconnectMemberButton.addEventListener("click", disconnectSelectedMemberFromVoice);
elements.kickMemberButton.addEventListener("click", kickSelectedMemberFromServer);
elements.chatForm.addEventListener("submit", (event) => { event.preventDefault(); void sendChatMessage(); });
elements.chatInput.addEventListener("keydown", handleChatInputKeydown);
elements.chatAttachmentButton.addEventListener("click", () => elements.chatFileInput.click());
elements.chatFileInput.addEventListener("change", () => setPendingChatFiles([...elements.chatFileInput.files]));
elements.chatInput.addEventListener("input", () => { resizeChatInput(); updateMentionMenu(); });
elements.chatInput.addEventListener("click", updateMentionMenu);
elements.chatInput.addEventListener("keyup", (event) => { if (!["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) updateMentionMenu(); });
elements.chatInput.addEventListener("blur", () => window.setTimeout(closeMentionMenu, 130));
elements.closeDialogButton.addEventListener("click", () => elements.sourceDialog.close());
elements.sourceDialog.addEventListener("click", (event) => { if (event.target === elements.sourceDialog) elements.sourceDialog.close(); });
elements.shareAudioCheckbox.addEventListener("change", updateAudioExclusionStatus);
elements.shareQualitySelect.addEventListener("change", () => { state.shareQuality = elements.shareQualitySelect.value; updateShareQualityHint(); });
elements.shareFpsSelect.addEventListener("change", () => { state.shareFps = Number(elements.shareFpsSelect.value) || 30; updateShareQualityHint(); });
elements.memberVolumeRange.addEventListener("input", () => { if (state.selectedMemberPeerId) setMemberVolume(state.selectedMemberPeerId, Number(elements.memberVolumeRange.value) / 100); });
elements.voiceContextVolumeRange.addEventListener("input", () => {
  if (!state.voiceContextPeerId) return;
  setMemberVolume(state.voiceContextPeerId, Number(elements.voiceContextVolumeRange.value) / 100);
  renderVoiceContextMenu();
});
elements.voiceContextProfileButton.addEventListener("click", openVoiceContextProfile);
elements.voiceContextMentionButton.addEventListener("click", mentionVoiceContextMember);
elements.voiceContextLocalMuteButton.addEventListener("click", toggleVoiceContextLocalMute);
elements.voiceContextRolesButton.addEventListener("click", openVoiceContextRoles);
elements.voiceContextServerMuteButton.addEventListener("click", toggleVoiceContextServerMute);
elements.voiceContextDisconnectButton.addEventListener("click", disconnectVoiceContextMember);
elements.voiceContextKickButton.addEventListener("click", kickVoiceContextMember);
elements.profileClose.addEventListener("click", closeMemberProfile);
elements.closeDeleteMessageDialogButton.addEventListener("click", closeDeleteMessageDialog);
elements.cancelDeleteMessageButton.addEventListener("click", closeDeleteMessageDialog);
elements.confirmDeleteMessageButton.addEventListener("click", confirmDeleteMessage);
elements.selfName.closest(".sidebar-user-copy")?.setAttribute("role", "button");
elements.selfName.closest(".sidebar-user-copy")?.setAttribute("tabindex", "0");
elements.selfName.closest(".sidebar-user-copy")?.setAttribute("data-profile-peer", "self");
elements.selfName.closest(".sidebar-user-copy")?.addEventListener("click", (event) => openMemberProfile(state.peer?.id, event.currentTarget));
elements.selfName.closest(".sidebar-user-copy")?.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") openMemberProfile(state.peer?.id, event.currentTarget); });
document.addEventListener("pointerdown", (event) => {
  const insideProfile = elements.profilePopover?.contains(event.target);
  const insidePresence = elements.presencePopover?.contains(event.target);
  const insideVoiceContext = elements.voiceContextMenu?.contains(event.target);
  const profileTrigger = event.target.closest?.("[data-profile-peer]");
  if (!elements.voiceContextMenu.hidden && !insideVoiceContext) closeVoiceContextMenu();
  if (!elements.presencePopover.hidden && !insidePresence && !insideProfile) closePresencePopover();
  if (!elements.profilePopover.hidden && !insideProfile && !insidePresence && !profileTrigger) closeMemberProfile();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.deleteMessageDialog.open) { closeDeleteMessageDialog(); return; }
  if (event.key === "Escape" && !elements.voiceContextMenu.hidden) { closeVoiceContextMenu(); return; }
  if (event.key === "Escape" && !elements.presencePopover.hidden) { closePresencePopover(); return; }
  if (event.key === "Escape" && !elements.profilePopover.hidden) closeMemberProfile();
});
window.addEventListener("resize", () => { closeVoiceContextMenu(); closePresencePopover(); closeMemberProfile(); });
document.addEventListener("scroll", () => closeVoiceContextMenu(), true);
window.addEventListener("beforeunload", () => { revokeAppBackgroundSource(state.appBackgroundData); teardownConnections(); });

function normalizeNoiseSuppressionLevel(value) {
  return ["off", "light", "medium", "high"].includes(String(value)) ? String(value) : "medium";
}

function playUiSound(kind, volume = 0.45) {
  const source = UI_SOUND_URLS[kind];
  if (!source) return;
  try {
    const audio = new Audio(source);
    audio.preload = "auto";
    audio.volume = clampVolume(volume);
    audio.play().catch(() => undefined);
  } catch (_error) {
    // Sons são um detalhe visual/sonoro e nunca podem derrubar a call.
  }
}

function ensureVoiceActivityContext() {
  if (!window.AudioContext) return null;
  if (!state.voiceActivityContext || state.voiceActivityContext.state === "closed") {
    state.voiceActivityContext = new AudioContext({ latencyHint: "interactive" });
  }
  state.voiceActivityContext.resume?.().catch?.(() => undefined);
  return state.voiceActivityContext;
}

function applySpeakingStateToDom() {
  document.querySelectorAll("[data-speaking-peer]").forEach((element) => {
    const peerId = element.dataset.speakingPeer || "";
    element.classList.toggle("is-speaking", state.speakingPeers.has(peerId));
  });
}

function setPeerSpeaking(peerId, speaking) {
  const id = String(peerId || "");
  if (!id) return;
  const currentlySpeaking = state.speakingPeers.has(id);
  if (speaking === currentlySpeaking) return;
  if (speaking) state.speakingPeers.add(id);
  else state.speakingPeers.delete(id);
  document.querySelectorAll(`[data-speaking-peer="${CSS.escape(id)}"]`).forEach((element) => {
    element.classList.toggle("is-speaking", speaking);
  });
}

function stopSpeakingDetector(peerId) {
  const id = String(peerId || "");
  const detector = state.speakingDetectors.get(id);
  if (detector) {
    detector.stopped = true;
    if (detector.frame) cancelAnimationFrame(detector.frame);
    try { detector.source?.disconnect?.(); } catch (_error) {}
    try { detector.analyser?.disconnect?.(); } catch (_error) {}
    state.speakingDetectors.delete(id);
  }
  setPeerSpeaking(id, false);
}

function stopAllSpeakingDetectors() {
  [...state.speakingDetectors.keys()].forEach(stopSpeakingDetector);
  state.speakingPeers.clear();
  state.voiceActivityContext?.close?.().catch?.(() => undefined);
  state.voiceActivityContext = null;
}

function startSpeakingDetector(peerId, stream) {
  const id = String(peerId || "");
  if (!id || !stream?.getAudioTracks?.().some((track) => track.readyState === "live")) return;
  stopSpeakingDetector(id);
  const context = ensureVoiceActivityContext();
  if (!context) return;
  try {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.58;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const detector = { source, analyser, samples, frame: 0, stopped: false, lastVoiceAt: 0, speaking: false };
    state.speakingDetectors.set(id, detector);

    const tick = () => {
      if (detector.stopped || state.speakingDetectors.get(id) !== detector) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const normalized = (samples[index] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      const member = state.members.find((item) => item.peerId === id);
      const isSelf = id === state.peer?.id;
      const canSpeak = isSelf
        ? state.inVoice && !state.muted && !state.serverMuted
        : Boolean(member?.inVoice && !member.muted && !member.serverMuted);
      const now = performance.now();
      if (canSpeak && rms >= 0.024) {
        detector.lastVoiceAt = now;
        if (!detector.speaking) {
          detector.speaking = true;
          setPeerSpeaking(id, true);
        }
      } else if (detector.speaking && (!canSpeak || now - detector.lastVoiceAt > 220)) {
        detector.speaking = false;
        setPeerSpeaking(id, false);
      }
      detector.frame = requestAnimationFrame(tick);
    };
    detector.frame = requestAnimationFrame(tick);
  } catch (_error) {
    stopSpeakingDetector(id);
  }
}

function syncActivitySoundState() {
  if (!state.roomEntered || (!state.isHost && state.members.length === 0)) return;
  const selfId = state.peer?.id || "";
  const currentVoicePeers = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  const currentScreenPeers = new Set(state.activeScreens.keys());

  if (!state.activitySoundInitialized) {
    state.lastVoicePeers = currentVoicePeers;
    state.lastScreenPeers = currentScreenPeers;
    state.activitySoundInitialized = true;
    return;
  }

  if (state.inVoice) {
    currentVoicePeers.forEach((peerId) => {
      if (peerId !== selfId && !state.lastVoicePeers.has(peerId)) playUiSound("voiceJoin", 0.55);
    });
    state.lastVoicePeers.forEach((peerId) => {
      if (peerId !== selfId && !currentVoicePeers.has(peerId)) playUiSound("voiceLeave", 0.55);
    });
    currentScreenPeers.forEach((peerId) => {
      if (peerId !== selfId && !state.lastScreenPeers.has(peerId)) playUiSound("screenStart", 0.52);
    });
    state.lastScreenPeers.forEach((peerId) => {
      if (peerId !== selfId && !currentScreenPeers.has(peerId)) playUiSound("screenStop", 0.52);
    });
  }

  state.lastVoicePeers = currentVoicePeers;
  state.lastScreenPeers = currentScreenPeers;
}

function cleanBio(value) {
  return String(value || "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, 190);
}

function sanitizeProfileBanner(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 9_500_000) return null;
  return /^data:image\/(?:gif|png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
}

function sanitizeAppBackground(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  if (/^blob:/i.test(value)) return value;
  if (value.length > 48_000_000) return null;
  return /^data:image\/(?:gif|png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
}

function revokeAppBackgroundSource(value) {
  if (typeof value === "string" && value.startsWith("blob:")) {
    try { URL.revokeObjectURL(value); } catch (_error) { /* já pode ter sido revogado */ }
  }
}

function appBackgroundSourceFromPayload(payload) {
  if (!payload) return null;
  if (typeof payload === "string") return sanitizeAppBackground(payload);
  const mimeType = String(payload.mimeType || "").toLowerCase();
  if (!/^image\/(?:gif|png|jpeg|webp)$/.test(mimeType)) return null;
  const bytes = toUint8Array(payload.bytes);
  if (!bytes || bytes.byteLength <= 0 || bytes.byteLength > 40 * 1024 * 1024) return null;
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

function setAppBackgroundSource(payload) {
  const next = appBackgroundSourceFromPayload(payload);
  const previous = state.appBackgroundData;
  state.appBackgroundData = next;
  if (previous && previous !== next) revokeAppBackgroundSource(previous);
  return next;
}

function normalizeBackgroundBlur(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKGROUND_BLUR;
  return Math.max(0, Math.min(30, Math.round(parsed)));
}

function normalizeBackgroundZoom(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKGROUND_ZOOM;
  return Math.max(85, Math.min(160, Math.round(parsed / 5) * 5));
}

function normalizeFontScale(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FONT_SCALE;
  return Math.max(85, Math.min(130, Math.round(parsed / 5) * 5));
}

function normalizeTheme(value) {
  const theme = String(value || "");
  return ["light", "dark", "ultra-dark"].includes(theme) ? theme : DEFAULT_THEME;
}

function normalizePresence(value) {
  const presence = String(value || "");
  return ["available", "away", "dnd", "offline"].includes(presence) ? presence : DEFAULT_PRESENCE;
}

function presenceLabel(value) {
  const labels = { available: "Disponível", away: "Ausente", dnd: "Não perturbe", offline: "Offline" };
  return labels[normalizePresence(value)] || labels.available;
}

function presencePriority(value) {
  return { available: 0, away: 1, dnd: 2, offline: 3 }[normalizePresence(value)] ?? 0;
}

function applyUiTheme() {
  document.body.dataset.theme = normalizeTheme(state.appTheme);
  document.documentElement.dataset.theme = normalizeTheme(state.appTheme);
}

function applyFontScale() {
  const scale = normalizeFontScale(state.appFontScale) / 100;
  const sizes = {
    tiny: 8,
    small: 10,
    compact: 11,
    normal: 12,
    body: 13,
    medium: 14,
    large: 16,
    title: 19,
  };
  Object.entries(sizes).forEach(([name, base]) => {
    document.documentElement.style.setProperty(`--ui-font-${name}`, `${Math.round(base * scale * 10) / 10}px`);
  });
}

function renderThemeChoices() {
  const active = normalizeTheme(state.appTheme);
  elements.themeChoiceButtons.forEach((button) => {
    const selected = button.dataset.themeChoice === active;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function renderPresenceChoices() {
  const active = normalizePresence(state.presenceStatus);
  elements.presenceChoiceButtons.forEach((button) => {
    const selected = normalizePresence(button.dataset.presenceChoice) === active;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

async function setPresenceStatus(value) {
  const next = normalizePresence(value);
  if (state.presenceStatus === next) { renderPresenceChoices(); closePresencePopover(); return; }
  state.presenceStatus = next;
  renderPresenceChoices();
  closePresencePopover();
  await persistProfileTextState();
  publishProfile();
  renderMembers();
  updateControlState();
  if (state.profilePopoverPeerId === state.peer?.id) renderMemberProfilePopover(currentSelfMember() || localMember());
}

function renderAppearanceValues() {
  if (elements.appBackgroundZoomValue) elements.appBackgroundZoomValue.textContent = `${normalizeBackgroundZoom(state.appBackgroundZoom)}%`;
  if (elements.appFontScaleValue) elements.appFontScaleValue.textContent = `${normalizeFontScale(state.appFontScale)}%`;
}

function renderBackgroundBlurValue() {
  if (!elements.appBackgroundBlurValue) return;
  elements.appBackgroundBlurValue.textContent = `${normalizeBackgroundBlur(state.appBackgroundBlur)} px`;
}

function applyAppBackground() {
  const safeBackground = sanitizeAppBackground(state.appBackgroundData);
  document.body.classList.toggle("has-custom-background", Boolean(safeBackground));
  const media = elements.personalAppBackgroundMedia;
  if (safeBackground) {
    document.documentElement.style.setProperty("--personal-bg-blur", `${normalizeBackgroundBlur(state.appBackgroundBlur)}px`);
    document.documentElement.style.setProperty("--personal-bg-scale", String(normalizeBackgroundZoom(state.appBackgroundZoom) / 100));
    if (media) {
      if (media.src !== safeBackground) media.src = safeBackground;
      media.hidden = false;
    }
  } else {
    document.documentElement.style.setProperty("--personal-bg-blur", "0px");
    document.documentElement.style.setProperty("--personal-bg-scale", "1");
    if (media) {
      media.hidden = true;
      media.removeAttribute("src");
    }
  }
}

function renderAppBackgroundPreview() {
  if (!elements.appBackgroundPreview) return;
  const safeBackground = sanitizeAppBackground(state.appBackgroundData);
  elements.appBackgroundPreview.classList.toggle("has-image", Boolean(safeBackground));
  if (safeBackground) {
    elements.appBackgroundPreview.style.backgroundImage = `url(${safeBackground})`;
    elements.appBackgroundPreview.style.filter = `blur(${Math.min(10, normalizeBackgroundBlur(state.appBackgroundBlur) / 3)}px)`;
    elements.appBackgroundPreview.style.transform = `scale(${Math.max(0.85, Math.min(1.6, normalizeBackgroundZoom(state.appBackgroundZoom) / 100))})`;
  } else {
    elements.appBackgroundPreview.style.backgroundImage = "";
    elements.appBackgroundPreview.style.filter = "none";
    elements.appBackgroundPreview.style.transform = "none";
  }
}

function loadFallbackProfileState() {
  try {
    return JSON.parse(localStorage.getItem(FALLBACK_PROFILE_STATE_KEY) || "null") || {};
  } catch (_error) {
    return {};
  }
}

async function persistProfileTextState() {
  const payload = { bio: cleanBio(state.profileBio), backgroundBlur: normalizeBackgroundBlur(state.appBackgroundBlur), backgroundZoom: normalizeBackgroundZoom(state.appBackgroundZoom), fontScale: normalizeFontScale(state.appFontScale), theme: normalizeTheme(state.appTheme), presence: normalizePresence(state.presenceStatus) };
  try {
    if (window.resenhazinhaDesktop?.saveProfileText) await window.resenhazinhaDesktop.saveProfileText(payload);
  } catch (_error) {
    // O perfil continua funcionando mesmo se a persistência falhar.
  }
  try {
    localStorage.setItem(FALLBACK_PROFILE_STATE_KEY, JSON.stringify(payload));
  } catch (_error) {
    // Fallback opcional.
  }
}

function applyBannerSurface(element, banner, accent = "#6f6b9b") {
  const safeBanner = sanitizeProfileBanner(banner);
  element.classList.toggle("has-image", Boolean(safeBanner));
  if (safeBanner) {
    element.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,.04), rgba(0,0,0,.3)), url(${safeBanner})`;
    element.style.backgroundSize = "cover";
    element.style.backgroundPosition = "center";
    element.style.backgroundRepeat = "no-repeat";
    element.style.backgroundColor = "#111";
  } else {
    element.style.backgroundImage = `linear-gradient(135deg, color-mix(in srgb, ${accent} 58%, #171719), color-mix(in srgb, ${accent} 20%, #08080a))`;
    element.style.backgroundSize = "auto";
    element.style.backgroundPosition = "center";
    element.style.backgroundRepeat = "repeat";
    element.style.backgroundColor = "#171719";
  }
}

function sanitizeServerIcon(value) {
  const icon = sanitizeAvatar(value);
  return icon && icon.length <= 400_000 ? icon : null;
}

function getOrCreateClientId() {
  let clientId = String(localStorage.getItem(CLIENT_ID_KEY) || "").trim();
  if (!/^[a-z0-9-]{12,80}$/i.test(clientId)) {
    clientId = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

function sanitizeClientId(value) {
  const clientId = String(value || "").trim();
  return /^[a-z0-9-]{12,80}$/i.test(clientId) ? clientId : "";
}

function rotateClientIdAfterKick() {
  const next = crypto.randomUUID();
  localStorage.setItem(CLIENT_ID_KEY, next);
  state.clientId = next;
  return next;
}

function loadServerBinding() {
  try {
    const raw = JSON.parse(localStorage.getItem(SERVER_BINDING_KEY) || "null");
    const roomCode = normalizeRoomCode(raw?.roomCode || "");
    if (roomCode.length < 4) return null;
    return {
      roomCode,
      isOwner: Boolean(raw?.isOwner),
      serverName: cleanServerName(raw?.serverName || "Resenhazinha"),
    };
  } catch (_error) {
    return null;
  }
}

function saveServerBinding(binding) {
  const roomCode = normalizeRoomCode(binding?.roomCode || "");
  if (roomCode.length < 4) return;
  state.serverBinding = {
    roomCode,
    isOwner: Boolean(binding?.isOwner),
    serverName: cleanServerName(binding?.serverName || state.server?.name || "Resenhazinha"),
  };
  localStorage.setItem(SERVER_BINDING_KEY, JSON.stringify(state.serverBinding));
  applySavedServerLobby();
}

function clearServerBinding() {
  state.serverBinding = null;
  localStorage.removeItem(SERVER_BINDING_KEY);
  applySavedServerLobby();
}

function applySavedServerLobby() {
  const binding = state.serverBinding;
  const saved = Boolean(binding);
  if (elements.roomCodeLabel) elements.roomCodeLabel.hidden = saved;
  if (elements.serverNameLabel) elements.serverNameLabel.hidden = saved;
  if (elements.savedServerBanner) elements.savedServerBanner.hidden = !saved;
  if (elements.savedServerName && saved) elements.savedServerName.textContent = binding.serverName || "Resenhazinha";
  elements.randomCodeButton.hidden = saved;
  elements.createButton.hidden = saved && !binding.isOwner;
  elements.joinButton.hidden = saved && binding.isOwner;
  if (saved) {
    elements.roomInput.value = binding.roomCode;
    elements.createButton.textContent = "Abrir servidor salvo";
    elements.joinButton.textContent = "Entrar no servidor salvo";
    if (elements.lobbyNote) elements.lobbyNote.textContent = "Este PC já está vinculado ao seu único servidor. O código não precisa ser digitado novamente.";
  } else {
    elements.createButton.textContent = "Criar meu servidor";
    elements.joinButton.textContent = "Entrar pela primeira vez";
    if (elements.lobbyNote) elements.lobbyNote.textContent = "O código é usado só na primeira entrada. Depois o Resenhazinha lembra o servidor automaticamente.";
  }
}

function sanitizeRegistryRecord(raw) {
  const clientId = sanitizeClientId(raw?.clientId);
  if (!clientId) return null;
  return {
    clientId,
    name: cleanNickname(raw?.name || "Amigo") || "Amigo",
    roleIds: Array.isArray(raw?.roleIds) ? raw.roleIds.map(String).slice(0, 12) : ["membro"],
    serverMuted: Boolean(raw?.serverMuted),
    avatar: sanitizeAvatar(raw?.avatar),
    banner: sanitizeProfileBanner(raw?.banner),
    bio: cleanBio(raw?.bio || ""),
    lastSeenAt: Number(raw?.lastSeenAt) || 0,
  };
}

function hydrateMemberRegistry(rawMembers) {
  state.memberRegistry = new Map();
  if (!Array.isArray(rawMembers)) return;
  rawMembers.slice(0, 100).forEach((raw) => {
    const record = sanitizeRegistryRecord(raw);
    if (record) state.memberRegistry.set(record.clientId, record);
  });
}

function registryRecordFor(clientId) {
  const id = sanitizeClientId(clientId);
  return id ? state.memberRegistry.get(id) || null : null;
}

function rememberMember(member) {
  const clientId = sanitizeClientId(member?.clientId);
  if (!clientId) return;
  const roleIds = normalizeRoleIds(member.roleIds || ["membro"]);
  const previous = state.memberRegistry.get(clientId) || {};
  state.memberRegistry.set(clientId, {
    clientId,
    name: cleanNickname(member.name || previous.name || "Amigo") || "Amigo",
    roleIds,
    serverMuted: Boolean(member.serverMuted),
    avatar: sanitizeAvatar(member.avatar) || previous.avatar || null,
    banner: sanitizeProfileBanner(member.banner) || previous.banner || null,
    bio: cleanBio(member.bio || previous.bio || ""),
    lastSeenAt: Date.now(),
  });
}

function applyRememberedMemberState(member) {
  const remembered = registryRecordFor(member?.clientId);
  if (remembered) {
    member.roleIds = normalizeRoleIds(remembered.roleIds);
    member.serverMuted = Boolean(remembered.serverMuted);
    if (!member.name || member.name === "Amigo") member.name = remembered.name;
    if (!member.avatar) member.avatar = sanitizeAvatar(remembered.avatar);
    if (!member.banner) member.banner = sanitizeProfileBanner(remembered.banner);
    if (!member.bio) member.bio = cleanBio(remembered.bio || "");
  }
  if (member?.clientId && member.clientId === state.server.ownerClientId) {
    member.roleIds = normalizeRoleIds([...(member.roleIds || []), "admin"]);
    member.serverMuted = false;
  }
  rememberMember(member);
  return member;
}

async function loadPersistentServerState(roomCode) {
  if (!state.isHost) return false;
  let saved = null;
  try {
    saved = window.resenhazinhaDesktop?.loadServerState
      ? await window.resenhazinhaDesktop.loadServerState()
      : JSON.parse(localStorage.getItem(FALLBACK_SERVER_STATE_KEY) || "null");
  } catch (_error) {
    saved = null;
  }
  if (!saved || normalizeRoomCode(saved.roomCode || "") !== roomCode) return false;
  state.server = sanitizeServer(saved.server || state.server);
  state.server.ownerClientId = sanitizeClientId(state.server.ownerClientId) || state.clientId;
  state.chatMessages = (saved.chatMessages || []).map(sanitizeIncomingChatMessage).filter(Boolean).slice(-MAX_CHAT_HISTORY);
  hydrateMemberRegistry(saved.members);
  state.revokedClientIds = new Set((saved.revokedClientIds || []).map(sanitizeClientId).filter(Boolean).slice(0, 200));
  try {
    const cachedProfiles = await window.resenhazinhaDesktop?.loadMemberProfiles?.();
    for (const profile of cachedProfiles || []) {
      const clientId = sanitizeClientId(profile?.clientId);
      const record = clientId ? state.memberRegistry.get(clientId) : null;
      if (!record) continue;
      record.avatar = sanitizeAvatar(profile.avatar) || record.avatar || null;
      record.banner = sanitizeProfileBanner(profile.banner) || record.banner || null;
      record.bio = cleanBio(profile.bio || record.bio || "");
    }
  } catch (_error) {
    // O servidor segue abrindo mesmo se o cache visual estiver indisponível.
  }
  return true;
}

function persistentServerPayload() {
  const server = sanitizeServer(state.server);
  server.ownerPeerId = null;
  return {
    version: 4,
    roomCode: state.roomCode,
    server,
    chatMessages: state.chatMessages.slice(-MAX_CHAT_HISTORY),
    revokedClientIds: Array.from(state.revokedClientIds).slice(-200),
    // Fotos/banners ficam no perfil local de cada pessoa. Aqui salvamos apenas
    // o necessário para o membro continuar aparecendo Offline após reiniciar.
    members: Array.from(state.memberRegistry.values()).slice(0, 100).map((record) => ({
      clientId: record.clientId,
      name: record.name,
      roleIds: record.roleIds,
      serverMuted: Boolean(record.serverMuted),
      lastSeenAt: Number(record.lastSeenAt) || 0,
    })),
    savedAt: Date.now(),
  };
}

async function persistServerStateNow() {
  if (!state.isHost || !state.roomCode) return;
  try {
    const payload = persistentServerPayload();
    if (window.resenhazinhaDesktop?.saveServerState) await window.resenhazinhaDesktop.saveServerState(payload);
    else localStorage.setItem(FALLBACK_SERVER_STATE_KEY, JSON.stringify(payload));
  } catch (_error) {
    // O servidor continua funcionando mesmo se o disco estiver temporariamente indisponível.
  }
}

function scheduleServerPersistence() {
  if (!state.isHost) return;
  window.clearTimeout(state.persistenceTimer);
  state.persistenceTimer = window.setTimeout(() => persistServerStateNow(), 180);
}

function scheduleHostReconnect() {
  if (state.isHost || !state.serverBinding || state.peer?.destroyed) return;
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = window.setTimeout(() => {
    if (!state.hostConnection?.open && state.peer?.open) connectToHost(true);
  }, 4000);
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function normalizeRoomCode(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function hostPeerId(roomCode) {
  return `resenhazinha-room-${roomCode.toLowerCase()}`;
}

function cleanNickname(value) {
  return value.trim().replace(/\s+/g, " ").slice(0, 20);
}

function cleanServerName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 28) || "Resenhazinha";
}

function cleanChannelName(value, fallback) {
  const cleaned = String(value || "").trim().toLowerCase().replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_à-ÿ]/gi, "").replace(/-+/g, "-").slice(0, 24);
  return cleaned || fallback;
}

function cleanRoleName(value) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, 20); }
function cleanRoleColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#7c6df2";
}

function createDefaultServer(name = "Resenhazinha") {
  return {
    name: cleanServerName(name),
    icon: null,
    textChannel: { exists: true, name: "chat-principal" },
    voiceChannel: { exists: true, name: "call" },
    roles: [
      { id: "admin", name: "Admin", color: "#ef5c67", admin: true },
      { id: "membro", name: "Membro", color: "#71a7ff", admin: false },
    ],
    ownerPeerId: null,
    ownerClientId: null,
  };
}

function sanitizeServer(raw) {
  const base = createDefaultServer(raw?.name);
  const roles = Array.isArray(raw?.roles) ? raw.roles.slice(0, 12).map((role) => ({
    id: String(role?.id || crypto.randomUUID()).slice(0, 80),
    name: cleanRoleName(role?.name) || "Cargo",
    color: cleanRoleColor(role?.color),
    admin: Boolean(role?.admin),
  })) : base.roles;
  const uniqueRoles = []; const seen = new Set();
  for (const role of roles) { if (!seen.has(role.id)) { seen.add(role.id); uniqueRoles.push(role); } }
  if (!uniqueRoles.some((role) => role.id === "membro")) uniqueRoles.unshift({ id: "membro", name: "Membro", color: "#71a7ff", admin: false });
  if (!uniqueRoles.some((role) => role.id === "admin")) uniqueRoles.unshift({ id: "admin", name: "Admin", color: "#ef5c67", admin: true });
  return {
    name: cleanServerName(raw?.name || base.name),
    icon: sanitizeServerIcon(raw?.icon),
    textChannel: { exists: raw?.textChannel?.exists !== false, name: cleanChannelName(raw?.textChannel?.name, "chat-principal") },
    voiceChannel: { exists: raw?.voiceChannel?.exists !== false, name: cleanChannelName(raw?.voiceChannel?.name, "call") },
    roles: uniqueRoles.slice(0, 12),
    ownerPeerId: raw?.ownerPeerId ? String(raw.ownerPeerId).slice(0, 120) : null,
    ownerClientId: sanitizeClientId(raw?.ownerClientId),
  };
}

function normalizeRoleIds(roleIds) {
  if (!Array.isArray(roleIds)) return ["membro"];
  const known = new Set(state.server.roles.map((role) => role.id));
  const ids = [...new Set(roleIds.map(String).filter((id) => known.has(id)))].slice(0, 12);
  if (!ids.includes("membro")) ids.unshift("membro");
  return ids.slice(0, 12);
}

function isServerOwner(peerId) {
  if (!peerId) return false;
  if (state.server.ownerPeerId === peerId) return true;
  const member = state.members.find((item) => item.peerId === peerId) || state.hostMembers.get(peerId);
  return Boolean(member?.clientId && state.server.ownerClientId && member.clientId === state.server.ownerClientId);
}
function memberHasAdmin(memberOrPeerId) {
  const peerId = typeof memberOrPeerId === "string" ? memberOrPeerId : memberOrPeerId?.peerId;
  if (!peerId) return false;
  if (isServerOwner(peerId)) return true;
  const member = typeof memberOrPeerId === "string" ? state.members.find((item) => item.peerId === peerId) || state.hostMembers.get(peerId) : memberOrPeerId;
  const roleIds = new Set(member?.roleIds || []);
  return state.server.roles.some((role) => role.admin && roleIds.has(role.id));
}
function canCurrentUserAdmin() { return Boolean(state.peer?.id && memberHasAdmin(state.peer.id)); }
function memberDisplayRole(member) {
  const roleIds = new Set(member?.roleIds || []);
  const assigned = state.server.roles.filter((role) => roleIds.has(role.id));
  const adminRole = assigned.find((role) => role.admin);
  if (adminRole) return adminRole;
  const customRoles = assigned.filter((role) => role.id !== "membro");
  return customRoles.at(-1) || assigned.find((role) => role.id === "membro") || null;
}

function memberVisualRole(member) {
  const roleIds = new Set(member?.roleIds || []);
  const assigned = state.server.roles.filter((role) => roleIds.has(role.id));
  const visualCustom = assigned.filter((role) => role.id !== "membro" && role.id !== "admin" && !role.admin);
  if (visualCustom.length) return visualCustom.at(-1);
  const anyCustom = assigned.filter((role) => role.id !== "membro" && role.id !== "admin");
  if (anyCustom.length) return anyCustom.at(-1);
  return assigned.find((role) => role.id === "admin") || assigned.find((role) => role.id === "membro") || null;
}

function createOwnerCrown() {
  const crown = document.createElement("span");
  crown.className = "owner-crown";
  crown.title = "Dono do servidor";
  crown.setAttribute("aria-label", "Dono do servidor");
  crown.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5 7.2 11 12 4l4.8 7L21 7.5l-1.7 10H4.7L3 7.5Z"/><path d="M5 20h14"/></svg>';
  return crown;
}

function currentSelfMember() {
  return state.members.find((member) => member.peerId === state.peer?.id) || null;
}


async function loadStoredProfile() {
  const fallback = loadFallbackProfileState();
  try {
    const profile = await window.resenhazinhaDesktop?.loadProfile?.();
    state.avatarData = sanitizeAvatar(profile?.avatar);
    state.bannerData = sanitizeProfileBanner(profile?.banner);
    state.profileBio = cleanBio(profile?.bio || fallback.bio || "");
    setAppBackgroundSource(profile?.background);
    state.appBackgroundBlur = normalizeBackgroundBlur(profile?.backgroundBlur ?? fallback.backgroundBlur ?? DEFAULT_BACKGROUND_BLUR);
    state.appBackgroundZoom = normalizeBackgroundZoom(profile?.backgroundZoom ?? fallback.backgroundZoom ?? DEFAULT_BACKGROUND_ZOOM);
    state.appFontScale = normalizeFontScale(profile?.fontScale ?? fallback.fontScale ?? DEFAULT_FONT_SCALE);
    state.appTheme = normalizeTheme(profile?.theme ?? fallback.theme ?? DEFAULT_THEME);
    state.presenceStatus = normalizePresence(profile?.presence ?? fallback.presence ?? DEFAULT_PRESENCE);
  } catch (_error) {
    state.avatarData = null;
    state.bannerData = sanitizeProfileBanner(fallback.banner);
    state.profileBio = cleanBio(fallback.bio || "");
    setAppBackgroundSource(fallback.background);
    state.appBackgroundBlur = normalizeBackgroundBlur(fallback.backgroundBlur ?? DEFAULT_BACKGROUND_BLUR);
    state.appBackgroundZoom = normalizeBackgroundZoom(fallback.backgroundZoom ?? DEFAULT_BACKGROUND_ZOOM);
    state.appFontScale = normalizeFontScale(fallback.fontScale ?? DEFAULT_FONT_SCALE);
    state.appTheme = normalizeTheme(fallback.theme ?? DEFAULT_THEME);
    state.presenceStatus = normalizePresence(fallback.presence ?? DEFAULT_PRESENCE);
  }
  renderLocalAvatars();
  applyUiTheme();
  applyFontScale();
  applyAppBackground();
  renderPresenceChoices();
}

async function chooseAvatar() {
  if (!window.resenhazinhaDesktop?.chooseAvatar) {
    toast("A troca de foto está disponível no aplicativo para Windows.");
    return;
  }
  try {
    const result = await window.resenhazinhaDesktop.chooseAvatar();
    if (result?.canceled) return;
    if (result?.error === "too-large") {
      toast("Esse arquivo passou de 4 MB. Escolha um GIF ou foto menor.", "error");
      return;
    }
    const avatar = sanitizeAvatar(result?.avatar);
    if (!avatar) {
      toast("Não consegui usar essa imagem.", "error");
      return;
    }
    state.avatarData = avatar;
    renderLocalAvatars();
    publishProfile();
    toast("Foto do perfil atualizada.");
  } catch (_error) {
    toast("Não consegui abrir essa imagem.", "error");
  }
}

async function chooseProfileBanner() {
  if (!window.resenhazinhaDesktop?.chooseProfileBanner) {
    toast("A troca de banner está disponível no aplicativo para Windows.");
    return;
  }
  try {
    const result = await window.resenhazinhaDesktop.chooseProfileBanner();
    if (result?.canceled) return;
    if (result?.error === "too-large") {
      toast("Esse banner ficou grande demais. Escolha um GIF ou imagem menor.", "error");
      return;
    }
    const banner = sanitizeProfileBanner(result?.banner);
    if (!banner) {
      toast("Não consegui usar esse banner.", "error");
      return;
    }
    state.bannerData = banner;
    await persistProfileTextState();
    renderUserSettings();
    publishProfile();
    toast("Banner do perfil atualizado.");
  } catch (_error) {
    toast("Não consegui abrir esse banner.", "error");
  }
}

async function removeProfileBanner() {
  try {
    await window.resenhazinhaDesktop?.removeProfileBanner?.();
    state.bannerData = null;
    await persistProfileTextState();
    renderUserSettings();
    publishProfile();
    toast("Banner do perfil removido.");
  } catch (_error) {
    toast("Não consegui remover o banner agora.", "error");
  }
}

async function chooseAppBackground() {
  if (!window.resenhazinhaDesktop?.chooseAppBackground) {
    toast("O fundo personalizado está disponível no aplicativo para Windows.");
    return;
  }
  try {
    const result = await window.resenhazinhaDesktop.chooseAppBackground();
    if (result?.canceled) return;
    if (result?.error === "too-large") {
      toast("Esse fundo ficou grande demais. Escolha um GIF ou imagem menor.", "error");
      return;
    }
    const background = appBackgroundSourceFromPayload(result?.background);
    if (!background) {
      toast("Não consegui usar esse fundo.", "error");
      return;
    }
    const previousBackground = state.appBackgroundData;
    state.appBackgroundData = background;
    if (previousBackground && previousBackground !== background) revokeAppBackgroundSource(previousBackground);
    state.appBackgroundBlur = normalizeBackgroundBlur(result?.backgroundBlur ?? state.appBackgroundBlur);
    applyAppBackground();
    renderUserSettings();
    toast("Fundo personalizado aplicado.");
  } catch (_error) {
    toast("Não consegui abrir esse fundo.", "error");
  }
}

async function removeAppBackground() {
  try {
    await window.resenhazinhaDesktop?.removeAppBackground?.();
    revokeAppBackgroundSource(state.appBackgroundData);
    state.appBackgroundData = null;
    applyAppBackground();
    renderUserSettings();
    toast("Fundo padrão restaurado.");
  } catch (_error) {
    toast("Não consegui restaurar o fundo padrão agora.", "error");
  }
}

async function removeAvatar() {
  try {
    await window.resenhazinhaDesktop?.removeAvatar?.();
    state.avatarData = null;
    renderLocalAvatars();
    publishProfile();
    toast("Foto do perfil removida.");
  } catch (_error) {
    toast("Não consegui remover a foto agora.", "error");
  }
}

function profileMediaLimit(kind) {
  return kind === "avatar" ? 5_700_000 : kind === "banner" ? 9_600_000 : 0;
}

function sanitizeProfileMedia(kind, value) {
  return kind === "avatar" ? sanitizeAvatar(value) : kind === "banner" ? sanitizeProfileBanner(value) : null;
}

async function sendProfileMedia(connection, clientId, kind, value) {
  if (!connection?.open) return;
  const id = sanitizeClientId(clientId);
  if (!id || !["avatar", "banner"].includes(kind)) return;
  const safe = sanitizeProfileMedia(kind, value);
  if (!safe) {
    connection.send({ type: "profile-media-clear", clientId: id, kind });
    return;
  }
  const transferId = crypto.randomUUID();
  connection.send({ type: "profile-media-start", transferId, clientId: id, kind, totalLength: safe.length });
  let index = 0;
  for (let offset = 0; offset < safe.length; offset += PROFILE_MEDIA_CHUNK_BYTES, index += 1) {
    connection.send({ type: "profile-media-chunk", transferId, index, data: safe.slice(offset, offset + PROFILE_MEDIA_CHUNK_BYTES) });
    if (index % 8 === 7) await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  connection.send({ type: "profile-media-complete", transferId });
}

function beginProfileMediaTransfer(sourcePeerId, message) {
  const transferId = String(message.transferId || "");
  const clientId = sanitizeClientId(message.clientId);
  const kind = String(message.kind || "");
  const totalLength = Number(message.totalLength);
  const limit = profileMediaLimit(kind);
  if (!/^[a-z0-9-]{12,100}$/i.test(transferId) || !clientId || !limit || !Number.isInteger(totalLength) || totalLength <= 0 || totalLength > limit) return;
  state.incomingProfileMedia.set(transferId, { sourcePeerId: String(sourcePeerId || ""), clientId, kind, totalLength, chunks: new Map(), received: 0 });
}

function receiveProfileMediaChunk(message) {
  const transferId = String(message.transferId || "");
  const transfer = state.incomingProfileMedia.get(transferId);
  const index = Number(message.index);
  const data = typeof message.data === "string" ? message.data : "";
  if (!transfer || !Number.isInteger(index) || index < 0 || !data || transfer.chunks.has(index)) return;
  if (transfer.received + data.length > transfer.totalLength) { state.incomingProfileMedia.delete(transferId); return; }
  transfer.chunks.set(index, data);
  transfer.received += data.length;
}

function memberByClientId(clientId) {
  const id = sanitizeClientId(clientId);
  return id ? state.members.find((member) => member.clientId === id) || [...state.hostMembers.values()].find((member) => member.clientId === id) || null : null;
}

function applyProfileMediaToMember(clientId, kind, value) {
  const member = memberByClientId(clientId);
  const safe = sanitizeProfileMedia(kind, value);
  if (!member) return null;
  member[kind] = safe;
  if (state.isHost) rememberMember(member);
  renderMembers();
  renderChatHistory();
  if (state.profilePopoverPeerId === member.peerId && !elements.profilePopover.hidden) renderMemberProfilePopover(member);
  return member;
}

async function finishProfileMediaTransfer(sourcePeerId, message) {
  const transferId = String(message.transferId || "");
  const transfer = state.incomingProfileMedia.get(transferId);
  if (!transfer || transfer.sourcePeerId !== String(sourcePeerId || "") || transfer.received !== transfer.totalLength) { state.incomingProfileMedia.delete(transferId); return; }
  state.incomingProfileMedia.delete(transferId);
  const value = [...transfer.chunks.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]).join("");
  if (value.length !== transfer.totalLength) return;
  const safe = sanitizeProfileMedia(transfer.kind, value);
  if (!safe) return;
  const member = applyProfileMediaToMember(transfer.clientId, transfer.kind, safe);
  if (!member) return;
  if (state.isHost) {
    void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({ clientId: transfer.clientId, [transfer.kind]: safe, bio: member.bio })).catch(() => undefined);
    state.guestConnections.forEach((connection, peerId) => { if (connection.open && peerId !== sourcePeerId) void sendProfileMedia(connection, transfer.clientId, transfer.kind, safe); });
    broadcastRoster(false);
    scheduleServerPersistence();
  }
}

function clearProfileMedia(sourcePeerId, message) {
  const clientId = sanitizeClientId(message.clientId);
  const kind = String(message.kind || "");
  if (!clientId || !["avatar", "banner"].includes(kind)) return;
  const member = memberByClientId(clientId);
  if (!member) return;
  member[kind] = null;
  if (state.isHost) {
    rememberMember(member);
    void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({ clientId, [kind]: null, bio: member.bio })).catch(() => undefined);
    state.guestConnections.forEach((connection, peerId) => { if (connection.open && peerId !== sourcePeerId) connection.send({ type: "profile-media-clear", clientId, kind }); });
    broadcastRoster(false);
    scheduleServerPersistence();
  }
  renderMembers(); renderChatHistory();
}

function sendOwnProfileMediaToHost() {
  if (!state.hostConnection?.open) return;
  void sendProfileMedia(state.hostConnection, state.clientId, "avatar", state.avatarData);
  void sendProfileMedia(state.hostConnection, state.clientId, "banner", state.bannerData);
}

function sendAllProfileMediaToGuest(connection) {
  if (!state.isHost || !connection?.open) return;
  const members = composeRosterMembers();
  let delay = 0;
  members.forEach((member) => {
    const clientId = sanitizeClientId(member.clientId);
    if (!clientId) return;
    if (member.avatar) { window.setTimeout(() => void sendProfileMedia(connection, clientId, "avatar", member.avatar), delay); delay += 40; }
    if (member.banner) { window.setTimeout(() => void sendProfileMedia(connection, clientId, "banner", member.banner), delay); delay += 40; }
  });
}

function publishProfile() {
  if (!state.peer?.open) return;
  if (state.isHost) {
    const member = state.hostMembers.get(state.peer.id);
    if (member) {
      member.avatar = state.avatarData;
      member.banner = state.bannerData;
      member.bio = cleanBio(state.profileBio);
      member.presence = normalizePresence(state.presenceStatus);
      member.name = state.nickname || member.name;
      rememberMember(member);
      void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({ clientId: state.clientId, avatar: state.avatarData, banner: state.bannerData, bio: member.bio })).catch(() => undefined);
    }
    broadcastRoster(true);
    state.guestConnections.forEach((connection) => {
      if (!connection.open) return;
      void sendProfileMedia(connection, state.clientId, "avatar", state.avatarData);
      void sendProfileMedia(connection, state.clientId, "banner", state.bannerData);
    });
    scheduleServerPersistence();
    return;
  }

  const self = state.members.find((member) => member.peerId === state.peer.id);
  if (self) { self.avatar = state.avatarData; self.banner = state.bannerData; self.bio = cleanBio(state.profileBio); self.presence = normalizePresence(state.presenceStatus); }
  renderMembers();
  if (state.hostConnection?.open) {
    state.hostConnection.send({ type: "profile", nickname: state.nickname, bio: cleanBio(state.profileBio), presence: normalizePresence(state.presenceStatus), clientId: state.clientId });
    sendOwnProfileMediaToHost();
  }
}

function renderLocalAvatars() {
  const displayName = cleanNickname(elements.nicknameInput.value) || state.nickname || "Você";
  paintAvatar(elements.lobbyAvatar, displayName, state.avatarData);
  paintAvatar(elements.selfAvatar, displayName, state.avatarData);
  elements.removeAvatarButton.hidden = !state.avatarData;
}

async function enterRoom(mode) {
  if (state.peer) return;
  await profileReady;
  const nickname = cleanNickname(elements.nicknameInput.value);
  const resuming = mode === "resume-host" || mode === "resume-join";
  const binding = state.serverBinding;
  const roomCode = normalizeRoomCode(resuming && binding ? binding.roomCode : elements.roomInput.value);
  if (!nickname) { setLobbyStatus("Coloque um apelido para entrar.", "error"); elements.nicknameInput.focus(); return; }
  if (roomCode.length < 4) { setLobbyStatus("O código precisa ter pelo menos 4 caracteres.", "error"); elements.roomInput.focus(); return; }

  state.nickname = nickname;
  state.roomCode = roomCode;
  state.isHost = mode === "create" || mode === "resume-host";
  state.inVoice = false;
  state.serverMuted = false;
  state.currentView = "text";
  state.localStream = null;
  state.chatMessages = [];
  state.memberRegistry = new Map();
  state.revokedClientIds = new Set();
  state.incomingProfileMedia.clear();
  state.server = state.isHost ? createDefaultServer(elements.serverNameInput.value || binding?.serverName) : createDefaultServer(binding?.serverName);
  localStorage.setItem("resenhazinha:nickname", nickname);

  setLobbyBusy(true);
  setLobbyStatus(state.isHost ? "Abrindo seu servidor salvo…" : "Conectando ao seu servidor…");

  if (state.isHost) {
    const loaded = await loadPersistentServerState(roomCode);
    if (!loaded) {
      state.server = createDefaultServer(elements.serverNameInput.value || binding?.serverName);
      state.server.ownerClientId = state.clientId;
      const ownerRecord = { clientId: state.clientId, name: nickname, roleIds: ["membro", "admin"], serverMuted: false };
      state.memberRegistry.set(state.clientId, ownerRecord);
    } else {
      state.server.ownerClientId = sanitizeClientId(state.server.ownerClientId) || state.clientId;
    }
  }

  state.peer = new Peer(state.isHost ? hostPeerId(roomCode) : undefined, PEER_OPTIONS);
  bindPeerEvents();
}


function bindPeerEvents() {
  state.peer.on("open", () => {
    if (state.isHost) {
      state.server.ownerPeerId = state.peer.id;
      state.server.ownerClientId = sanitizeClientId(state.server.ownerClientId) || state.clientId;
      const self = applyRememberedMemberState(localMember());
      state.hostMembers.set(state.peer.id, self);
      state.members = Array.from(state.hostMembers.values());
      state.peer.on("connection", acceptGuestConnection);
      if (!state.serverBinding) saveServerBinding({ roomCode: state.roomCode, isOwner: true, serverName: state.server.name });
      else if (state.serverBinding.serverName !== state.server.name) saveServerBinding({ ...state.serverBinding, serverName: state.server.name });
      openRoomView(); renderChatHistory(); void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({ clientId: state.clientId, avatar: state.avatarData, banner: state.bannerData, bio: cleanBio(state.profileBio) })).catch(() => undefined); broadcastRoster(true); scheduleServerPersistence();
    } else connectToHost();
  });
  state.peer.on("call", handleIncomingCall);
  state.peer.on("disconnected", () => { setConnectionState("Reconectando…", "warning"); if (!state.peer.destroyed) state.peer.reconnect(); });
  state.peer.on("error", (error) => {
    if (!state.roomEntered) {
      cleanupMedia(); if (state.peer && !state.peer.destroyed) state.peer.destroy(); state.peer = null; setLobbyBusy(false);
      const message = error.type === "unavailable-id" ? (state.serverBinding?.isOwner ? "Seu servidor parece já estar aberto em outro lugar." : "Esse código já está sendo usado.") : error.type === "peer-unavailable" ? (state.serverBinding ? "Seu servidor está salvo, mas o anfitrião está offline agora." : "Não encontrei esse servidor. Confira o código com quem criou.") : "Não consegui conectar agora. Verifique sua internet e tente novamente.";
      setLobbyStatus(message, "error"); return;
    }
    setConnectionState("Conexão instável", "warning");
  });
}


function connectToHost(isReconnect = false) {
  if (!state.peer?.open || state.isHost) return;
  if (state.hostConnection?.open) return;
  const connection = state.peer.connect(hostPeerId(state.roomCode), { reliable: true, metadata: { nickname: state.nickname, clientId: state.clientId } });
  state.hostConnection = connection;
  const timeout = window.setTimeout(() => {
    if (!connection.open && !state.roomEntered) {
      setLobbyBusy(false);
      setLobbyStatus(state.serverBinding ? "Seu servidor está salvo, mas o anfitrião está offline. Você não precisa digitar código nenhum; é só tentar de novo quando ele abrir o app." : "O servidor não respondeu. Confira o código e tente novamente.", "error");
      connection.close();
      if (state.peer && !state.peer.destroyed) state.peer.destroy();
      state.peer = null;
    } else if (!connection.open && state.roomEntered) {
      setConnectionState("Servidor offline", "warning");
      scheduleHostReconnect();
    }
  }, isReconnect ? 6500 : 10000);
  connection.on("open", () => {
    window.clearTimeout(timeout);
    window.clearTimeout(state.reconnectTimer);
    connection.send({ type: "join", nickname: state.nickname, bio: cleanBio(state.profileBio), presence: normalizePresence(state.presenceStatus), clientId: state.clientId });
    window.setTimeout(sendOwnProfileMediaToHost, 60);
    if (!state.serverBinding) saveServerBinding({ roomCode: state.roomCode, isOwner: false, serverName: state.server.name });
    if (!state.roomEntered) openRoomView();
    setConnectionState("Conectado", "ok");
  });
  connection.on("data", handleHostMessage);
  connection.on("close", () => {
    if (state.hostConnection === connection) state.hostConnection = null;
    if (state.roomEntered) {
      setConnectionState("Servidor offline", "warning");
      toast("O anfitrião ficou offline. O servidor continua salvo e reconecta quando ele voltar.", "error");
      closeAllMediaCalls();
      state.inVoice = false;
      state.localStream?.getTracks().forEach((track) => track.stop()); state.localStream = null;
      applyLocalAudioState(); updateControlState();
      state.members = state.members.filter((member) => member.peerId === state.peer?.id);
      renderMembers(); renderVoiceGrid();
      scheduleHostReconnect();
    }
  });
  connection.on("error", () => {
    if (!state.roomEntered) setLobbyStatus(state.serverBinding ? "Seu servidor está salvo, mas está offline agora." : "Não consegui entrar nesse servidor.", "error");
    else scheduleHostReconnect();
  });
}


function acceptGuestConnection(connection) {
  connection.on("data", (message) => handleGuestMessage(connection.peer, message));
  connection.on("close", () => removeGuest(connection.peer)); connection.on("error", () => removeGuest(connection.peer));
  connection.on("open", () => {
    const pendingProfile = state.pendingGuestProfiles.get(connection.peer);
    const clientId = sanitizeClientId(pendingProfile?.clientId || connection.metadata?.clientId);
    if (clientId && state.revokedClientIds.has(clientId)) {
      connection.send({ type: "server-kicked", serverName: state.server.name });
      window.setTimeout(() => connection.close(), 180);
      return;
    }
    if (state.hostMembers.size >= MAX_MEMBERS) { connection.send({ type: "room-full" }); window.setTimeout(() => connection.close(), 250); return; }
    const nickname = cleanNickname(pendingProfile?.name || connection.metadata?.nickname || "Amigo");
    state.guestConnections.set(connection.peer, connection);
    const member = applyRememberedMemberState(memberFrom(connection.peer, nickname, false, pendingProfile?.avatar || null, clientId, pendingProfile?.banner || null, pendingProfile?.bio || "", pendingProfile?.presence || DEFAULT_PRESENCE));
    state.hostMembers.set(connection.peer, member);
    state.pendingGuestProfiles.delete(connection.peer); state.members = Array.from(state.hostMembers.values());
    broadcastRoster(true); connection.send({ type: "chat-history", messages: state.chatMessages.slice(-MAX_CHAT_HISTORY) }); window.setTimeout(() => sendAllProfileMediaToGuest(connection), 120); scheduleServerPersistence(); toast(`${nickname} entrou no servidor.`);
  });
}


function handleGuestMessage(peerId, message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "join") {
    const member = state.hostMembers.get(peerId); const profile = { name: cleanNickname(message.nickname || member?.name || "Amigo") || "Amigo", bio: cleanBio(message.bio || ""), presence: normalizePresence(message.presence), clientId: sanitizeClientId(message.clientId || member?.clientId) };
    if (!member) { state.pendingGuestProfiles.set(peerId, profile); return; }
    member.name = profile.name; member.bio = profile.bio; member.presence = profile.presence; if (profile.clientId) member.clientId = profile.clientId; applyRememberedMemberState(member); state.members = Array.from(state.hostMembers.values()); rememberMember(member); void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({ clientId: member.clientId, bio: member.bio })).catch(() => undefined); broadcastRoster(true); scheduleServerPersistence();
  }
  if (message.type === "profile") { const member = state.hostMembers.get(peerId); if (member) { const nextName = cleanNickname(message.nickname || member.name) || member.name; member.name = nextName; member.bio = cleanBio(message.bio || ""); member.presence = normalizePresence(message.presence); rememberMember(member); void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({ clientId: member.clientId, bio: member.bio })).catch(() => undefined); state.members = Array.from(state.hostMembers.values()); broadcastRoster(true); scheduleServerPersistence(); } }
  if (message.type === "profile-media-start") { const member = state.hostMembers.get(peerId); if (member && sanitizeClientId(message.clientId) === sanitizeClientId(member.clientId)) beginProfileMediaTransfer(peerId, message); }
  if (message.type === "profile-media-chunk") receiveProfileMediaChunk(message);
  if (message.type === "profile-media-complete") void finishProfileMediaTransfer(peerId, message);
  if (message.type === "profile-media-clear") { const member = state.hostMembers.get(peerId); if (member && sanitizeClientId(message.clientId) === sanitizeClientId(member.clientId)) clearProfileMedia(peerId, message); }
  if (message.type === "chat-send") acceptChatMessage(peerId, message.text);
  if (message.type === "chat-upload-start") beginIncomingChatUpload(peerId, message);
  if (message.type === "chat-upload-chunk") receiveIncomingChatUploadChunk(peerId, message);
  if (message.type === "chat-upload-complete") void finalizeIncomingChatUpload(peerId, message);
  if (message.type === "chat-edit") acceptChatEdit(peerId, message.messageId, message.text);
  if (message.type === "chat-delete") void acceptChatDelete(peerId, message.messageId);
  if (message.type === "attachment-request") void sendAttachmentToGuest(peerId, message.attachmentId);
  if (message.type === "status") {
    const member = state.hostMembers.get(peerId); if (member) { member.deafened = Boolean(message.deafened); member.muted = member.deafened || Boolean(message.muted); member.inVoice = state.server.voiceChannel.exists && Boolean(message.inVoice); if (message.presence) member.presence = normalizePresence(message.presence); rememberMember(member); state.members = Array.from(state.hostMembers.values()); if (!member.inVoice) { state.activeScreens.delete(peerId); clearScreenStage(peerId); } broadcastRoster(false); }
  }
  if (message.type === "admin-action") applyAdminAction(peerId, message.action, message.payload);
  if (message.type === "screen-started") { const member = state.hostMembers.get(peerId); if (!member?.inVoice || !state.server.voiceChannel.exists) return; state.activeScreens.set(peerId, { peerId, name: member.name }); state.activeScreen = state.activeScreens.values().next().value || null; broadcastRoster(false); }
  if (message.type === "screen-stopped") { state.activeScreens.delete(peerId); state.activeScreen = state.activeScreens.values().next().value || null; clearScreenStage(peerId); broadcastRoster(false); }
}


function handleHostMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "server-kicked") {
    const serverName = cleanServerName(message.serverName || state.server?.name || "servidor");
    clearServerBinding();
    rotateClientIdAfterKick();
    sessionStorage.setItem("resenhazinha:kicked-notice", `Você foi expulso de ${serverName}. Se quiser voltar, peça o código e entre novamente.`);
    teardownConnections();
    window.setTimeout(() => window.location.reload(), 80);
    return;
  }
  if (message.type === "room-full") {
    setConnectionState("Servidor lotado", "danger"); toast("Esse servidor já está com 6 pessoas.", "error");
    if (state.serverBinding) {
      window.setTimeout(() => { teardownConnections(); state.peer = null; state.roomEntered = false; elements.roomView.hidden = true; elements.lobbyView.hidden = false; setLobbyBusy(false); applySavedServerLobby(); setLobbyStatus("Seu servidor continua salvo. Ele só está com as 6 vagas ocupadas agora.", "error"); }, 500);
    } else window.setTimeout(leaveRoom, 900);
    return;
  }
  if (message.type === "chat-history") { state.chatMessages = (message.messages || []).map(sanitizeIncomingChatMessage).filter(Boolean).slice(-MAX_CHAT_HISTORY); renderChatHistory(); return; }
  if (message.type === "chat-message") { const chatMessage = sanitizeIncomingChatMessage(message.message); if (chatMessage) appendChatMessage(chatMessage); return; }
  if (message.type === "chat-message-edit") { applyIncomingChatEdit(message); return; }
  if (message.type === "chat-message-delete") { applyIncomingChatDelete(message.messageId); return; }
  if (message.type === "chat-upload-error") { state.chatSending = false; updateChatComposerState(); toast(cleanUploadError(message.reason), "error"); return; }
  if (message.type === "attachment-data-start") { beginAttachmentDownload(message); return; }
  if (message.type === "attachment-data-chunk") { receiveAttachmentDownloadChunk(message); return; }
  if (message.type === "attachment-data-complete") { finishAttachmentDownload(message); return; }
  if (message.type === "profile-media-start") { beginProfileMediaTransfer("host", message); return; }
  if (message.type === "profile-media-chunk") { receiveProfileMediaChunk(message); return; }
  if (message.type === "profile-media-complete") { void finishProfileMediaTransfer("host", message); return; }
  if (message.type === "profile-media-clear") { clearProfileMedia("host", message); return; }
  if (message.type === "roster") {
    const previousMembers = new Map(state.members.map((member) => [member.peerId, member]));
    const previousByClient = new Map(state.members.filter((member) => member.clientId).map((member) => [member.clientId, member]));
    state.server = sanitizeServer(message.server || state.server);
    state.members = (message.members || []).map((member) => {
      const peerId = String(member.peerId || "").slice(0, 120);
      const clientId = sanitizeClientId(member.clientId);
      const previous = previousMembers.get(peerId) || (clientId ? previousByClient.get(clientId) : null);
      return {
        peerId, clientId, name: cleanNickname(member.name || "Amigo") || "Amigo",
        muted: Boolean(member.muted), deafened: Boolean(member.deafened), serverMuted: Boolean(member.serverMuted), inVoice: Boolean(member.inVoice) && state.server.voiceChannel.exists,
        roleIds: normalizeRoleIds(member.roleIds),
        avatar: previous?.avatar || (peerId === state.peer?.id ? state.avatarData : null),
        banner: previous?.banner || (peerId === state.peer?.id ? state.bannerData : null),
        bio: message.includeProfiles ? cleanBio(member.bio || previous?.bio || "") : previous?.bio || (peerId === state.peer?.id ? cleanBio(state.profileBio) : ""),
        presence: normalizePresence(member.presence || previous?.presence || (peerId === state.peer?.id ? state.presenceStatus : DEFAULT_PRESENCE)),
        offlineSnapshot: Boolean(member.offlineSnapshot),
      };
    });
    const self = state.members.find((member) => member.peerId === state.peer?.id);
    if (self) { self.clientId = self.clientId || state.clientId; state.inVoice = self.inVoice; state.serverMuted = self.serverMuted; applyLocalAudioState(); }
    if (state.serverBinding && state.serverBinding.serverName !== state.server.name) saveServerBinding({ ...state.serverBinding, serverName: state.server.name });
    const previousScreenIds = new Set(state.activeScreens.keys());
    const announcedScreens = Array.isArray(message.activeScreens) ? message.activeScreens : (message.activeScreen ? [message.activeScreen] : []);
    state.activeScreens = new Map(announcedScreens.map((screen) => [String(screen.peerId || ""), { peerId: String(screen.peerId || ""), name: cleanNickname(screen.name || memberName(screen.peerId) || "Amigo") || "Amigo" }]).filter(([peerId]) => peerId));
    state.activeScreen = state.activeScreens.values().next().value || null;
    if (!state.inVoice && state.screenStream) stopScreenShare();
    previousScreenIds.forEach((peerId) => { if (!state.activeScreens.has(peerId) && peerId !== state.peer?.id) clearScreenStage(peerId); });
    ensureValidView(); renderServerUI(); renderMembers(); renderVoiceGrid(); renderScreenStage(); updateControlState();
    if (elements.serverDialog.open) renderServerSettings(); if (elements.memberDialog.open) renderMemberDialog();
    if (message.includeProfiles) renderChatHistory(); reconcileVoiceCalls(); reconcileScreenCalls();
  }
}


function removeGuest(peerId) {
  state.pendingGuestProfiles.delete(peerId); const member = state.hostMembers.get(peerId); if (!state.hostMembers.has(peerId)) return;
  if (member) rememberMember(member);
  state.guestConnections.delete(peerId); state.hostMembers.delete(peerId); state.members = Array.from(state.hostMembers.values()); closeCallsForPeer(peerId);
  state.activeScreens.delete(peerId); state.activeScreen = state.activeScreens.values().next().value || null; clearScreenStage(peerId);
  broadcastRoster(false); scheduleServerPersistence(); if (member) toast(`${member.name} ficou offline.`);
}


function registryOfflineMember(record) {
  const clientId = sanitizeClientId(record?.clientId);
  if (!clientId) return null;
  return {
    peerId: `offline-${clientId}`.slice(0, 120),
    clientId,
    name: cleanNickname(record?.name || "Amigo") || "Amigo",
    muted: false,
    deafened: false,
    serverMuted: Boolean(record?.serverMuted),
    inVoice: false,
    avatar: sanitizeAvatar(record?.avatar),
    banner: sanitizeProfileBanner(record?.banner),
    bio: cleanBio(record?.bio || ""),
    presence: "offline",
    roleIds: normalizeRoleIds(record?.roleIds || ["membro"]),
    offlineSnapshot: true,
  };
}

function composeRosterMembers() {
  const live = Array.from(state.hostMembers.values());
  const liveClientIds = new Set(live.map((member) => sanitizeClientId(member.clientId)).filter(Boolean));
  const offline = [];
  state.memberRegistry.forEach((record) => {
    if (liveClientIds.has(record.clientId)) return;
    const member = registryOfflineMember(record);
    if (member) offline.push(member);
  });
  return [...live, ...offline];
}


function broadcastRoster(includeProfiles = false) {
  if (!state.isHost) return;
  state.members = composeRosterMembers();
  const payload = { type: "roster", includeProfiles, server: state.server,
    members: state.members.map((member) => ({
      peerId: member.peerId,
      clientId: member.clientId || null,
      name: member.name,
      muted: Boolean(member.muted),
      deafened: Boolean(member.deafened),
      serverMuted: Boolean(member.serverMuted),
      inVoice: Boolean(member.inVoice) && state.server.voiceChannel.exists,
      roleIds: member.roleIds || ["membro"],
      presence: normalizePresence(member.presence),
      offlineSnapshot: Boolean(member.offlineSnapshot),
      ...(includeProfiles ? { bio: member.bio } : {}),
    })),
    activeScreen: state.activeScreens.values().next().value || null,
    activeScreens: Array.from(state.activeScreens.values()) };
  state.guestConnections.forEach((connection) => { if (connection.open) connection.send(payload); });
  ensureValidView(); renderServerUI(); renderMembers(); renderVoiceGrid(); updateControlState(); if (includeProfiles) renderChatHistory(); reconcileVoiceCalls(); reconcileScreenCalls();
}


function requestAdminAction(action, payload = {}) {
  if (!canCurrentUserAdmin()) { toast("Você não tem permissão de administrador.", "error"); return; }
  if (state.isHost) { applyAdminAction(state.peer.id, action, payload); return; }
  if (!state.hostConnection?.open) { toast("O servidor está reconectando. Tente novamente.", "error"); return; }
  state.hostConnection.send({ type: "admin-action", action, payload });
}

function applyAdminAction(requesterPeerId, action, payload = {}) {
  if (!state.isHost || !memberHasAdmin(requesterPeerId)) return;
  const requesterIsOwner = isServerOwner(requesterPeerId);
  let changed = false;
  if (action === "server-name") { state.server.name = cleanServerName(payload.name); changed = true; }
  if (action === "server-icon") { state.server.icon = sanitizeServerIcon(payload.icon); changed = true; }
  if (action === "channel-create") {
    if (payload.kind === "text" && !state.server.textChannel.exists) { state.server.textChannel = { exists: true, name: "chat-principal" }; changed = true; }
    if (payload.kind === "voice" && !state.server.voiceChannel.exists) { state.server.voiceChannel = { exists: true, name: "call" }; changed = true; }
  }
  if (action === "channel-rename") {
    if (payload.kind === "text" && state.server.textChannel.exists) { state.server.textChannel.name = cleanChannelName(payload.name, "chat-principal"); changed = true; }
    if (payload.kind === "voice" && state.server.voiceChannel.exists) { state.server.voiceChannel.name = cleanChannelName(payload.name, "call"); changed = true; }
  }
  if (action === "channel-delete") {
    if (payload.kind === "text" && state.server.textChannel.exists) { state.server.textChannel.exists = false; changed = true; }
    if (payload.kind === "voice" && state.server.voiceChannel.exists) {
      state.server.voiceChannel.exists = false; state.hostMembers.forEach((member) => { member.inVoice = false; }); state.inVoice = false; state.activeScreens.clear(); state.activeScreen = null; clearScreenStage();
      if (state.screenStream) stopScreenShare(); applyLocalAudioState(); changed = true;
    }
  }
  if (action === "role-create") {
    const name = cleanRoleName(payload.name); if (name && state.server.roles.length < 12) { state.server.roles.push({ id: crypto.randomUUID(), name, color: cleanRoleColor(payload.color), admin: Boolean(payload.admin) }); changed = true; }
  }
  if (action === "role-update") {
    const role = state.server.roles.find((item) => item.id === String(payload.roleId));
    if (role) { role.name = cleanRoleName(payload.name) || role.name; role.color = cleanRoleColor(payload.color || role.color); role.admin = role.id === "membro" ? false : Boolean(payload.admin); changed = true; }
  }
  if (action === "role-delete") {
    const roleId = String(payload.roleId || ""); if (roleId && roleId !== "membro" && roleId !== "admin") {
      const before = state.server.roles.length; state.server.roles = state.server.roles.filter((role) => role.id !== roleId);
      if (state.server.roles.length !== before) { state.hostMembers.forEach((member) => { member.roleIds = normalizeRoleIds((member.roleIds || []).filter((id) => id !== roleId)); rememberMember(member); }); state.memberRegistry.forEach((record) => { record.roleIds = normalizeRoleIds((record.roleIds || []).filter((id) => id !== roleId)); }); changed = true; }
    }
  }
  if (action === "member-roles") {
    const target = state.hostMembers.get(String(payload.peerId || ""));
    if (target) {
      if (isServerOwner(target.peerId) && !requesterIsOwner) return;
      target.roleIds = normalizeRoleIds(payload.roleIds); rememberMember(target); changed = true;
    } else {
      const clientId = sanitizeClientId(payload.clientId);
      const record = clientId ? state.memberRegistry.get(clientId) : null;
      if (record) {
        if (clientId === state.server.ownerClientId && !requesterIsOwner) return;
        record.roleIds = normalizeRoleIds(payload.roleIds); record.lastSeenAt = Date.now(); changed = true;
      }
    }
  }
  if (action === "server-mute") {
    const target = state.hostMembers.get(String(payload.peerId || ""));
    if (target && (!isServerOwner(target.peerId) || requesterIsOwner)) { target.serverMuted = Boolean(payload.muted); rememberMember(target); if (target.peerId === state.peer.id) { state.serverMuted = target.serverMuted; applyLocalAudioState(); } changed = true; }
  }
  if (action === "disconnect-voice") {
    const target = state.hostMembers.get(String(payload.peerId || ""));
    if (target && target.inVoice && (!isServerOwner(target.peerId) || requesterIsOwner)) { target.inVoice = false; if (target.peerId === state.peer.id) { state.inVoice = false; applyLocalAudioState(); } state.activeScreens.delete(target.peerId); state.activeScreen = state.activeScreens.values().next().value || null; clearScreenStage(target.peerId); changed = true; }
  }
  if (action === "kick-server") {
    const targetPeerId = String(payload.peerId || "");
    const requestedClientId = sanitizeClientId(payload.clientId);
    const target = state.hostMembers.get(targetPeerId) || [...state.hostMembers.values()].find((member) => requestedClientId && member.clientId === requestedClientId) || null;
    const targetClientId = sanitizeClientId(target?.clientId || requestedClientId);
    const record = targetClientId ? state.memberRegistry.get(targetClientId) : null;
    const targetName = cleanNickname(target?.name || record?.name || "Membro") || "Membro";
    if (!targetClientId && !target) return;
    if (target?.peerId === requesterPeerId || targetClientId === sanitizeClientId(state.hostMembers.get(requesterPeerId)?.clientId)) return;
    if (targetClientId && targetClientId === state.server.ownerClientId) return;
    if (target && isServerOwner(target.peerId)) return;

    if (targetClientId) {
      state.revokedClientIds.add(targetClientId);
      state.memberRegistry.delete(targetClientId);
      void Promise.resolve(window.resenhazinhaDesktop?.deleteMemberProfile?.(targetClientId)).catch(() => undefined);
    }

    if (target) {
      const connection = state.guestConnections.get(target.peerId);
      if (connection?.open) connection.send({ type: "server-kicked", serverName: state.server.name });
      state.pendingGuestProfiles.delete(target.peerId);
      state.guestConnections.delete(target.peerId);
      state.hostMembers.delete(target.peerId);
      closeCallsForPeer(target.peerId);
      state.activeScreens.delete(target.peerId);
      state.activeScreen = state.activeScreens.values().next().value || null;
      clearScreenStage(target.peerId);
      window.setTimeout(() => { try { connection?.close(); } catch (_error) {} }, 120);
    }

    toast(`${targetName} foi expulso do servidor.`);
    changed = true;
  }
  if (!changed) return; state.server = sanitizeServer(state.server); state.server.ownerClientId = state.server.ownerClientId || state.clientId; state.server.ownerPeerId = state.peer?.id || state.server.ownerPeerId; if (state.serverBinding) saveServerBinding({ ...state.serverBinding, serverName: state.server.name }); broadcastRoster(true); scheduleServerPersistence(); if (elements.serverDialog.open) renderServerSettings(); if (elements.memberDialog.open) renderMemberDialog();
}

function createRoleFromSettings() {
  const name = cleanRoleName(elements.roleNameInput.value); if (!name) { toast("Dê um nome para o cargo.", "error"); return; }
  requestAdminAction("role-create", { name, color: elements.roleColorInput.value, admin: elements.roleAdminInput.checked }); elements.roleNameInput.value = ""; elements.roleAdminInput.checked = false;
}
function openServerSettings() { if (!canCurrentUserAdmin()) return; renderServerSettings(); elements.serverDialog.showModal(); }
async function chooseServerIcon() {
  if (!window.resenhazinhaDesktop?.chooseServerIcon) { toast("A foto do servidor está disponível no aplicativo para Windows."); return; }
  try {
    const result = await window.resenhazinhaDesktop.chooseServerIcon();
    if (result?.canceled) return;
    const icon = sanitizeServerIcon(result?.icon);
    if (!icon) { toast("Não consegui usar essa imagem no servidor.", "error"); return; }
    requestAdminAction("server-icon", { icon });
  } catch (_error) { toast("Não consegui abrir essa imagem.", "error"); }
}
function renderServerSettings() {
  elements.serverNameSettings.value = state.server.name;
  paintAvatar(elements.serverIconPreview, state.server.name, state.server.icon);
  elements.removeServerIconButton.hidden = !state.server.icon;
  elements.textChannelSettingRow.hidden = !state.server.textChannel.exists; elements.createTextChannelSettingsButton.hidden = state.server.textChannel.exists; elements.textChannelSettings.value = state.server.textChannel.name;
  elements.voiceChannelSettingRow.hidden = !state.server.voiceChannel.exists; elements.createVoiceChannelSettingsButton.hidden = state.server.voiceChannel.exists; elements.voiceChannelSettings.value = state.server.voiceChannel.name; renderRoleSettings();
}
function renderRoleSettings() {
  elements.roleList.replaceChildren();
  state.server.roles.forEach((role) => {
    const row = document.createElement("div"); row.className = "role-setting-row";
    const dot = document.createElement("span"); dot.className = "role-color-dot"; dot.style.background = role.color;
    const name = document.createElement("input"); name.maxLength = 20; name.value = role.name;
    const color = document.createElement("input"); color.type = "color"; color.value = role.color; color.setAttribute("aria-label", `Cor de ${role.name}`);
    const admin = document.createElement("label"); admin.className = "admin-check"; const adminBox = document.createElement("input"); adminBox.type = "checkbox"; adminBox.checked = role.admin; adminBox.disabled = role.id === "membro"; admin.append(adminBox, document.createTextNode(" ADM"));
    const save = document.createElement("button"); save.type = "button"; save.className = "mini-button"; save.textContent = "Salvar"; save.addEventListener("click", () => requestAdminAction("role-update", { roleId: role.id, name: name.value, color: color.value, admin: adminBox.checked }));
    row.append(dot, name, color, admin, save);
    if (role.id !== "membro" && role.id !== "admin") { const remove = document.createElement("button"); remove.type = "button"; remove.className = "mini-button mini-button--danger"; remove.textContent = "Excluir"; remove.addEventListener("click", () => requestAdminAction("role-delete", { roleId: role.id })); row.append(remove); }
    elements.roleList.append(row);
  });
}
function openUserSettings() {
  renderUserSettings();
  elements.userDialog.showModal();
  refreshMicrophoneDevices(false);
}

function renderUserSettings() {
  const name = state.nickname || cleanNickname(elements.nicknameInput.value) || "Você";
  elements.userNameSettings.value = name;
  elements.userBioSettings.value = cleanBio(state.profileBio);
  renderPresenceChoices();
  applyBannerSurface(elements.userBannerPreview, state.bannerData, memberDisplayRole(currentSelfMember())?.color || "#6f6b9b");
  paintAvatar(elements.userAvatarPreview, name, state.avatarData);
  elements.userRemoveAvatarButton.hidden = !state.avatarData;
  elements.userRemoveBannerButton.hidden = !state.bannerData;
  elements.appBackgroundBlurRange.value = String(normalizeBackgroundBlur(state.appBackgroundBlur));
  elements.appBackgroundZoomRange.value = String(normalizeBackgroundZoom(state.appBackgroundZoom));
  elements.appFontScaleRange.value = String(normalizeFontScale(state.appFontScale));
  elements.appBackgroundBlurRange.disabled = !state.appBackgroundData;
  elements.appBackgroundZoomRange.disabled = !state.appBackgroundData;
  elements.removeAppBackgroundButton.hidden = !state.appBackgroundData;
  renderBackgroundBlurValue();
  renderAppearanceValues();
  renderThemeChoices();
  renderAppBackgroundPreview();
  elements.noiseSuppressionSelect.value = normalizeNoiseSuppressionLevel(state.noiseSuppressionLevel);
  renderNoiseSuppressionNote();
}

function renderNoiseSuppressionNote() {
  const level = normalizeNoiseSuppressionLevel(elements.noiseSuppressionSelect.value);
  const notes = {
    off: "Desligada mantém apenas cancelamento de eco e ganho automático do sistema.",
    light: "Leve usa a supressão nativa do Windows/Chromium sem filtro extra. É a opção mais natural.",
    medium: "Média usa a supressão nativa e um filtro adicional suave para reduzir ruído quando você não está falando.",
    high: "Alta usa supressão nativa, isolamento de voz quando disponível e um gate mais forte. Pode cortar vozes muito baixas.",
  };
  elements.noiseLevelNote.textContent = notes[level];
}

async function refreshMicrophoneDevices(requestPermission = false) {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  let temporaryStream = null;
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    const hasLabels = devices.some((device) => device.kind === "audioinput" && device.label);
    if (requestPermission && !hasLabels && !state.inVoice) {
      temporaryStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    const inputs = devices.filter((device) => device.kind === "audioinput");
    const selected = state.microphoneDeviceId;
    elements.microphoneDeviceSelect.replaceChildren();
    const automatic = document.createElement("option"); automatic.value = ""; automatic.textContent = "Padrão do sistema"; elements.microphoneDeviceSelect.append(automatic);
    inputs.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Microfone ${index + 1}`;
      elements.microphoneDeviceSelect.append(option);
    });
    elements.microphoneDeviceSelect.value = [...elements.microphoneDeviceSelect.options].some((option) => option.value === selected) ? selected : "";
    if (requestPermission) toast(inputs.length ? `${inputs.length} microfone${inputs.length === 1 ? "" : "s"} encontrado${inputs.length === 1 ? "" : "s"}.` : "Nenhum microfone encontrado.");
  } catch (_error) {
    if (requestPermission) toast("Não consegui listar os microfones. Verifique a permissão do Windows.", "error");
  } finally {
    temporaryStream?.getTracks().forEach((track) => track.stop());
  }
}

async function saveUserSettings() {
  const nextName = cleanNickname(elements.userNameSettings.value);
  if (!nextName) { toast("Escolha um nome para o seu perfil.", "error"); elements.userNameSettings.focus(); return; }
  const previousDevice = state.microphoneDeviceId;
  const previousNoise = state.noiseSuppressionLevel;
  state.nickname = nextName;
  elements.nicknameInput.value = nextName;
  localStorage.setItem("resenhazinha:nickname", nextName);
  elements.selfName.textContent = nextName;
  state.microphoneDeviceId = String(elements.microphoneDeviceSelect.value || "");
  state.noiseSuppressionLevel = normalizeNoiseSuppressionLevel(elements.noiseSuppressionSelect.value);
  state.profileBio = cleanBio(elements.userBioSettings.value);
  state.appBackgroundBlur = normalizeBackgroundBlur(elements.appBackgroundBlurRange.value);
  state.appBackgroundZoom = normalizeBackgroundZoom(elements.appBackgroundZoomRange.value);
  state.appFontScale = normalizeFontScale(elements.appFontScaleRange.value);
  state.appTheme = normalizeTheme(state.appTheme);
  state.presenceStatus = normalizePresence(state.presenceStatus);
  localStorage.setItem(MIC_DEVICE_KEY, state.microphoneDeviceId);
  localStorage.setItem(NOISE_SUPPRESSION_KEY, state.noiseSuppressionLevel);
  await persistProfileTextState();
  applyUiTheme();
  applyFontScale();
  applyAppBackground();
  renderLocalAvatars();
  publishProfile();
  const microphoneChanged = previousDevice !== state.microphoneDeviceId || previousNoise !== state.noiseSuppressionLevel;
  if (state.inVoice && microphoneChanged) {
    elements.saveUserSettingsButton.disabled = true;
    elements.saveUserSettingsButton.textContent = "Aplicando…";
    try {
      await restartMicrophoneStream();
      toast("Perfil e microfone atualizados.");
    } catch (_error) {
      state.microphoneDeviceId = previousDevice;
      state.noiseSuppressionLevel = previousNoise;
      localStorage.setItem(MIC_DEVICE_KEY, previousDevice);
      localStorage.setItem(NOISE_SUPPRESSION_KEY, previousNoise);
      toast("O perfil foi salvo, mas não consegui trocar o microfone agora.", "error");
    } finally {
      elements.saveUserSettingsButton.disabled = false;
      elements.saveUserSettingsButton.textContent = "Salvar configurações";
    }
  } else toast("Configurações salvas.");
  renderMembers(); renderVoiceGrid(); renderServerUI();
  elements.userDialog.close();
}

function closeMemberProfile() {
  closePresencePopover();
  elements.profilePopover.hidden = true;
  state.profilePopoverPeerId = null;
}

function closePresencePopover() {
  if (elements.presencePopover) elements.presencePopover.hidden = true;
}

function openPresencePopover(anchor) {
  if (!elements.presencePopover || !anchor) return;
  renderPresenceChoices();
  elements.presencePopover.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const popover = elements.presencePopover;
  popover.style.visibility = "hidden";
  popover.style.left = "12px";
  popover.style.top = "12px";
  const width = popover.offsetWidth || 286;
  const height = popover.offsetHeight || 238;
  const gap = 8;
  let left = rect.right + gap;
  if (left + width > window.innerWidth - 12) left = rect.left - width - gap;
  let top = rect.top - Math.max(0, height - rect.height);
  left = Math.max(12, Math.min(window.innerWidth - width - 12, left));
  top = Math.max(12, Math.min(window.innerHeight - height - 12, top));
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
  popover.style.visibility = "visible";
}

function openMemberProfile(peerId, anchor, fallbackMessage = null) {
  if (!state.roomEntered) return;
  let member = state.members.find((item) => item.peerId === peerId);
  if (!member && fallbackMessage) {
    member = {
      peerId: String(fallbackMessage.peerId || ""),
      clientId: sanitizeClientId(fallbackMessage.clientId),
      name: cleanNickname(fallbackMessage.name || "Membro") || "Membro",
      avatar: null,
      banner: null,
      bio: "",
      roleIds: normalizeRoleIds(fallbackMessage.roleIds),
      inVoice: false,
      muted: false,
      serverMuted: false,
    };
  }
  if (!member) return;
  state.profilePopoverPeerId = member.peerId;
  renderMemberProfilePopover(member);
  elements.profilePopover.hidden = false;
  positionMemberProfilePopover(anchor);
}

function renderMemberProfilePopover(member) {
  paintAvatar(elements.profileAvatar, member.name, member.avatar);
  elements.profileName.textContent = member.peerId === state.peer?.id ? `${member.name} (você)` : member.name;
  const owner = Boolean((member.clientId && member.clientId === state.server.ownerClientId) || isServerOwner(member.peerId));
  elements.profileOwner.hidden = !owner;
  const presence = normalizePresence(member.presence);
  const basePresence = presenceLabel(presence);
  elements.profileStatus.dataset.presence = presence;
  elements.profileStatus.textContent = member.inVoice
    ? member.serverMuted ? `${basePresence} · na call · mutado pelo servidor` : member.muted ? `${basePresence} · na call · microfone desligado` : `${basePresence} · na call · ${state.server.voiceChannel.name}`
    : `${basePresence} · fora da call`;
  const displayRole = memberVisualRole(member);
  const accent = displayRole?.color || "#6f6b9b";
  elements.profilePopover.style.setProperty("--profile-accent", accent);
  applyBannerSurface(elements.profileBanner, member.banner, accent);
  const bio = cleanBio(member.bio || "");
  elements.profileBioSection.hidden = !bio;
  elements.profileBioText.textContent = bio;
  elements.profileRoles.replaceChildren();
  const roleIds = normalizeRoleIds(member.roleIds);
  const roles = roleIds.map((id) => state.server.roles.find((role) => role.id === id)).filter(Boolean);
  if (!roles.length) {
    const empty = document.createElement("span"); empty.className = "member-profile-no-roles"; empty.textContent = "Nenhum cargo"; elements.profileRoles.append(empty);
  } else {
    roles.forEach((role) => {
      const badge = document.createElement("span"); badge.className = "member-profile-role"; badge.style.setProperty("--role-color", role.color);
      const dot = document.createElement("i"); const text = document.createElement("span"); text.textContent = role.admin ? `${role.name} · ADM` : role.name; badge.append(dot, text); elements.profileRoles.append(badge);
    });
  }
  elements.profileActions.replaceChildren();
  const isSelf = member.peerId === state.peer?.id;
  if (isSelf) {
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "member-profile-action"; edit.textContent = "✎ Editar perfil"; edit.addEventListener("click", () => { closeMemberProfile(); openUserSettings(); }); elements.profileActions.append(edit);
    const statusAction = document.createElement("button"); statusAction.type = "button"; statusAction.className = "member-profile-action member-profile-action--presence"; statusAction.dataset.presence = normalizePresence(state.presenceStatus);
    const dot = document.createElement("i"); dot.className = "profile-presence-dot"; dot.dataset.presence = normalizePresence(state.presenceStatus);
    const label = document.createElement("span"); label.textContent = normalizePresence(state.presenceStatus) === "offline" ? "Invisível" : presenceLabel(state.presenceStatus);
    const chevron = document.createElement("b"); chevron.textContent = "›";
    statusAction.append(dot, label, chevron);
    statusAction.addEventListener("click", (event) => { event.stopPropagation(); openPresencePopover(statusAction); });
    elements.profileActions.append(statusAction);
  } else if (state.members.some((item) => item.peerId === member.peerId)) {
    const manage = document.createElement("button"); manage.type = "button"; manage.className = "member-profile-action"; manage.textContent = canCurrentUserAdmin() ? "Gerenciar membro" : "Ajustar volume"; manage.addEventListener("click", () => { closeMemberProfile(); openMemberDialog(member.peerId); }); elements.profileActions.append(manage);
  }
}

function positionMemberProfilePopover(anchor) {
  const target = anchor instanceof Element ? anchor : elements.memberList;
  const rect = target.getBoundingClientRect();
  const popover = elements.profilePopover;
  popover.style.visibility = "hidden";
  popover.style.left = "12px"; popover.style.top = "12px";
  const width = popover.offsetWidth || 320; const height = popover.offsetHeight || 390; const gap = 10;
  let left = rect.left > window.innerWidth / 2 ? rect.left - width - gap : rect.right + gap;
  let top = rect.top - 20;
  left = Math.max(12, Math.min(window.innerWidth - width - 12, left));
  top = Math.max(12, Math.min(window.innerHeight - height - 12, top));
  popover.style.left = `${Math.round(left)}px`; popover.style.top = `${Math.round(top)}px`; popover.style.visibility = "visible";
}

function closeVoiceContextMenu() {
  state.voiceContextPeerId = null;
  if (elements.voiceContextMenu) elements.voiceContextMenu.hidden = true;
}

function voiceContextMember() {
  return state.members.find((member) => member.peerId === state.voiceContextPeerId) || null;
}

function openVoiceContextMenu(event, peerId) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const member = state.members.find((item) => item.peerId === peerId);
  if (!member) return;
  closeMemberProfile();
  closePresencePopover();
  state.voiceContextPeerId = member.peerId;
  renderVoiceContextMenu();
  elements.voiceContextMenu.hidden = false;
  positionVoiceContextMenu(event?.clientX ?? 12, event?.clientY ?? 12);
}

function positionVoiceContextMenu(clientX, clientY) {
  const menu = elements.voiceContextMenu;
  menu.style.visibility = "hidden";
  menu.style.left = "0px";
  menu.style.top = "0px";
  const width = menu.offsetWidth || 288;
  const height = menu.offsetHeight || 350;
  const gap = 8;
  let left = Number(clientX) + 4;
  let top = Number(clientY) + 4;
  if (left + width + gap > window.innerWidth) left = Number(clientX) - width - 4;
  if (top + height + gap > window.innerHeight) top = window.innerHeight - height - gap;
  left = Math.max(gap, Math.min(window.innerWidth - width - gap, left));
  top = Math.max(gap, Math.min(window.innerHeight - height - gap, top));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.visibility = "visible";
}

function renderVoiceContextMenu() {
  const member = voiceContextMember();
  if (!member) { closeVoiceContextMenu(); return; }
  const isSelf = member.peerId === state.peer?.id;
  const inVoice = Boolean(member.inVoice);
  const volume = getMemberVolume(member.peerId);
  elements.voiceContextProfileButton.textContent = isSelf ? "Editar perfil" : "Perfil";
  elements.voiceContextMentionButton.hidden = isSelf || !state.server.textChannel.exists;
  elements.voiceContextVolumeSection.hidden = isSelf || !inVoice;
  elements.voiceContextAdminSection.hidden = isSelf || !canCurrentUserAdmin();
  if (!isSelf && inVoice) {
    elements.voiceContextVolumeRange.value = String(Math.round(volume * 100));
    elements.voiceContextVolumeValue.textContent = `${Math.round(volume * 100)}%`;
    const locallyMuted = volume <= 0.001;
    elements.voiceContextLocalMuteButton.classList.toggle("is-checked", locallyMuted);
    elements.voiceContextLocalMuteButton.setAttribute("aria-pressed", locallyMuted ? "true" : "false");
    elements.voiceContextLocalMuteButton.querySelector("span").textContent = locallyMuted ? "✓" : "";
  }
  if (!isSelf && canCurrentUserAdmin()) {
    const protectedOwner = isServerOwner(member.peerId) && state.peer?.id !== state.server.ownerPeerId;
    elements.voiceContextRolesButton.disabled = protectedOwner;
    elements.voiceContextServerMuteButton.textContent = member.serverMuted ? "Desmutar voz no servidor" : "Silenciar voz no servidor";
    elements.voiceContextServerMuteButton.disabled = protectedOwner || !inVoice;
    elements.voiceContextDisconnectButton.disabled = protectedOwner || !inVoice;
    elements.voiceContextKickButton.disabled = protectedOwner;
    elements.voiceContextKickButton.title = protectedOwner ? "O Owner é protegido." : member.offlineSnapshot ? "Expulsar este membro offline do servidor" : "Expulsar do servidor";
  }
}

function openVoiceContextProfile() {
  const member = voiceContextMember();
  if (!member) return;
  const peerId = member.peerId;
  const anchor = document.querySelector(`[data-profile-peer="${CSS.escape(peerId)}"]`) || document.querySelector(`[data-speaking-peer="${CSS.escape(peerId)}"]`) || elements.memberList;
  closeVoiceContextMenu();
  if (peerId === state.peer?.id) openUserSettings();
  else openMemberProfile(peerId, anchor);
}

function insertMentionAtCaret(member) {
  if (!member || !state.server.textChannel.exists) return;
  switchView("text");
  window.setTimeout(() => {
    const input = elements.chatInput;
    const mention = `@${member.name} `;
    const value = input.value || "";
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${value.slice(0, start)}${mention}${value.slice(end)}`.slice(0, input.maxLength || 500);
    const caret = Math.min(input.value.length, start + mention.length);
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(caret, caret); } catch (_error) {}
    resizeChatInput();
  }, 0);
}

function mentionVoiceContextMember() {
  const member = voiceContextMember();
  closeVoiceContextMenu();
  insertMentionAtCaret(member);
}

function toggleVoiceContextLocalMute() {
  const member = voiceContextMember();
  if (!member || member.peerId === state.peer?.id) return;
  const current = getMemberVolume(member.peerId);
  if (current <= 0.001) setMemberVolume(member.peerId, state.lastNonZeroMemberVolumes.get(member.peerId) || 1);
  else { state.lastNonZeroMemberVolumes.set(member.peerId, current); setMemberVolume(member.peerId, 0); }
  renderVoiceContextMenu();
}

function openVoiceContextRoles() {
  const member = voiceContextMember();
  if (!member || member.peerId === state.peer?.id || !canCurrentUserAdmin()) return;
  const peerId = member.peerId;
  closeVoiceContextMenu();
  openMemberDialog(peerId);
}

function toggleVoiceContextServerMute() {
  const member = voiceContextMember();
  if (!member || member.peerId === state.peer?.id || !canCurrentUserAdmin()) return;
  requestAdminAction("server-mute", { peerId: member.peerId, muted: !member.serverMuted });
  closeVoiceContextMenu();
}

function disconnectVoiceContextMember() {
  const member = voiceContextMember();
  if (!member || member.peerId === state.peer?.id || !canCurrentUserAdmin()) return;
  requestAdminAction("disconnect-voice", { peerId: member.peerId });
  closeVoiceContextMenu();
}

function kickVoiceContextMember() {
  const member = voiceContextMember();
  if (!member || member.peerId === state.peer?.id || !canCurrentUserAdmin()) return;
  if (isServerOwner(member.peerId)) { toast("O Owner não pode ser expulso por um ADM.", "error"); closeVoiceContextMenu(); return; }
  requestAdminAction("kick-server", { peerId: member.peerId, clientId: member.clientId });
  closeVoiceContextMenu();
}

function openMemberDialog(peerId) { const member = state.members.find((item) => item.peerId === peerId); if (!member || member.peerId === state.peer?.id) return; state.selectedMemberPeerId = member.peerId; renderMemberDialog(); elements.memberDialog.showModal(); }
function renderMemberDialog() {
  const member = state.members.find((item) => item.peerId === state.selectedMemberPeerId); if (!member) { if (elements.memberDialog.open) elements.memberDialog.close(); return; }
  const admin = canCurrentUserAdmin();
  elements.memberDialogName.textContent = member.name; paintAvatar(elements.memberDialogAvatar, member.name, member.avatar);
  const localVolume = getMemberVolume(member.peerId);
  elements.memberVolumeRange.value = String(Math.round(localVolume * 100));
  elements.memberVolumeValue.textContent = `${Math.round(localVolume * 100)}%`;
  elements.memberAudioSection.hidden = !member.inVoice;
  elements.memberModerationSection.hidden = !admin;
  elements.memberRolesSection.hidden = !admin;
  elements.serverMuteMemberButton.textContent = member.serverMuted ? "Desmutar no servidor" : "Mutar no servidor";
  const protectedOwner = isServerOwner(member.peerId) && state.peer?.id !== state.server.ownerPeerId;
  elements.serverMuteMemberButton.disabled = protectedOwner; elements.disconnectMemberButton.disabled = protectedOwner || !member.inVoice; elements.disconnectMemberButton.textContent = member.inVoice ? "Tirar da call" : "Fora da call";
  elements.kickMemberButton.disabled = protectedOwner;
  elements.kickMemberButton.textContent = protectedOwner ? "Owner protegido" : "Expulsar do servidor";
  elements.memberRoleOptions.replaceChildren();
  if (!admin) return;
  const assigned = new Set(member.roleIds || []);
  state.server.roles.forEach((role) => {
    const option = document.createElement("label"); option.className = "member-role-option"; const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = assigned.has(role.id); checkbox.disabled = role.id === "membro" || protectedOwner;
    const dot = document.createElement("span"); dot.className = "role-color-dot"; dot.style.background = role.color; const text = document.createElement("span"); text.textContent = role.admin ? `${role.name} · ADM` : role.name;
    checkbox.addEventListener("change", () => { const next = new Set(member.roleIds || []); if (checkbox.checked) next.add(role.id); else next.delete(role.id); requestAdminAction("member-roles", { peerId: member.peerId, clientId: member.clientId, roleIds: [...next] }); }); option.append(checkbox, dot, text); elements.memberRoleOptions.append(option);
  });
}
function toggleSelectedMemberServerMute() { const member = state.members.find((item) => item.peerId === state.selectedMemberPeerId); if (member) requestAdminAction("server-mute", { peerId: member.peerId, muted: !member.serverMuted }); }
function disconnectSelectedMemberFromVoice() { const member = state.members.find((item) => item.peerId === state.selectedMemberPeerId); if (member) requestAdminAction("disconnect-voice", { peerId: member.peerId }); }
function kickSelectedMemberFromServer() { const member = state.members.find((item) => item.peerId === state.selectedMemberPeerId); if (!member) return; if (isServerOwner(member.peerId)) { toast("O Owner não pode ser expulso por um ADM.", "error"); return; } requestAdminAction("kick-server", { peerId: member.peerId, clientId: member.clientId }); if (elements.memberDialog.open) elements.memberDialog.close(); }

function setPendingChatFiles(files) {
  const next = [...state.pendingChatFiles];
  let rejectedLarge = false;
  for (const file of files || []) {
    if (!(file instanceof File)) continue;
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) { rejectedLarge = true; continue; }
    if (next.length >= MAX_CHAT_ATTACHMENTS) break;
    next.push(file);
  }
  state.pendingChatFiles = next.slice(0, MAX_CHAT_ATTACHMENTS);
  elements.chatFileInput.value = "";
  if (rejectedLarge) toast("Cada arquivo pode ter no máximo 25 MB.", "error");
  if ((files || []).length + next.length > MAX_CHAT_ATTACHMENTS) toast(`Dá para mandar até ${MAX_CHAT_ATTACHMENTS} arquivos por mensagem.`);
  renderPendingChatFiles();
}

function renderPendingChatFiles() {
  elements.chatPendingFiles.replaceChildren();
  elements.chatPendingFiles.hidden = state.pendingChatFiles.length === 0;
  state.pendingChatFiles.forEach((file, index) => {
    const chip = document.createElement("div"); chip.className = "chat-pending-file";
    const icon = document.createElement("span"); icon.className = "chat-pending-file-icon"; icon.textContent = file.type.startsWith("image/") ? "IMG" : file.type.startsWith("video/") ? "VID" : "ARQ";
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = file.name; const size = document.createElement("small"); size.textContent = formatFileSize(file.size); copy.append(name, size);
    const remove = document.createElement("button"); remove.type = "button"; remove.setAttribute("aria-label", `Remover ${file.name}`); remove.textContent = "×"; remove.addEventListener("click", () => { state.pendingChatFiles.splice(index, 1); renderPendingChatFiles(); });
    chip.append(icon, copy, remove); elements.chatPendingFiles.append(chip);
  });
}

function updateChatComposerState() {
  elements.sendChatButton.disabled = state.chatSending;
  elements.chatAttachmentButton.disabled = state.chatSending;
  elements.chatInput.disabled = state.chatSending;
  elements.chatForm.classList.toggle("is-sending", state.chatSending);
}

function getMentionContext() {
  const input = elements.chatInput;
  const value = input.value;
  const caret = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
  const before = value.slice(0, caret);
  const match = /(?:^|\s)@([^@\n]{0,40})$/.exec(before);
  if (!match) return null;
  const query = match[1];
  const start = caret - query.length - 1;
  return { start, end: caret, query: query.trim().toLocaleLowerCase("pt-BR") };
}

function closeMentionMenu() {
  state.mentionMatches = [];
  state.mentionMenuIndex = 0;
  if (elements.mentionMenu) { elements.mentionMenu.hidden = true; elements.mentionMenu.replaceChildren(); }
}

function updateMentionMenu() {
  if (!elements.mentionMenu || state.currentView !== "text" || elements.chatInput.disabled) { closeMentionMenu(); return; }
  const context = getMentionContext();
  if (!context) { closeMentionMenu(); return; }
  const query = context.query;
  const matches = (state.members.length ? state.members : state.peer ? [localMember()] : [])
    .filter((member) => member?.name)
    .filter((member) => !query || member.name.toLocaleLowerCase("pt-BR").includes(query))
    .sort((a, b) => presencePriority(a.presence) - presencePriority(b.presence) || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, 6);
  if (!matches.length) { closeMentionMenu(); return; }
  state.mentionMatches = matches;
  state.mentionMenuIndex = Math.min(state.mentionMenuIndex, matches.length - 1);
  elements.mentionMenu.replaceChildren();
  matches.forEach((member, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mention-suggestion";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === state.mentionMenuIndex ? "true" : "false");
    button.classList.toggle("is-selected", index === state.mentionMenuIndex);
    const avatar = document.createElement("span"); avatar.className = "avatar mention-suggestion-avatar"; paintAvatar(avatar, member.name, member.avatar);
    const copy = document.createElement("span"); copy.className = "mention-suggestion-copy";
    const name = document.createElement("strong"); name.textContent = member.peerId === state.peer?.id ? `${member.name} (você)` : member.name;
    const status = document.createElement("small"); status.textContent = presenceLabel(member.presence); status.dataset.presence = normalizePresence(member.presence);
    copy.append(name, status); button.append(avatar, copy);
    button.addEventListener("pointerdown", (event) => { event.preventDefault(); insertMention(member); });
    elements.mentionMenu.append(button);
  });
  elements.mentionMenu.hidden = false;
}

function insertMention(member) {
  const context = getMentionContext();
  if (!context || !member) return;
  const input = elements.chatInput;
  const mention = `@${member.name} `;
  const value = input.value;
  input.value = `${value.slice(0, context.start)}${mention}${value.slice(context.end)}`.slice(0, input.maxLength || 500);
  const caret = Math.min(input.value.length, context.start + mention.length);
  input.focus({ preventScroll: true });
  try { input.setSelectionRange(caret, caret); } catch (_error) { /* sem problema */ }
  closeMentionMenu();
  resizeChatInput();
}

function handleChatInputKeydown(event) {
  if (!elements.mentionMenu.hidden && state.mentionMatches.length) {
    if (event.key === "ArrowDown") { event.preventDefault(); state.mentionMenuIndex = (state.mentionMenuIndex + 1) % state.mentionMatches.length; updateMentionMenu(); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); state.mentionMenuIndex = (state.mentionMenuIndex - 1 + state.mentionMatches.length) % state.mentionMatches.length; updateMentionMenu(); return; }
    if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insertMention(state.mentionMatches[state.mentionMenuIndex]); return; }
    if (event.key === "Escape") { event.preventDefault(); closeMentionMenu(); return; }
  }
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendChatMessage(); }
}

function mentionCandidatesForText(text) {
  const source = String(text || "");
  const members = state.members.length ? state.members : state.peer ? [localMember()] : [];
  return members
    .filter((member) => member?.name && source.toLocaleLowerCase("pt-BR").includes(`@${member.name}`.toLocaleLowerCase("pt-BR")))
    .sort((a, b) => b.name.length - a.name.length);
}

function messageMentionsCurrentUser(message) {
  if (!message || isSelfChatMessage(message)) return false;
  const self = state.members.find((member) => member.peerId === state.peer?.id) || localMember();
  return Boolean(self?.name && String(message.text || "").toLocaleLowerCase("pt-BR").includes(`@${self.name}`.toLocaleLowerCase("pt-BR")));
}

function appendMessageTextWithMentions(container, text) {
  const source = String(text || "");
  const candidates = mentionCandidatesForText(source);
  if (!source || !candidates.length) { container.textContent = source; return; }
  let index = 0;
  while (index < source.length) {
    let next = null;
    const lower = source.toLocaleLowerCase("pt-BR");
    candidates.forEach((member) => {
      const token = `@${member.name}`;
      const found = lower.indexOf(token.toLocaleLowerCase("pt-BR"), index);
      if (found >= 0 && (!next || found < next.index || (found === next.index && token.length > next.token.length))) next = { index: found, token, member };
    });
    if (!next) { container.append(document.createTextNode(source.slice(index))); break; }
    if (next.index > index) container.append(document.createTextNode(source.slice(index, next.index)));
    const mention = document.createElement("span"); mention.className = "chat-mention"; mention.textContent = source.slice(next.index, next.index + next.token.length); mention.dataset.profilePeer = next.member.peerId; mention.title = `Abrir perfil de ${next.member.name}`;
    mention.addEventListener("click", (event) => openMemberProfile(next.member.peerId, event.currentTarget));
    container.append(mention);
    index = next.index + next.token.length;
  }
}

async function sendChatMessage() {
  const text = normalizeChatText(elements.chatInput.value);
  const files = [...state.pendingChatFiles];
  if (!state.server.textChannel.exists) { toast("Esse servidor não tem um canal de texto agora.", "error"); return; }
  if ((!text && files.length === 0) || !state.peer?.open || state.chatSending) return;
  if (!state.isHost && !state.hostConnection?.open) { toast("O chat está reconectando. Tente de novo em um instante."); return; }

  closeMentionMenu();
  state.chatSending = true; updateChatComposerState();
  try {
    if (files.length === 0) {
      if (state.isHost) acceptChatMessage(state.peer.id, text, []);
      else state.hostConnection.send({ type: "chat-send", text });
    } else {
      const outgoing = await prepareOutgoingChatAttachments(files);
      if (state.isHost) {
        for (const entry of outgoing) {
          const result = await saveChatAttachmentBytes(entry.meta.id, entry.bytes);
          if (!result) throw new Error("save-failed");
        }
        acceptChatMessage(state.peer.id, text, outgoing.map((entry) => entry.meta));
      } else {
        await uploadChatMessageToHost(text, outgoing);
      }
    }
    elements.chatInput.value = "";
    state.pendingChatFiles = [];
    renderPendingChatFiles();
    resizeChatInput();
  } catch (_error) {
    toast("Não consegui enviar esse arquivo. Tente novamente.", "error");
  } finally {
    state.chatSending = false;
    updateChatComposerState();
    focusChatComposer();
  }
}

function focusChatComposer() {
  if (state.currentView !== "text" || !state.server.textChannel.exists) return;
  window.requestAnimationFrame(() => {
    if (elements.chatInput.disabled) return;
    try {
      elements.chatInput.focus({ preventScroll: true });
    } catch (_error) {
      elements.chatInput.focus();
    }
    const end = elements.chatInput.value.length;
    try { elements.chatInput.setSelectionRange(end, end); } catch (_error) { /* textarea ainda está pronto para digitar */ }
  });
}

async function prepareOutgoingChatAttachments(files) {
  const outgoing = [];
  for (const file of files.slice(0, MAX_CHAT_ATTACHMENTS)) {
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) throw new Error("too-large");
    const meta = sanitizeChatAttachmentMeta({ id: crypto.randomUUID(), name: file.name, mimeType: file.type || "application/octet-stream", size: file.size });
    if (!meta) throw new Error("invalid-file");
    const bytes = new Uint8Array(await file.arrayBuffer());
    cacheAttachmentBlob(meta, file);
    outgoing.push({ meta, bytes });
  }
  return outgoing;
}

async function uploadChatMessageToHost(text, outgoing) {
  const connection = state.hostConnection;
  if (!connection?.open) throw new Error("offline");
  const uploadId = crypto.randomUUID();
  connection.send({ type: "chat-upload-start", uploadId, text, attachments: outgoing.map((entry) => entry.meta) });
  let sentChunks = 0;
  for (const entry of outgoing) {
    for (let offset = 0, index = 0; offset < entry.bytes.length; offset += ATTACHMENT_CHUNK_BYTES, index += 1) {
      connection.send({ type: "chat-upload-chunk", uploadId, attachmentId: entry.meta.id, index, data: entry.bytes.slice(offset, Math.min(entry.bytes.length, offset + ATTACHMENT_CHUNK_BYTES)) });
      sentChunks += 1;
      if (sentChunks % 6 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  connection.send({ type: "chat-upload-complete", uploadId });
}

function chatUploadKey(peerId, uploadId) { return `${peerId}:${uploadId}`; }

function beginIncomingChatUpload(peerId, message) {
  if (!state.isHost) return;
  const member = state.hostMembers.get(peerId);
  const uploadId = sanitizeTransferId(message.uploadId);
  const attachments = sanitizeChatAttachments(message.attachments);
  const text = normalizeChatText(message.text);
  if (!member || !uploadId || attachments.length === 0 || (!text && attachments.length === 0)) return;
  if (attachments.some((meta) => attachmentIdExists(meta.id))) { sendChatUploadError(peerId, "duplicate"); return; }
  const key = chatUploadKey(peerId, uploadId);
  if (state.incomingChatUploads.has(key)) return;
  const files = new Map(attachments.map((meta) => [meta.id, { meta, chunks: new Map(), received: 0 }]));
  state.incomingChatUploads.set(key, { peerId, uploadId, text, attachments, files, startedAt: Date.now() });
}

function receiveIncomingChatUploadChunk(peerId, message) {
  if (!state.isHost) return;
  const uploadId = sanitizeTransferId(message.uploadId);
  const attachmentId = sanitizeTransferId(message.attachmentId);
  const index = Number(message.index);
  const upload = state.incomingChatUploads.get(chatUploadKey(peerId, uploadId));
  const file = upload?.files.get(attachmentId);
  const bytes = toUint8Array(message.data);
  if (!upload || !file || !bytes || !Number.isInteger(index) || index < 0 || index > 10_000) return;
  if (file.chunks.has(index)) return;
  if (file.received + bytes.byteLength > file.meta.size || file.received + bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
    state.incomingChatUploads.delete(chatUploadKey(peerId, uploadId)); sendChatUploadError(peerId, "too-large"); return;
  }
  file.chunks.set(index, new Uint8Array(bytes)); file.received += bytes.byteLength;
}

async function finalizeIncomingChatUpload(peerId, message) {
  if (!state.isHost) return;
  const uploadId = sanitizeTransferId(message.uploadId);
  const key = chatUploadKey(peerId, uploadId);
  const upload = state.incomingChatUploads.get(key);
  if (!upload) return;
  state.incomingChatUploads.delete(key);
  const savedIds = [];
  try {
    for (const meta of upload.attachments) {
      const file = upload.files.get(meta.id);
      if (!file || file.received !== meta.size) throw new Error("incomplete");
      const ordered = [...file.chunks.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
      const bytes = new Uint8Array(meta.size); let offset = 0;
      ordered.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
      if (offset !== meta.size || !(await saveChatAttachmentBytes(meta.id, bytes))) throw new Error("save-failed");
      savedIds.push(meta.id);
    }
    acceptChatMessage(peerId, upload.text, upload.attachments);
  } catch (_error) {
    await Promise.all(savedIds.map((id) => deleteStoredChatAttachment(id)));
    sendChatUploadError(peerId, "failed");
  }
}

function sendChatUploadError(peerId, reason) {
  const connection = state.guestConnections.get(peerId);
  if (connection?.open) connection.send({ type: "chat-upload-error", reason });
}

function cleanUploadError(reason) {
  if (reason === "too-large") return "O arquivo passou do limite de 25 MB.";
  if (reason === "duplicate") return "Esse arquivo entrou em conflito com outro envio. Tente novamente.";
  return "Não consegui concluir o envio do arquivo.";
}

function acceptChatMessage(peerId, rawText, rawAttachments = []) {
  if (!state.isHost || !state.server.textChannel.exists) return;
  const member = state.hostMembers.get(peerId); const text = normalizeChatText(rawText); const attachments = sanitizeChatAttachments(rawAttachments);
  if (!member || (!text && attachments.length === 0)) return;
  const message = { id: crypto.randomUUID(), peerId, clientId: member.clientId || null, name: member.name, roleIds: normalizeRoleIds(member.roleIds), text, attachments, sentAt: Date.now(), editedAt: null };
  appendChatMessage(message); broadcastRoomData({ type: "chat-message", message }); scheduleServerPersistence();
}

function clientIdForPeer(peerId) {
  if (peerId === state.peer?.id) return state.clientId;
  return state.hostMembers.get(peerId)?.clientId || "";
}

function peerOwnsChatMessage(peerId, message) {
  if (!message) return false;
  const clientId = clientIdForPeer(peerId);
  if (clientId && message.clientId) return clientId === message.clientId;
  return message.peerId === peerId;
}

function acceptChatEdit(peerId, messageId, rawText) {
  if (!state.isHost) return;
  const id = sanitizeTransferId(messageId); const message = state.chatMessages.find((item) => item.id === id);
  if (!message || !peerOwnsChatMessage(peerId, message)) return;
  const text = normalizeChatText(rawText);
  if (!text && !(message.attachments || []).length) return;
  message.text = text; message.editedAt = Date.now();
  broadcastRoomData({ type: "chat-message-edit", messageId: message.id, text: message.text, editedAt: message.editedAt });
  state.editingMessageId = null; renderChatHistory(); scheduleServerPersistence();
}

async function acceptChatDelete(peerId, messageId) {
  if (!state.isHost) return;
  const id = sanitizeTransferId(messageId); const index = state.chatMessages.findIndex((item) => item.id === id);
  if (index < 0 || !peerOwnsChatMessage(peerId, state.chatMessages[index])) return;
  const [removed] = state.chatMessages.splice(index, 1);
  await deleteMessageAttachments(removed);
  broadcastRoomData({ type: "chat-message-delete", messageId: id });
  if (state.editingMessageId === id) state.editingMessageId = null;
  if (state.pendingDeleteMessageId === id) closeDeleteMessageDialog();
  renderChatHistory(); scheduleServerPersistence();
}

function requestChatEdit(messageId, text) {
  if (state.isHost) acceptChatEdit(state.peer.id, messageId, text);
  else if (state.hostConnection?.open) state.hostConnection.send({ type: "chat-edit", messageId, text });
}

function requestChatDelete(messageId) {
  if (state.isHost) void acceptChatDelete(state.peer.id, messageId);
  else if (state.hostConnection?.open) state.hostConnection.send({ type: "chat-delete", messageId });
}

function applyIncomingChatEdit(message) {
  const id = sanitizeTransferId(message.messageId); const item = state.chatMessages.find((entry) => entry.id === id); if (!item) return;
  const text = normalizeChatText(message.text); if (!text && !(item.attachments || []).length) return;
  item.text = text; item.editedAt = Number(message.editedAt) || Date.now(); if (state.editingMessageId === id) state.editingMessageId = null; renderChatHistory();
}

function applyIncomingChatDelete(messageId) {
  const id = sanitizeTransferId(messageId); const index = state.chatMessages.findIndex((entry) => entry.id === id); if (index < 0) return;
  const [removed] = state.chatMessages.splice(index, 1); releaseMessageAttachmentCache(removed); if (state.editingMessageId === id) state.editingMessageId = null; if (state.pendingDeleteMessageId === id) closeDeleteMessageDialog(); renderChatHistory();
}

function broadcastRoomData(message) {
  state.guestConnections.forEach((connection) => { if (connection.open) connection.send(message); });
}

function appendChatMessage(message) {
  if (state.chatMessages.some((item) => item.id === message.id)) return;
  const previousMessage = state.chatMessages.at(-1) || null;
  state.chatMessages.push(message);
  while (state.chatMessages.length > MAX_CHAT_HISTORY) {
    const removed = state.chatMessages.shift();
    if (state.isHost) void deleteMessageAttachments(removed); else releaseMessageAttachmentCache(removed);
  }
  const incoming = message.clientId ? message.clientId !== state.clientId : message.peerId !== state.peer?.id;
  const mentioned = incoming && messageMentionsCurrentUser(message);
  const doNotDisturb = normalizePresence(state.presenceStatus) === "dnd";
  if (!doNotDisturb) playUiSound("message", mentioned ? 0.58 : 0.42);
  renderChatMessage(message, previousMessage);
  if (mentioned && !doNotDisturb) toast(`${message.name} mencionou você.`);
  if (state.currentView !== "text" && incoming) { state.unreadMessages = Math.min(99, state.unreadMessages + 1); updateChatVisibility(); }
}

function chatMessageIdentity(message) {
  const clientId = sanitizeClientId(message?.clientId);
  if (clientId) return `client:${clientId}`;
  return `peer:${String(message?.peerId || "")}`;
}

function shouldGroupChatMessage(previousMessage, message) {
  if (!previousMessage || !message) return false;
  if (chatMessageIdentity(previousMessage) !== chatMessageIdentity(message)) return false;
  const previousTime = Number(previousMessage.sentAt) || 0;
  const currentTime = Number(message.sentAt) || 0;
  return previousTime > 0 && currentTime >= previousTime && currentTime - previousTime <= CHAT_GROUP_WINDOW_MS;
}

function renderChatHistory() {
  elements.chatMessages.querySelectorAll(".chat-message").forEach((item) => item.remove());
  elements.chatEmpty.hidden = state.chatMessages.length > 0;
  state.chatMessages.forEach((message, index) => renderChatMessage(message, index > 0 ? state.chatMessages[index - 1] : null));
}

function renderChatMessage(message, previousMessage = null) {
  elements.chatEmpty.hidden = true;
  const member = memberForChatMessage(message);
  const grouped = shouldGroupChatMessage(previousMessage, message);
  const item = document.createElement("article"); item.className = "chat-message"; item.dataset.messageId = message.id;
  const isSelfMessage = isSelfChatMessage(message); if (isSelfMessage) item.classList.add("chat-message--self"); if (messageMentionsCurrentUser(message)) item.classList.add("chat-message--mentioned"); if (grouped) item.classList.add("chat-message--grouped");
  if (member) item.addEventListener("contextmenu", (event) => openVoiceContextMenu(event, member.peerId));

  let avatar;
  if (grouped) {
    avatar = document.createElement("span"); avatar.className = "chat-avatar-spacer"; avatar.setAttribute("aria-hidden", "true");
  } else {
    avatar = document.createElement("button"); avatar.type = "button"; avatar.className = "avatar chat-avatar chat-profile-trigger"; avatar.dataset.profilePeer = member?.peerId || message.peerId; avatar.setAttribute("aria-label", `Abrir perfil de ${message.name}`); paintAvatar(avatar, message.name, member?.avatar || null); avatar.addEventListener("click", (event) => openMemberProfile(member?.peerId || message.peerId, event.currentTarget, message));
  }

  const content = document.createElement("div"); content.className = "chat-message-content";
  if (!grouped) {
    const heading = document.createElement("div"); heading.className = "chat-message-heading";
    const name = document.createElement("button"); name.type = "button"; name.className = "chat-author-button"; name.dataset.profilePeer = member?.peerId || message.peerId; name.textContent = isSelfMessage ? `${message.name} (você)` : message.name; const displayRole = memberDisplayRole(member || { roleIds: message.roleIds || [] }); if (displayRole) name.style.color = displayRole.color; name.addEventListener("click", (event) => openMemberProfile(member?.peerId || message.peerId, event.currentTarget, message));
    const time = document.createElement("time"); time.dateTime = new Date(message.sentAt).toISOString(); time.textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(message.sentAt);
    heading.append(name, time);
    if (message.editedAt) { const edited = document.createElement("span"); edited.className = "chat-edited-label"; edited.textContent = "(editado)"; heading.append(edited); }
    if (isSelfMessage) heading.append(createChatMessageActions(message));
    content.append(heading);
  } else if (isSelfMessage) {
    content.append(createChatMessageActions(message));
  }

  if (state.editingMessageId === message.id) content.append(createChatEditBox(message));
  else {
    const body = document.createElement("p"); body.className = "chat-message-text"; appendMessageTextWithMentions(body, message.text); if (!message.text) body.hidden = true;
    if (grouped && message.editedAt && message.text) { const edited = document.createElement("span"); edited.className = "chat-edited-label chat-edited-label--inline"; edited.textContent = " (editado)"; body.append(edited); }
    content.append(body);
  }
  renderChatAttachments(content, message);
  item.append(avatar, content); elements.chatMessages.append(item);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function createChatMessageActions(message) {
  const actions = document.createElement("div"); actions.className = "chat-message-actions";
  const edit = document.createElement("button"); edit.type = "button"; edit.title = "Editar mensagem"; edit.setAttribute("aria-label", "Editar mensagem"); edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"/></svg>'; edit.addEventListener("click", () => { state.editingMessageId = message.id; renderChatHistory(); window.setTimeout(() => document.querySelector(`[data-edit-message="${CSS.escape(message.id)}"]`)?.focus(), 0); });
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "is-danger"; remove.title = "Apagar mensagem"; remove.setAttribute("aria-label", "Apagar mensagem"); remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>'; remove.addEventListener("click", (event) => { if (event.shiftKey) { requestChatDelete(message.id); return; } openDeleteMessageDialog(message); });
  actions.append(edit, remove); return actions;
}

function createChatEditBox(message) {
  const wrap = document.createElement("div"); wrap.className = "chat-edit-wrap";
  const input = document.createElement("textarea"); input.rows = 2; input.maxLength = 500; input.value = message.text; input.dataset.editMessage = message.id;
  const actions = document.createElement("div"); actions.className = "chat-edit-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancelar"; cancel.addEventListener("click", () => { state.editingMessageId = null; renderChatHistory(); });
  const save = document.createElement("button"); save.type = "button"; save.className = "chat-edit-save"; save.textContent = "Salvar"; const submit = () => { const text = normalizeChatText(input.value); if (!text && !(message.attachments || []).length) return; requestChatEdit(message.id, text); if (!state.isHost) { state.editingMessageId = null; renderChatHistory(); } }; save.addEventListener("click", submit); input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } if (event.key === "Escape") { state.editingMessageId = null; renderChatHistory(); } });
  actions.append(cancel, save); wrap.append(input, actions); return wrap;
}

function openDeleteMessageDialog(message) {
  const target = state.chatMessages.find((item) => item.id === message.id) || message;
  state.pendingDeleteMessageId = target.id;
  const member = memberForChatMessage(target);
  paintAvatar(elements.deleteMessagePreviewAvatar, target.name, member?.avatar || null);
  elements.deleteMessagePreviewName.textContent = isSelfChatMessage(target) ? `${target.name} (você)` : target.name;
  elements.deleteMessagePreviewTime.textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(target.sentAt || Date.now());
  const attachmentCount = sanitizeChatAttachments(target.attachments).length;
  const previewText = normalizeChatText(target.text);
  elements.deleteMessagePreviewText.textContent = previewText || (attachmentCount ? `${attachmentCount} anexo${attachmentCount === 1 ? "" : "s"}` : "Mensagem sem texto");
  elements.deleteMessagePreviewText.hidden = false;
  elements.deleteMessagePreviewAttachments.textContent = attachmentCount ? `${attachmentCount} anexo${attachmentCount === 1 ? "" : "s"} será${attachmentCount === 1 ? "" : "ão"} removido${attachmentCount === 1 ? "" : "s"} junto com a mensagem.` : "";
  elements.deleteMessagePreviewAttachments.hidden = !attachmentCount;
  elements.deleteMessageDialog.showModal();
}

function closeDeleteMessageDialog() {
  state.pendingDeleteMessageId = null;
  if (elements.deleteMessageDialog.open) elements.deleteMessageDialog.close();
}

function confirmDeleteMessage() {
  const id = sanitizeTransferId(state.pendingDeleteMessageId);
  closeDeleteMessageDialog();
  if (id) requestChatDelete(id);
}

function renderChatAttachments(container, message) {
  const attachments = sanitizeChatAttachments(message.attachments); if (!attachments.length) return;
  const list = document.createElement("div"); list.className = "chat-attachments";
  attachments.forEach((meta) => {
    const card = document.createElement("div"); card.className = `chat-attachment chat-attachment--${attachmentKind(meta)}`; card.dataset.attachmentId = meta.id;
    const preview = document.createElement("div"); preview.className = "chat-attachment-preview";
    if (attachmentKind(meta) === "file") { const fileIcon = document.createElement("span"); fileIcon.className = "chat-file-icon"; fileIcon.textContent = attachmentExtension(meta.name) || "FILE"; preview.append(fileIcon); }
    else { const loading = document.createElement("div"); loading.className = "chat-attachment-loading"; loading.textContent = "Carregando…"; preview.append(loading); void hydrateAttachmentPreview(meta, preview); }
    const footer = document.createElement("div"); footer.className = "chat-attachment-footer"; const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = meta.name; name.title = meta.name; const size = document.createElement("small"); size.textContent = formatFileSize(meta.size); copy.append(name, size);
    const download = document.createElement("button"); download.type = "button"; download.className = "chat-attachment-download"; download.title = "Baixar arquivo"; download.setAttribute("aria-label", `Baixar ${meta.name}`); download.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>'; download.addEventListener("click", () => void downloadChatAttachment(meta));
    footer.append(copy, download); card.append(preview, footer); list.append(card);
  });
  container.append(list);
}

async function hydrateAttachmentPreview(meta, preview) {
  try {
    const url = await ensureAttachmentUrl(meta); if (!preview.isConnected) return; preview.replaceChildren();
    if (attachmentKind(meta) === "image") { const image = document.createElement("img"); image.src = url; image.alt = meta.name; image.loading = "lazy"; preview.append(image); }
    else { const video = document.createElement("video"); video.src = url; video.controls = true; video.preload = "metadata"; video.playsInline = true; preview.append(video); }
  } catch (_error) { if (preview.isConnected) { preview.replaceChildren(); const failed = document.createElement("span"); failed.className = "chat-attachment-failed"; failed.textContent = "Arquivo indisponível"; preview.append(failed); } }
}

async function downloadChatAttachment(meta) {
  try { const url = await ensureAttachmentUrl(meta); const anchor = document.createElement("a"); anchor.href = url; anchor.download = safeAttachmentName(meta.name); anchor.style.display = "none"; document.body.append(anchor); anchor.click(); anchor.remove(); }
  catch (_error) { toast("Esse arquivo não está disponível agora.", "error"); }
}

function memberForChatMessage(message) {
  return state.members.find((item) => (message.clientId && item.clientId === message.clientId) || item.peerId === message.peerId) || null;
}

function isSelfChatMessage(message) { return message.clientId ? message.clientId === state.clientId : message.peerId === state.peer?.id; }

function toggleChat() { switchView("text"); }


function updateChatVisibility() {
  elements.chatToggleButton.classList.toggle("is-active", state.currentView === "text");
  elements.chatToggleButton.setAttribute("aria-label", state.currentView === "text" ? "Chat aberto" : "Abrir chat");
  elements.chatUnreadBadge.hidden = state.unreadMessages === 0;
  elements.chatUnreadBadge.textContent = state.unreadMessages > 9 ? "9+" : String(state.unreadMessages);
}


function ensureValidView() {
  if (state.currentView === "text" && state.server.textChannel.exists) return;
  if (state.currentView === "voice" && state.server.voiceChannel.exists) return;
  if (state.server.textChannel.exists) state.currentView = "text"; else if (state.server.voiceChannel.exists) state.currentView = "voice"; else state.currentView = "none";
}
function switchView(view) {
  if (view === "text" && !state.server.textChannel.exists) return; if (view === "voice" && !state.server.voiceChannel.exists) return;
  state.currentView = view; if (view === "text") state.unreadMessages = 0; renderServerUI(); updateChatVisibility(); if (view === "text") window.setTimeout(() => { elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight; elements.chatInput.focus(); }, 80);
}
function renderServerUI() {
  ensureValidView(); const admin = canCurrentUserAdmin(); elements.serverNameDisplay.textContent = state.server.name; paintAvatar(elements.serverIconDisplay, state.server.name, state.server.icon); document.title = `${state.server.name} · Resenhazinha`;
  elements.textChannelButton.hidden = !state.server.textChannel.exists; elements.textChannelEmpty.hidden = state.server.textChannel.exists; elements.textChannelName.textContent = state.server.textChannel.name; elements.createTextChannelButton.hidden = !admin || state.server.textChannel.exists;
  elements.voiceChannelButton.hidden = !state.server.voiceChannel.exists; elements.voiceChannelEmpty.hidden = state.server.voiceChannel.exists; elements.voiceChannelName.textContent = state.server.voiceChannel.name; elements.createVoiceChannelButton.hidden = !admin || state.server.voiceChannel.exists;
  elements.serverSettingsButton.hidden = !admin; elements.headerSettingsButton.hidden = !admin;
  elements.textChannelButton.classList.toggle("is-active", state.currentView === "text"); elements.voiceChannelButton.classList.toggle("is-active", state.currentView === "voice");
  elements.textView.hidden = state.currentView !== "text"; elements.voiceView.hidden = state.currentView !== "voice"; elements.chatToggleButton.hidden = state.currentView !== "voice" || !state.server.textChannel.exists;
  if (state.currentView === "text") { elements.contentChannelIcon.textContent = "#"; elements.contentChannelKind.textContent = "CANAL DE TEXTO"; elements.contentChannelTitle.textContent = state.server.textChannel.name; elements.chatInput.placeholder = `Mensagem para #${state.server.textChannel.name}`; }
  else if (state.currentView === "voice") { elements.contentChannelIcon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/></svg>'; elements.contentChannelKind.textContent = "CANAL DE VOZ"; elements.contentChannelTitle.textContent = state.server.voiceChannel.name; }
  else { elements.contentChannelIcon.textContent = "·"; elements.contentChannelKind.textContent = "SERVIDOR"; elements.contentChannelTitle.textContent = "Nenhum canal criado"; }
  renderVoiceMiniList(); updateChatVisibility();
}
function voiceStateIcons(member) {
  const wrap = document.createElement("span");
  wrap.className = "voice-state-icons";
  const micMuted = Boolean(member.serverMuted || member.muted || member.deafened);
  if (micMuted) {
    const mic = document.createElement("span");
    mic.className = "voice-state-icon voice-state-icon--mic";
    mic.title = member.serverMuted ? "Microfone mutado pelo servidor" : "Microfone mutado";
    mic.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M9 9v1a3 3 0 0 0 5.1 2.1M15 7V5a3 3 0 0 0-5.8-1M5 10a7 7 0 0 0 11.9 5M19 10a7 7 0 0 1-.4 2.3M12 17v4M8 21h8"/></svg>';
    wrap.append(mic);
  }
  if (member.deafened) {
    const headphones = document.createElement("span");
    headphones.className = "voice-state-icon voice-state-icon--deafen";
    headphones.title = "Áudio desativado";
    headphones.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M4 14v-2a8 8 0 0 1 2-5.3M9.7 4.3A8 8 0 0 1 20 12v2M18 18v1h1a2 2 0 0 0 2-2v-3h-3v1M6 15v4H5a2 2 0 0 1-2-2v-3h3"/></svg>';
    wrap.append(headphones);
  }
  return wrap;
}

function renderVoiceMiniList() {
  elements.voiceMiniList.replaceChildren();
  if (state.voiceContextPeerId && !state.members.some((member) => member.peerId === state.voiceContextPeerId)) closeVoiceContextMenu();
  if (!state.server.voiceChannel.exists) return;
  state.members.filter((member) => member.inVoice).forEach((member) => {
    const row = document.createElement("div"); row.className = "voice-mini-member"; row.dataset.speakingPeer = member.peerId;
    if (state.speakingPeers.has(member.peerId)) row.classList.add("is-speaking");
    row.addEventListener("contextmenu", (event) => openVoiceContextMenu(event, member.peerId));
    const avatar = document.createElement("span"); avatar.className = "avatar voice-mini-avatar"; paintAvatar(avatar, member.name, member.avatar);
    const name = document.createElement("span"); name.className = "voice-mini-name"; name.textContent = member.name; const role = memberDisplayRole(member); if (role) name.style.color = role.color;
    const states = voiceStateIcons(member);
    row.append(avatar, name, states); elements.voiceMiniList.append(row);
  });
  applySpeakingStateToDom();
}
function renderVoiceGrid() {
  elements.stageEmpty.replaceChildren();
  if (!state.server.voiceChannel.exists) {
    const empty = document.createElement("div"); empty.className = "voice-empty-card"; empty.innerHTML = "<strong>Não existe uma call ainda</strong><span>Um administrador pode criar o canal de voz.</span>"; elements.stageEmpty.append(empty); elements.stageEmpty.hidden = false; return;
  }
  if (!state.inVoice) {
    const empty = document.createElement("div"); empty.className = "voice-empty-card"; const title = document.createElement("strong"); title.textContent = "Você está fora da call"; const copy = document.createElement("span"); copy.textContent = `Entre em ${state.server.voiceChannel.name} para ouvir e falar com a galera.`; const join = document.createElement("button"); join.className = "button button--primary voice-empty-join"; join.type = "button"; join.textContent = "Entrar na call"; join.addEventListener("click", joinVoiceChannel); empty.append(title, copy, join); elements.stageEmpty.append(empty); elements.stageEmpty.hidden = state.screenStreams.size > 0; return;
  }
  const voiceMembers = state.members.filter((member) => member.inVoice);
  if (!voiceMembers.length) {
    const empty = document.createElement("div"); empty.className = "voice-empty-card"; empty.innerHTML = "<strong>A call está vazia</strong><span>Você pode entrar quando quiser.</span>"; elements.stageEmpty.append(empty);
  } else voiceMembers.forEach((member) => {
    const tile = document.createElement("article"); tile.className = "voice-tile"; tile.dataset.speakingPeer = member.peerId;
    if (state.speakingPeers.has(member.peerId)) tile.classList.add("is-speaking");
    const isSelf = member.peerId === state.peer?.id;
    tile.addEventListener("contextmenu", (event) => openVoiceContextMenu(event, member.peerId));
    if (isSelf) tile.classList.add("voice-tile--self");
    else {
      tile.classList.add("voice-tile--adjustable"); tile.tabIndex = 0; tile.title = `Clique para ajustar o volume de ${member.name}`;
      tile.addEventListener("click", () => openMemberDialog(member.peerId));
      tile.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openMemberDialog(member.peerId); } });
    }
    if (member.serverMuted || member.muted || member.deafened) tile.classList.add("voice-tile--muted");
    const avatar = document.createElement("div"); avatar.className = "avatar voice-tile-avatar"; paintAvatar(avatar, member.name, member.avatar);
    const meta = document.createElement("div"); meta.className = "voice-tile-meta";
    const name = document.createElement("strong"); name.textContent = isSelf ? `${member.name} (você)` : member.name; const role = memberDisplayRole(member); if (role) name.style.color = role.color;
    const status = document.createElement("span"); status.textContent = member.deafened ? "Áudio desativado" : member.serverMuted ? "Mutado pelo servidor" : member.muted ? "Microfone desligado" : "Na call";
    meta.append(name, status);
    const states = voiceStateIcons(member); states.classList.add("voice-state-icons--tile");
    tile.append(avatar, meta, states); elements.stageEmpty.append(tile);
  });
  elements.stageEmpty.hidden = state.screenStreams.size > 0;
  applySpeakingStateToDom();
}
function applyLocalAudioState() { const enabled = state.inVoice && !state.muted && !state.serverMuted; state.localStream?.getAudioTracks().forEach((track) => { track.enabled = enabled; }); }

function microphoneAudioConstraints(deviceId = state.microphoneDeviceId, level = state.noiseSuppressionLevel) {
  const normalizedLevel = normalizeNoiseSuppressionLevel(level);
  const supported = navigator.mediaDevices.getSupportedConstraints();
  const constraints = {
    echoCancellation: true,
    noiseSuppression: normalizedLevel !== "off",
    autoGainControl: true,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48_000 },
  };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  if (supported.voiceIsolation && normalizedLevel === "high") constraints.voiceIsolation = true;
  return constraints;
}

async function createMicrophoneCapture() {
  let rawStream;
  try {
    rawStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneAudioConstraints(), video: false });
  } catch (error) {
    if (state.microphoneDeviceId && ["NotFoundError", "OverconstrainedError"].includes(error?.name)) {
      rawStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneAudioConstraints(""), video: false });
    } else throw error;
  }

  const level = normalizeNoiseSuppressionLevel(state.noiseSuppressionLevel);
  if (level === "off" || level === "light" || !window.AudioContext) {
    return { stream: rawStream, rawStream, audioContext: null };
  }

  let context = null;
  try {
    context = new AudioContext({ sampleRate: 48_000 });
    await context.audioWorklet.addModule("./mic-noise-worklet.js");
    await context.resume();
    const source = context.createMediaStreamSource(rawStream);
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = level === "high" ? 90 : 70;
    highpass.Q.value = 0.7;
    const gate = new AudioWorkletNode(context, "resenhazinha-noise-gate", { processorOptions: { level } });
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -30;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    const destination = context.createMediaStreamDestination();
    source.connect(highpass).connect(gate).connect(compressor).connect(destination);
    const processedTrack = destination.stream.getAudioTracks()[0];
    processedTrack.contentHint = "speech";
    return { stream: new MediaStream([processedTrack]), rawStream, audioContext: context };
  } catch (_error) {
    context?.close?.().catch?.(() => undefined);
    return { stream: rawStream, rawStream, audioContext: null };
  }
}

function stopMicrophoneCapture(capture = null) {
  const stream = capture ? capture.stream : state.localStream;
  const rawStream = capture ? capture.rawStream : state.rawMicrophoneStream;
  const context = capture ? capture.audioContext : state.micAudioContext;
  stream?.getTracks().forEach((track) => track.stop());
  if (rawStream && rawStream !== stream) rawStream.getTracks().forEach((track) => track.stop());
  context?.close?.().catch?.(() => undefined);
  if (!capture) { stopSpeakingDetector(state.peer?.id); state.localStream = null; state.rawMicrophoneStream = null; state.micAudioContext = null; }
}

function installMicrophoneCapture(capture) {
  state.localStream = capture.stream;
  state.rawMicrophoneStream = capture.rawStream;
  state.micAudioContext = capture.audioContext;
  applyLocalAudioState();
  if (state.peer?.id) startSpeakingDetector(state.peer.id, state.localStream);
}

async function ensureMicrophoneStream() {
  if (state.localStream?.getAudioTracks().some((track) => track.readyState === "live")) return state.localStream;
  const capture = await createMicrophoneCapture();
  installMicrophoneCapture(capture);
  return state.localStream;
}

async function restartMicrophoneStream() {
  const previous = { stream: state.localStream, rawStream: state.rawMicrophoneStream, audioContext: state.micAudioContext };
  const capture = await createMicrophoneCapture();
  installMicrophoneCapture(capture);
  const newTrack = state.localStream.getAudioTracks()[0] || null;
  const replacements = [];
  state.voiceCalls.forEach((call) => {
    const sender = call.peerConnection?.getSenders?.().find((candidate) => candidate.track?.kind === "audio");
    if (sender && newTrack) replacements.push(sender.replaceTrack(newTrack).catch(() => undefined));
  });
  await Promise.all(replacements);
  stopMicrophoneCapture(previous);
  publishLocalStatus();
}

async function joinVoiceChannel() {
  if (!state.server.voiceChannel.exists || state.inVoice) { if (state.server.voiceChannel.exists) switchView("voice"); return; }
  try {
    await ensureMicrophoneStream();
  } catch (_error) {
    toast("Não consegui acessar o microfone. Libere a permissão para entrar na call.", "error");
    return;
  }
  state.inVoice = true; applyLocalAudioState(); publishLocalStatus(); renderVoiceGrid(); updateControlState(); switchView("voice"); playUiSound("voiceJoin", 0.55); toast(`Você entrou em ${state.server.voiceChannel.name}.`);
}

function leaveVoiceChannel() {
  if (!state.inVoice) { switchView(state.server.textChannel.exists ? "text" : "voice"); return; }
  if (state.screenStream) stopScreenShare();
  if (state.deafened) state.muted = Boolean(state.mutedBeforeDeafen);
  state.deafened = false; state.mutedBeforeDeafen = false;
  state.inVoice = false;
  applyLocalAudioState();
  state.voiceCalls.forEach((call) => call.close()); state.voiceCalls.clear();
  state.screenCallsIn.forEach((call) => call.close()); state.screenCallsIn.clear();
  clearScreenStage();
  elements.audioContainer.replaceChildren();
  stopAllSpeakingDetectors();
  stopMicrophoneCapture();
  publishLocalStatus(); renderVoiceGrid(); updateControlState();
  playUiSound("voiceLeave", 0.55);
  if (state.server.textChannel.exists) switchView("text");
  toast("Você saiu da call e continuou no servidor pelo chat.");
}

function resizeChatInput() {
  elements.chatInput.style.height = "auto";
  elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 96)}px`;
}

function normalizeChatText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").trim().slice(0, 500);
}

function sanitizeTransferId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9-]{12,100}$/i.test(id) ? id : "";
}

function safeAttachmentName(value) {
  const cleaned = String(value || "arquivo").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120);
  return cleaned || "arquivo";
}

function cleanAttachmentMimeType(value) {
  const mime = String(value || "").trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime) ? mime : "application/octet-stream";
}

function sanitizeChatAttachmentMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = sanitizeTransferId(raw.id); const size = Number(raw.size);
  if (!id || !Number.isInteger(size) || size < 0 || size > MAX_CHAT_ATTACHMENT_BYTES) return null;
  return { id, name: safeAttachmentName(raw.name), mimeType: cleanAttachmentMimeType(raw.mimeType || raw.type), size };
}

function sanitizeChatAttachments(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(); const result = [];
  for (const raw of value.slice(0, MAX_CHAT_ATTACHMENTS)) {
    const meta = sanitizeChatAttachmentMeta(raw); if (!meta || seen.has(meta.id)) continue;
    seen.add(meta.id); result.push(meta);
  }
  return result;
}

function attachmentKind(meta) {
  if (meta?.mimeType?.startsWith("image/")) return "image";
  if (meta?.mimeType?.startsWith("video/")) return "video";
  return "file";
}

function attachmentExtension(name) {
  const match = /\.([a-z0-9]{1,7})$/i.exec(String(name || ""));
  return match ? match[1].toUpperCase() : "";
}

function formatFileSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 ** 2)).toFixed(size < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

function attachmentIdExists(id) {
  return state.chatMessages.some((message) => (message.attachments || []).some((attachment) => attachment.id === id));
}

function findAttachmentMeta(id) {
  for (const message of state.chatMessages) {
    const meta = (message.attachments || []).find((attachment) => attachment.id === id);
    if (meta) return meta;
  }
  return null;
}

function toUint8Array(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value.type === "Buffer" && Array.isArray(value.data)) return Uint8Array.from(value.data);
  return null;
}

async function saveChatAttachmentBytes(id, bytes) {
  const cleanId = sanitizeTransferId(id); const data = toUint8Array(bytes);
  if (!cleanId || !data || data.byteLength > MAX_CHAT_ATTACHMENT_BYTES || !window.resenhazinhaDesktop?.saveChatAttachment) return false;
  const result = await window.resenhazinhaDesktop.saveChatAttachment({ id: cleanId, bytes: data });
  return Boolean(result?.saved);
}

async function readStoredChatAttachment(id) {
  const cleanId = sanitizeTransferId(id); if (!cleanId || !window.resenhazinhaDesktop?.readChatAttachment) return null;
  const result = await window.resenhazinhaDesktop.readChatAttachment(cleanId); if (!result?.found) return null;
  const bytes = toUint8Array(result.bytes); return bytes && bytes.byteLength <= MAX_CHAT_ATTACHMENT_BYTES ? new Uint8Array(bytes) : null;
}

async function deleteStoredChatAttachment(id) {
  const cleanId = sanitizeTransferId(id); if (!cleanId || !window.resenhazinhaDesktop?.deleteChatAttachment) return;
  await window.resenhazinhaDesktop.deleteChatAttachment(cleanId).catch(() => undefined);
}

function cacheAttachmentBlob(meta, value) {
  const cleanMeta = sanitizeChatAttachmentMeta(meta); if (!cleanMeta) return null;
  const previous = state.attachmentCache.get(cleanMeta.id); if (previous?.url) URL.revokeObjectURL(previous.url);
  let blob;
  if (value instanceof Blob) blob = value;
  else { const bytes = toUint8Array(value); if (!bytes) return null; blob = new Blob([bytes], { type: cleanMeta.mimeType }); }
  const url = URL.createObjectURL(blob); state.attachmentCache.set(cleanMeta.id, { url, blob, meta: cleanMeta });
  resolveAttachmentWaiters(cleanMeta.id, url); return url;
}

function waitForAttachment(id) {
  return new Promise((resolve, reject) => {
    const waiters = state.attachmentWaiters.get(id) || []; const waiter = { resolve, reject }; waiters.push(waiter); state.attachmentWaiters.set(id, waiters);
    window.setTimeout(() => {
      const active = state.attachmentWaiters.get(id) || []; const index = active.indexOf(waiter); if (index >= 0) active.splice(index, 1);
      if (active.length) state.attachmentWaiters.set(id, active); else state.attachmentWaiters.delete(id);
      reject(new Error("attachment-timeout"));
    }, 20_000);
  });
}

function resolveAttachmentWaiters(id, url) {
  state.attachmentRequests.delete(id); const waiters = state.attachmentWaiters.get(id) || []; state.attachmentWaiters.delete(id); waiters.forEach((waiter) => waiter.resolve(url));
}

function rejectAttachmentWaiters(id) {
  state.attachmentRequests.delete(id); const waiters = state.attachmentWaiters.get(id) || []; state.attachmentWaiters.delete(id); waiters.forEach((waiter) => waiter.reject(new Error("attachment-unavailable")));
}

async function ensureAttachmentUrl(meta) {
  const cleanMeta = sanitizeChatAttachmentMeta(meta); if (!cleanMeta) throw new Error("invalid-attachment");
  const cached = state.attachmentCache.get(cleanMeta.id); if (cached?.url) return cached.url;
  const promise = waitForAttachment(cleanMeta.id);
  if (!state.attachmentRequests.has(cleanMeta.id)) {
    state.attachmentRequests.add(cleanMeta.id);
    if (state.isHost) {
      void readStoredChatAttachment(cleanMeta.id).then((bytes) => { if (bytes) cacheAttachmentBlob(cleanMeta, bytes); else rejectAttachmentWaiters(cleanMeta.id); }).catch(() => rejectAttachmentWaiters(cleanMeta.id));
    } else if (state.hostConnection?.open) state.hostConnection.send({ type: "attachment-request", attachmentId: cleanMeta.id });
    else rejectAttachmentWaiters(cleanMeta.id);
  }
  return promise;
}

async function sendAttachmentToGuest(peerId, rawAttachmentId) {
  if (!state.isHost) return;
  const id = sanitizeTransferId(rawAttachmentId); const meta = findAttachmentMeta(id); const connection = state.guestConnections.get(peerId);
  if (!id || !meta || !connection?.open) return;
  const bytes = await readStoredChatAttachment(id);
  if (!bytes) { connection.send({ type: "attachment-data-complete", attachmentId: id, error: true }); return; }
  connection.send({ type: "attachment-data-start", attachment: meta });
  let index = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += ATTACHMENT_CHUNK_BYTES, index += 1) {
    connection.send({ type: "attachment-data-chunk", attachmentId: id, index, data: bytes.slice(offset, Math.min(bytes.byteLength, offset + ATTACHMENT_CHUNK_BYTES)) });
    if (index % 6 === 5) await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  connection.send({ type: "attachment-data-complete", attachmentId: id });
}

function beginAttachmentDownload(message) {
  const meta = sanitizeChatAttachmentMeta(message.attachment); if (!meta || state.attachmentCache.has(meta.id)) return;
  state.incomingAttachmentDownloads.set(meta.id, { meta, chunks: new Map(), received: 0 });
}

function receiveAttachmentDownloadChunk(message) {
  const id = sanitizeTransferId(message.attachmentId); const download = state.incomingAttachmentDownloads.get(id); const bytes = toUint8Array(message.data); const index = Number(message.index);
  if (!download || !bytes || !Number.isInteger(index) || index < 0 || download.chunks.has(index)) return;
  if (download.received + bytes.byteLength > download.meta.size) { state.incomingAttachmentDownloads.delete(id); rejectAttachmentWaiters(id); return; }
  download.chunks.set(index, new Uint8Array(bytes)); download.received += bytes.byteLength;
}

function finishAttachmentDownload(message) {
  const id = sanitizeTransferId(message.attachmentId);
  if (message.error) { state.incomingAttachmentDownloads.delete(id); rejectAttachmentWaiters(id); return; }
  const download = state.incomingAttachmentDownloads.get(id); if (!download || download.received !== download.meta.size) { rejectAttachmentWaiters(id); return; }
  state.incomingAttachmentDownloads.delete(id); const ordered = [...download.chunks.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]); const bytes = new Uint8Array(download.meta.size); let offset = 0; ordered.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  if (offset !== download.meta.size) { rejectAttachmentWaiters(id); return; } cacheAttachmentBlob(download.meta, bytes);
}

async function deleteMessageAttachments(message) {
  const attachments = sanitizeChatAttachments(message?.attachments); releaseMessageAttachmentCache(message);
  await Promise.all(attachments.map((meta) => deleteStoredChatAttachment(meta.id)));
}

function releaseMessageAttachmentCache(message) {
  sanitizeChatAttachments(message?.attachments).forEach((meta) => { const cached = state.attachmentCache.get(meta.id); if (cached?.url) URL.revokeObjectURL(cached.url); state.attachmentCache.delete(meta.id); rejectAttachmentWaiters(meta.id); });
}

function sanitizeIncomingChatMessage(message) {
  if (!message || typeof message !== "object") return null;
  const text = normalizeChatText(message.text); const attachments = sanitizeChatAttachments(message.attachments); const name = cleanNickname(message.name || "Amigo") || "Amigo";
  const id = sanitizeTransferId(message.id); if ((!text && attachments.length === 0) || !id) return null;
  const sentAt = Number.isFinite(message.sentAt) && message.sentAt > 0 && message.sentAt < Date.now() + 86_400_000 ? message.sentAt : Date.now();
  const editedAt = Number.isFinite(message.editedAt) && message.editedAt >= sentAt && message.editedAt < Date.now() + 86_400_000 ? message.editedAt : null;
  return { id, peerId: String(message.peerId || "unknown").slice(0, 100), clientId: sanitizeClientId(message.clientId), name, roleIds: normalizeRoleIds(message.roleIds), text, attachments, sentAt, editedAt };
}

function localMember() {
  const member = memberFrom(state.peer.id, state.nickname, state.muted, state.avatarData, state.clientId, state.bannerData, state.profileBio, state.presenceStatus); member.deafened = state.deafened; member.serverMuted = state.serverMuted; member.inVoice = state.inVoice && state.server.voiceChannel.exists; const remembered = registryRecordFor(state.clientId); member.roleIds = state.isHost ? normalizeRoleIds([...(remembered?.roleIds || ["membro"]), "admin"]) : normalizeRoleIds(remembered?.roleIds || ["membro"]); return member;
}


function memberFrom(peerId, name, muted = false, avatar = null, clientId = "", banner = null, bio = "", presence = DEFAULT_PRESENCE) { return { peerId, clientId: sanitizeClientId(clientId), name, muted: Boolean(muted), deafened: false, serverMuted: false, inVoice: false, avatar, banner: sanitizeProfileBanner(banner), bio: cleanBio(bio), presence: normalizePresence(presence), roleIds: ["membro"] }; }


function openRoomView() {
  state.roomEntered = true; setLobbyBusy(false); elements.lobbyView.hidden = true; elements.roomView.hidden = false; elements.roomCodeDisplay.textContent = state.roomCode; elements.selfName.textContent = state.nickname; state.inVoice = false; renderLocalAvatars(); setConnectionState("Conectado", "ok"); applyLocalAudioState(); ensureValidView(); renderServerUI(); updateControlState(); renderMembers(); renderVoiceGrid();
}


function memberSidebarGroup(member) {
  const role = memberVisualRole(member) || state.server.roles.find((entry) => entry.id === "membro") || null;
  return {
    id: role?.id || "membro",
    label: role?.name || "Membro",
    color: role?.color || "#8f949e",
  };
}

function roleGroupOrder(groupId) {
  const index = state.server.roles.findIndex((role) => role.id === groupId);
  if (groupId === "admin") return -100;
  if (groupId === "membro") return 10_000;
  return index >= 0 ? index : 9_000;
}

function appendMemberSidebarItem(member, admin) {
  const isSelf = member.peerId === state.peer?.id;
  const presence = normalizePresence(member.presence);
  const item = document.createElement("li"); item.className = "member-item server-member-item member-profile-trigger"; item.dataset.profilePeer = member.peerId; item.dataset.presence = presence; item.tabIndex = 0; item.setAttribute("role", "button"); item.setAttribute("aria-label", `Abrir perfil de ${member.name}`);
  if (isSelf) item.classList.add("member-item--self"); if (member.inVoice) item.classList.add("member-item--in-voice"); if (state.activeScreens.has(member.peerId)) item.classList.add("member-item--sharing"); if (presence === "offline") item.classList.add("member-item--offline");
  item.addEventListener("click", (event) => { if (!event.target.closest(".member-manage-button")) openMemberProfile(member.peerId, item); });
  item.addEventListener("contextmenu", (event) => openVoiceContextMenu(event, member.peerId));
  item.addEventListener("keydown", (event) => { if ((event.key === "Enter" || event.key === " ") && !event.target.closest(".member-manage-button")) { event.preventDefault(); openMemberProfile(member.peerId, item); } });

  const avatarWrap = document.createElement("div"); avatarWrap.className = "member-avatar-wrap"; const avatar = document.createElement("div"); avatar.className = "avatar"; paintAvatar(avatar, member.name, member.avatar); const onlineDot = document.createElement("i"); onlineDot.className = "member-online-dot"; onlineDot.dataset.presence = presence; onlineDot.title = presenceLabel(presence); avatarWrap.append(avatar, onlineDot);
  const copy = document.createElement("div"); copy.className = "member-copy"; const heading = document.createElement("div"); heading.className = "member-name-line"; const name = document.createElement("strong"); name.textContent = `${member.name}${isSelf ? " (você)" : ""}`; const displayRole = memberVisualRole(member); if (displayRole) name.style.color = displayRole.color; heading.append(name);
  if (isServerOwner(member.peerId) || (member.clientId && member.clientId === state.server.ownerClientId)) heading.append(createOwnerCrown());
  const status = document.createElement("span"); status.className = "member-presence-line"; status.dataset.presence = presence;
  if (state.activeScreens.has(member.peerId)) status.textContent = `${presenceLabel(presence)} · compartilhando a tela`; else if (!member.inVoice) status.textContent = presenceLabel(presence); else if (member.deafened) status.textContent = `${presenceLabel(presence)} · na call, áudio desativado`; else if (member.serverMuted) status.textContent = `${presenceLabel(presence)} · mutado pelo servidor`; else if (member.muted) status.textContent = `${presenceLabel(presence)} · na call, mutado`; else status.textContent = `${presenceLabel(presence)} · na call`;
  const badges = document.createElement("div"); badges.className = "member-role-badges"; (member.roleIds || []).filter((id) => id !== "membro").concat((member.roleIds || []).includes("membro") ? ["membro"] : []).slice(0, 2).forEach((roleId) => { const role = state.server.roles.find((entry) => entry.id === roleId); if (!role) return; const badge = document.createElement("span"); badge.className = "member-role-badge"; badge.style.setProperty("--role-color", role.color); badge.textContent = role.name; badges.append(badge); });
  copy.append(heading, status, badges); item.append(avatarWrap, copy);
  if (!isSelf) {
    const manage = document.createElement("button"); manage.type = "button"; manage.className = "member-manage-button"; manage.setAttribute("aria-label", admin ? `Gerenciar ${member.name}` : `Ajustar áudio de ${member.name}`); manage.title = admin ? "Gerenciar membro e áudio" : "Ajustar volume"; manage.textContent = "•••";
    manage.addEventListener("click", (event) => { event.stopPropagation(); openMemberDialog(member.peerId); }); item.append(manage);
  }
  elements.memberList.append(item);
}

function appendMemberGroupHeading(label, count, color = null, offline = false) {
  const heading = document.createElement("li"); heading.className = "member-group-heading"; if (offline) heading.classList.add("member-group-heading--offline");
  const labelNode = document.createElement("span"); labelNode.textContent = label; if (color && !offline) labelNode.style.setProperty("--group-color", color);
  const countNode = document.createElement("span"); countNode.className = "member-group-count"; countNode.textContent = `— ${count}`;
  heading.append(labelNode, countNode); elements.memberList.append(heading);
}

function renderMembers() {
  elements.memberList.replaceChildren();
  const members = state.members.length ? [...state.members] : state.peer ? [localMember()] : [];
  members.sort((a, b) => presencePriority(a.presence) - presencePriority(b.presence) || Number(Boolean(b.inVoice)) - Number(Boolean(a.inVoice)) || a.name.localeCompare(b.name, "pt-BR"));
  const onlineMembers = members.filter((member) => normalizePresence(member.presence) !== "offline");
  const offlineMembers = members.filter((member) => normalizePresence(member.presence) === "offline");
  elements.memberCount.textContent = String(members.length);
  elements.onlineCount.textContent = `${onlineMembers.length} online`;
  const admin = canCurrentUserAdmin();

  const groups = new Map();
  onlineMembers.forEach((member) => {
    const group = memberSidebarGroup(member);
    if (!groups.has(group.id)) groups.set(group.id, { ...group, members: [] });
    groups.get(group.id).members.push(member);
  });
  [...groups.values()]
    .sort((a, b) => roleGroupOrder(a.id) - roleGroupOrder(b.id) || a.label.localeCompare(b.label, "pt-BR"))
    .forEach((group) => {
      appendMemberGroupHeading(group.label, group.members.length, group.color, false);
      group.members.forEach((member) => appendMemberSidebarItem(member, admin));
    });

  if (offlineMembers.length) {
    appendMemberGroupHeading("Offline", offlineMembers.length, null, true);
    offlineMembers.forEach((member) => appendMemberSidebarItem(member, admin));
  }

  const voiceCount = members.filter((member) => member.inVoice).length; const shareCount = state.activeScreens.size;
  elements.callHint.textContent = !state.inVoice ? "Você está fora da call." : shareCount > 1 ? `${shareCount} telas ao vivo · ${voiceCount} pessoas na call.` : shareCount === 1 ? `1 tela ao vivo · ${voiceCount} pessoas na call.` : voiceCount <= 1 ? "Você está sozinho na call." : `${voiceCount} pessoas estão na call.`;
  renderVoiceMiniList();
  syncActivitySoundState();
}

function reconcileVoiceCalls() {
  if (!state.peer?.open || !state.localStream) return; const activeIds = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  state.voiceCalls.forEach((call, peerId) => { if (!activeIds.has(peerId)) { call.close(); state.voiceCalls.delete(peerId); removeRemoteAudio(peerId); } });
  if (!state.inVoice) return;
  state.members.forEach((member) => { if (!member.inVoice || member.peerId === state.peer.id || state.voiceCalls.has(member.peerId)) return; if (state.peer.id.localeCompare(member.peerId) < 0) { const call = state.peer.call(member.peerId, state.localStream, { metadata: { kind: "voice" } }); if (call) registerVoiceCall(call); } });
}


function handleIncomingCall(call) {
  if (call.metadata?.kind === "screen") {
    const sharer = state.members.find((member) => member.peerId === call.peer); if (!state.inVoice || !state.server.voiceChannel.exists || (sharer && !sharer.inVoice)) { call.close(); return; }
    const previousCall = state.screenCallsIn.get(call.peer); if (previousCall && previousCall !== call) previousCall.close();
    call.answer(new MediaStream()); state.screenCallsIn.set(call.peer, call);
    call.on("stream", (stream) => { const name = call.metadata?.sharerName || memberName(call.peer) || "Um amigo"; state.activeScreens.set(call.peer, { peerId: call.peer, name }); state.activeScreen = state.activeScreens.values().next().value || null; showScreenStage(stream, name, false, { peerId: call.peer, quality: call.metadata?.quality, fps: call.metadata?.fps }); renderMembers(); });
    call.on("close", () => { if (state.screenCallsIn.get(call.peer) === call) { state.screenCallsIn.delete(call.peer); state.activeScreens.delete(call.peer); state.activeScreen = state.activeScreens.values().next().value || null; clearScreenStage(call.peer); renderMembers(); } }); call.on("error", () => { if (state.screenCallsIn.get(call.peer) === call) clearScreenStage(call.peer); }); return;
  }
  const caller = state.members.find((member) => member.peerId === call.peer); if (!state.inVoice || !state.server.voiceChannel.exists || (caller && !caller.inVoice) || state.voiceCalls.has(call.peer)) { call.close(); return; }
  call.answer(state.localStream || new MediaStream()); registerVoiceCall(call);
}


function registerVoiceCall(call) {
  state.voiceCalls.set(call.peer, call);
  call.on("stream", (stream) => attachRemoteAudio(call.peer, stream));
  call.on("close", () => {
    if (state.voiceCalls.get(call.peer) === call) state.voiceCalls.delete(call.peer);
    removeRemoteAudio(call.peer);
  });
  call.on("error", () => removeRemoteAudio(call.peer));
}

function clampVolume(value) { return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1)); }
function getMemberVolume(peerId) { return state.memberVolumes.has(peerId) ? clampVolume(state.memberVolumes.get(peerId)) : 1; }
function setMemberVolume(peerId, value) {
  const volume = clampVolume(value);
  state.memberVolumes.set(peerId, volume);
  if (volume > 0.001) state.lastNonZeroMemberVolumes.set(peerId, volume);
  const audio = document.getElementById(`audio-${safeId(peerId)}`);
  if (audio) audio.volume = volume;
  if (state.selectedMemberPeerId === peerId) { elements.memberVolumeRange.value = String(Math.round(volume * 100)); elements.memberVolumeValue.textContent = `${Math.round(volume * 100)}%`; }
  if (state.voiceContextPeerId === peerId && !elements.voiceContextMenu.hidden) {
    elements.voiceContextVolumeRange.value = String(Math.round(volume * 100));
    elements.voiceContextVolumeValue.textContent = `${Math.round(volume * 100)}%`;
    elements.voiceContextLocalMuteButton.classList.toggle("is-checked", volume <= 0.001);
    elements.voiceContextLocalMuteButton.setAttribute("aria-pressed", volume <= 0.001 ? "true" : "false");
  }
}

function attachRemoteAudio(peerId, stream) {
  removeRemoteAudio(peerId);
  const audio = document.createElement("audio");
  audio.id = `audio-${safeId(peerId)}`;
  audio.autoplay = true;
  audio.srcObject = stream;
  audio.volume = getMemberVolume(peerId);
  audio.muted = state.deafened;
  elements.audioContainer.append(audio);
  audio.play().catch(() => undefined);
  startSpeakingDetector(peerId, stream);
}

function removeRemoteAudio(peerId) {
  document.getElementById(`audio-${safeId(peerId)}`)?.remove();
  stopSpeakingDetector(peerId);
}

function toggleMute() {
  if (!state.inVoice) { toast("Entre na call para usar o microfone."); return; }
  if (state.serverMuted) { toast("Você está mutado por um administrador.", "error"); return; }
  if (state.deafened) { toast("Ative o áudio antes de ligar o microfone."); return; }
  state.muted = !state.muted;
  playUiSound(state.muted ? "micMute" : "micUnmute", 0.52);
  applyLocalAudioState(); publishLocalStatus(); updateControlState(); renderMembers(); renderVoiceGrid();
}


function toggleDeafen() {
  if (!state.inVoice) { toast("Entre na call para desativar o áudio."); return; }
  const willDeafen = !state.deafened;
  if (willDeafen) {
    state.mutedBeforeDeafen = Boolean(state.muted);
    state.deafened = true;
    state.muted = true;
  } else {
    state.deafened = false;
    state.muted = Boolean(state.mutedBeforeDeafen);
    state.mutedBeforeDeafen = false;
  }
  playUiSound(willDeafen ? "deafen" : "undeafen", 0.52);
  elements.audioContainer.querySelectorAll("audio").forEach((audio) => { audio.muted = state.deafened; });
  // A transmissão de tela é um áudio separado: deafen afeta somente a voz da call.
  applyLocalAudioState();
  publishLocalStatus();
  updateControlState();
  renderMembers();
  renderVoiceGrid();
  renderScreenStage();
}

function getScreenAudioSetting(peerId) {
  const current = state.screenAudioSettings.get(peerId);
  if (current) return current;
  const setting = { muted: false, volume: 1 };
  state.screenAudioSettings.set(peerId, setting);
  return setting;
}

function setScreenVolume(peerId, value) {
  const entry = state.screenStreams.get(peerId);
  if (!entry || entry.isLocal) return;
  const setting = getScreenAudioSetting(peerId);
  setting.volume = clampVolume(value);
  applyScreenAudioState(peerId);
  const valueLabel = document.querySelector(`[data-screen-volume-value="${CSS.escape(peerId)}"]`);
  if (valueLabel) valueLabel.textContent = `${Math.round(setting.volume * 100)}%`;
}

function toggleScreenAudio(peerId) {
  const entry = state.screenStreams.get(peerId);
  if (!entry || entry.isLocal) return;
  const setting = getScreenAudioSetting(peerId);
  setting.muted = !setting.muted;
  applyScreenAudioState(peerId);
  renderScreenStage();
  toast(setting.muted ? `Áudio da tela de ${entry.name} mutado.` : `Áudio da tela de ${entry.name} ativado.`);
}

function applyScreenAudioState(peerId) {
  const entry = state.screenStreams.get(peerId);
  const video = document.querySelector(`[data-screen-video="${CSS.escape(peerId)}"]`);
  if (!entry || !video) return;
  if (entry.isLocal) { video.muted = true; return; }
  const setting = getScreenAudioSetting(peerId);
  video.volume = clampVolume(setting.volume);
  video.muted = setting.muted || !entry.stream?.getAudioTracks().length;
}

function applyAllScreenAudioStates() {
  state.screenStreams.forEach((_entry, peerId) => applyScreenAudioState(peerId));
  renderScreenStage();
}

function publishLocalStatus() {
  if (!state.peer?.open) return;
  if (state.isHost) {
    const member = state.hostMembers.get(state.peer.id);
    if (member) {
      member.muted = state.muted; member.deafened = state.deafened; member.inVoice = state.inVoice && state.server.voiceChannel.exists; member.serverMuted = state.serverMuted; member.presence = normalizePresence(state.presenceStatus); rememberMember(member);
    }
    broadcastRoster(false); scheduleServerPersistence();
  } else if (state.hostConnection?.open) {
    state.hostConnection.send({ type: "status", muted: state.muted, deafened: state.deafened, inVoice: state.inVoice, presence: normalizePresence(state.presenceStatus) });
    const self = state.members.find((member) => member.peerId === state.peer.id);
    if (self) { self.muted = state.muted; self.deafened = state.deafened; self.inVoice = state.inVoice; self.serverMuted = state.serverMuted; self.presence = normalizePresence(state.presenceStatus); }
    renderMembers(); renderVoiceGrid(); reconcileVoiceCalls();
  }
}


function updateControlState() {
  const micOff = state.muted || state.serverMuted || state.deafened || !state.inVoice;
  elements.micButton.classList.toggle("is-off", micOff); elements.micButton.classList.toggle("is-server-muted", state.serverMuted);
  elements.micButton.disabled = state.serverMuted || state.deafened || !state.inVoice;
  elements.micButton.setAttribute("aria-label", state.serverMuted ? "Mutado pelo servidor" : state.deafened ? "Microfone mutado porque o áudio está desativado" : state.muted ? "Ligar microfone" : "Desligar microfone");
  elements.deafenButton.classList.toggle("is-off", state.deafened); elements.deafenButton.disabled = !state.inVoice; elements.deafenButton.setAttribute("aria-label", state.deafened ? "Ativar áudio da call" : "Desativar áudio da call");
  elements.shareButton.classList.toggle("is-sharing", Boolean(state.screenStream)); elements.shareButton.disabled = !state.inVoice || !state.server.voiceChannel.exists; elements.shareButton.setAttribute("aria-label", state.screenStream ? "Parar compartilhamento" : "Compartilhar tela");
  elements.voiceJoinButton.hidden = state.inVoice || !state.server.voiceChannel.exists; elements.voiceLeaveButton.hidden = !state.inVoice || !state.server.voiceChannel.exists;
  elements.leaveButton.hidden = !state.inVoice || !state.server.voiceChannel.exists; elements.leaveButton.disabled = !state.inVoice; elements.leaveButton.setAttribute("aria-label", "Sair da call e continuar no chat"); elements.leaveButton.title = "Sair da call e continuar no servidor";
  const selfPresence = presenceLabel(state.presenceStatus);
  elements.selfState.textContent = !state.inVoice ? `${selfPresence} · fora da call` : state.deafened ? `${selfPresence} · áudio e microfone desativados` : state.serverMuted ? `${selfPresence} · mutado pelo servidor` : state.muted ? `${selfPresence} · microfone desligado` : `${selfPresence} · microfone ligado`;
  elements.selfState.dataset.presence = normalizePresence(state.presenceStatus);
}


async function handleShareButton() {
  if (!state.inVoice || !state.server.voiceChannel.exists) { toast("Entre na call para compartilhar sua tela."); return; }
  if (state.screenStream) {
    stopScreenShare();
    return;
  }
  if (!window.resenhazinhaDesktop?.listScreenSources) {
    try {
      state.shareQuality = elements.shareQualitySelect.value || state.shareQuality;
      state.shareFps = Number(elements.shareFpsSelect.value) || state.shareFps;
      const stream = await captureDisplayMedia(true);
      beginScreenShare(stream);
    } catch (error) {
      if (error.name !== "NotAllowedError") toast("Não consegui iniciar o compartilhamento.", "error");
    }
    return;
  }

  elements.shareQualitySelect.value = state.shareQuality;
  elements.shareFpsSelect.value = String(state.shareFps);
  updateShareQualityHint();
  elements.sourceGrid.innerHTML = '<div class="source-loading">Buscando suas telas e janelas…</div>';
  elements.sourceDialog.showModal();
  try {
    const sources = await window.resenhazinhaDesktop.listScreenSources();
    state.screenSources = Array.isArray(sources) ? sources : [];
    const availableProcessIds = new Set(
      state.screenSources.filter((source) => source.canMuteAudio).map((source) => source.processId),
    );
    state.excludedAudioProcessIds = new Set(
      [...state.excludedAudioProcessIds].filter((processId) => availableProcessIds.has(processId)),
    );
    state.excludedAudioSourceNames = new Map(
      [...state.excludedAudioProcessIds].map((processId) => {
        const source = state.screenSources.find((item) => item.processId === processId);
        return [processId, source?.name || "Aplicativo"];
      }),
    );
    renderScreenSources(state.screenSources);
    updateAudioExclusionStatus();
  } catch (error) {
    state.screenSources = [];
    elements.sourceGrid.innerHTML = '<div class="source-loading source-loading--error">Não consegui listar as telas abertas.</div>';
    elements.audioExclusionStatus.textContent = "Não foi possível identificar os aplicativos.";
  }
}

function renderScreenSources(sources) {
  elements.sourceGrid.replaceChildren();
  sources.forEach((source) => {
    const card = document.createElement("article");
    card.className = "source-card";
    const isOwnApp = Boolean(source.isOwnApp);
    const isAudioExcluded = source.canMuteAudio
      && (isOwnApp || state.excludedAudioProcessIds.has(source.processId));
    card.classList.toggle("is-audio-excluded", isAudioExcluded);
    card.classList.toggle("is-call-protected", isOwnApp);

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "source-select-button";
    selectButton.setAttribute("aria-label", `Compartilhar ${source.name}`);
    const image = document.createElement("img");
    image.src = source.thumbnail;
    image.alt = "";
    const footer = document.createElement("span");
    if (source.icon) {
      const icon = document.createElement("img");
      icon.src = source.icon;
      icon.alt = "";
      footer.append(icon);
    }
    const name = document.createElement("strong");
    name.textContent = source.name;
    footer.append(name);
    selectButton.append(image, footer);
    selectButton.addEventListener("click", () => captureDesktopSource(source));
    card.append(selectButton);

    if (source.canMuteAudio) {
      const muteButton = document.createElement("button");
      muteButton.type = "button";
      muteButton.className = "source-mute-toggle";
      muteButton.classList.toggle("is-active", isAudioExcluded);
      muteButton.classList.toggle("is-protected", isOwnApp);
      muteButton.setAttribute("aria-pressed", String(isAudioExcluded));
      muteButton.setAttribute(
        "aria-label",
        isOwnApp
          ? "Áudio da call sempre protegido"
          : isAudioExcluded ? `Incluir o áudio de ${source.name}` : `Silenciar o áudio de ${source.name}`,
      );
      muteButton.disabled = isOwnApp;
      muteButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4V5Z"/>
          <path d="m16 9 5 5M21 9l-5 5"/>
        </svg>
        <span>${isOwnApp ? "Call protegida" : isAudioExcluded ? "Silenciado" : "Silenciar áudio"}</span>
      `;
      if (!isOwnApp) muteButton.addEventListener("click", () => toggleSourceAudioExclusion(source));
      card.append(muteButton);
    }

    elements.sourceGrid.append(card);
  });
}

function toggleSourceAudioExclusion(source) {
  if (!source.canMuteAudio || source.isOwnApp) return;
  if (state.excludedAudioProcessIds.has(source.processId)) {
    state.excludedAudioProcessIds.delete(source.processId);
    state.excludedAudioSourceNames.delete(source.processId);
  } else {
    state.excludedAudioProcessIds.add(source.processId);
    state.excludedAudioSourceNames.set(source.processId, source.name);
  }
  renderScreenSources(state.screenSources);
  updateAudioExclusionStatus();
}

function updateAudioExclusionStatus() {
  if (!elements.shareAudioCheckbox.checked) {
    elements.audioExclusionStatus.textContent = "O som do computador não será transmitido.";
    return;
  }
  const extraNames = [...state.excludedAudioSourceNames.values()];
  elements.audioExclusionStatus.textContent = extraNames.length
    ? `Call protegida + sem áudio: ${extraNames.join(", ")}`
    : "Áudio da call sempre protegido.";
}

async function captureDesktopSource(source) {
  state.shareQuality = elements.shareQualitySelect.value || state.shareQuality;
  state.shareFps = Number(elements.shareFpsSelect.value) || state.shareFps;
  elements.sourceDialog.close();
  const includeAudio = elements.shareAudioCheckbox.checked;
  const canFilterAudio = includeAudio
    && Boolean(window.resenhazinhaDesktop?.startFilteredAudioCapture);

  try {
    const sourceSelected = window.resenhazinhaDesktop?.selectScreenSource?.(source.id);
    if (sourceSelected === false) throw new Error("invalid-desktop-source");

    const displayStream = await captureDisplayMedia(includeAudio && !canFilterAudio);
    let stream = displayStream;

    if (canFilterAudio) {
      try {
        const filteredTrack = await createFilteredAudioTrack(
          [...state.excludedAudioProcessIds],
          [...state.excludedAudioSourceNames.values()],
        );
        stream = new MediaStream([...displayStream.getVideoTracks(), filteredTrack]);
      } catch (_error) {
        stopFilteredAudioCapture();
        toast("Não consegui filtrar o som; compartilhei só a imagem para não repetir a call.", "error");
      }
    } else if (includeAudio && displayStream.getAudioTracks().length === 0) {
      toast("A tela foi compartilhada, mas o Windows não liberou o som do computador.");
    }
    beginScreenShare(stream);
  } catch (error) {
    if (error.name !== "NotAllowedError") toast("Não consegui compartilhar essa tela.", "error");
  }
}

async function createFilteredAudioTrack(excludedProcessIds, excludedNames) {
  stopFilteredAudioCapture();
  const audioContext = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });

  try {
    await audioContext.audioWorklet.addModule(
      new URL("./filtered-audio-worklet.js", window.location.href).href,
    );
    const node = new AudioWorkletNode(audioContext, "resenhazinha-pcm-mixer", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    const destination = audioContext.createMediaStreamDestination();
    node.connect(destination);

    state.filteredAudio = { audioContext, node, destination, excludedNames };
    window.resenhazinhaDesktop.onFilteredAudioChunk((payload) => {
      if (state.filteredAudio?.node !== node) return;
      const streamId = String(payload?.processId || "application");
      const chunk = payload?.chunk || payload;
      let bytes;
      if (chunk instanceof Uint8Array) {
        bytes = chunk;
      } else if (chunk?.buffer instanceof ArrayBuffer) {
        bytes = new Uint8Array(chunk.buffer, chunk.byteOffset || 0, chunk.byteLength || chunk.length);
      } else if (Array.isArray(chunk?.data)) {
        bytes = Uint8Array.from(chunk.data);
      }
      if (!bytes?.byteLength) return;
      const pcm = bytes.slice().buffer;
      node.port.postMessage({ streamId, pcm }, [pcm]);
    });

    const result = await window.resenhazinhaDesktop.startFilteredAudioCapture(excludedProcessIds);
    if (!result?.ok) throw new Error(result?.reason || "filtered-audio-unavailable");
    if (audioContext.state === "suspended") await audioContext.resume();

    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error("filtered-audio-track-missing");
    track.contentHint = "music";
    return track;
  } catch (error) {
    stopFilteredAudioCapture();
    throw error;
  }
}

function stopFilteredAudioCapture() {
  window.resenhazinhaDesktop?.clearFilteredAudioChunkListener?.();
  Promise.resolve(window.resenhazinhaDesktop?.stopFilteredAudioCapture?.()).catch(() => undefined);
  const filteredAudio = state.filteredAudio;
  state.filteredAudio = null;
  if (!filteredAudio) return;
  try {
    filteredAudio.node.disconnect();
  } catch (_error) {
    // O nó já pode ter sido desconectado ao encerrar a transmissão.
  }
  filteredAudio.audioContext.close().catch(() => undefined);
}

function shareProfile() {
  const quality = ["720p", "1080p", "1440p"].includes(state.shareQuality) ? state.shareQuality : "1080p";
  const fps = [15, 30, 60].includes(Number(state.shareFps)) ? Number(state.shareFps) : 30;
  const sizes = {
    "720p": { width: 1280, height: 720 },
    "1080p": { width: 1920, height: 1080 },
    "1440p": { width: 2560, height: 1440 },
  };
  const bitrates = {
    "720p": { 15: 2_000_000, 30: 3_500_000, 60: 6_000_000 },
    "1080p": { 15: 3_500_000, 30: 6_000_000, 60: 10_000_000 },
    "1440p": { 15: 6_000_000, 30: 10_000_000, 60: 16_000_000 },
  };
  return { quality, fps, ...sizes[quality], bitrate: bitrates[quality][fps] };
}

function updateShareQualityHint() {
  state.shareQuality = elements.shareQualitySelect.value || state.shareQuality;
  state.shareFps = Number(elements.shareFpsSelect.value) || state.shareFps;
  const profile = shareProfile();
  const mbps = Math.round(profile.bitrate / 100_000) / 10;
  elements.shareQualityHint.textContent = `${profile.quality} · ${profile.fps} FPS · até ~${mbps} Mb/s de vídeo. A qualidade real depende da conexão e da tela/janela compartilhada.`;
}

async function captureDisplayMedia(includeAudio) {
  const profile = shareProfile();
  const audio = includeAudio
    ? {
        suppressLocalAudioPlayback: false,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    : false;

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: profile.width, max: profile.width },
      height: { ideal: profile.height, max: profile.height },
      frameRate: { ideal: profile.fps, max: profile.fps },
    },
    audio,
    systemAudio: includeAudio ? "include" : "exclude",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
  });

  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.contentHint = profile.fps >= 60 ? "motion" : "detail";
    videoTrack.applyConstraints({
      width: { ideal: profile.width, max: profile.width },
      height: { ideal: profile.height, max: profile.height },
      frameRate: { ideal: profile.fps, max: profile.fps },
    }).catch(() => undefined);
  }
  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack && includeAudio) audioTrack.contentHint = "music";
  return stream;
}

function beginScreenShare(stream) {
  state.screenStream = stream;
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.contentHint = shareProfile().fps >= 60 ? "motion" : "detail";
    videoTrack.addEventListener("ended", stopScreenShare, { once: true });
  }
  state.activeScreens.set(state.peer.id, { peerId: state.peer.id, name: state.nickname });
  state.activeScreen = state.activeScreens.values().next().value || null;
  showScreenStage(stream, state.nickname, true, { peerId: state.peer.id, ...shareProfile() });
  announceScreenState(true);
  renderMembers();
  reconcileScreenCalls();
  updateControlState();
  playUiSound("screenStart", 0.52);
  const hasAudio = stream.getAudioTracks().length > 0;
  const profile = shareProfile();
  const extraExcludedNames = state.filteredAudio?.excludedNames || [];
  toast(hasAudio
    ? extraExcludedNames.length
      ? `${profile.quality} · ${profile.fps} FPS com som. A call e ${extraExcludedNames.join(", ")} ficaram de fora.`
      : `${profile.quality} · ${profile.fps} FPS com som. O áudio da call está protegido.`
    : `${profile.quality} · ${profile.fps} FPS sem áudio.`);
}

function tuneScreenCall(call) {
  const profile = shareProfile();
  const apply = () => {
    const pc = call?.peerConnection;
    if (!pc?.getSenders) return;
    const sender = pc.getSenders().find((item) => item.track?.kind === "video");
    if (!sender?.getParameters || !sender?.setParameters) return;
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.encodings[0].maxBitrate = profile.bitrate;
    parameters.encodings[0].maxFramerate = profile.fps;
    parameters.degradationPreference = profile.fps >= 60 ? "maintain-framerate" : "balanced";
    sender.setParameters(parameters).catch(() => undefined);
  };
  window.setTimeout(apply, 0);
  window.setTimeout(apply, 650);
}

function reconcileScreenCalls() {
  if (!state.screenStream || !state.peer?.open || !state.inVoice) return; const activeIds = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  state.screenCallsOut.forEach((call, peerId) => { if (!activeIds.has(peerId)) { call.close(); state.screenCallsOut.delete(peerId); } });
  const profile = shareProfile();
  state.members.forEach((member) => { if (!member.inVoice || member.peerId === state.peer.id || state.screenCallsOut.has(member.peerId)) return; const call = state.peer.call(member.peerId, state.screenStream, { metadata: { kind: "screen", sharerName: state.nickname, quality: profile.quality, fps: profile.fps } }); if (!call) return; state.screenCallsOut.set(member.peerId, call); tuneScreenCall(call); call.on("close", () => state.screenCallsOut.delete(member.peerId)); call.on("error", () => state.screenCallsOut.delete(member.peerId)); });
}


function stopScreenShare() {
  if (!state.screenStream) return;
  const stream = state.screenStream;
  state.screenStream = null;
  stream.getTracks().forEach((track) => track.stop());
  stopFilteredAudioCapture();
  state.screenCallsOut.forEach((call) => call.close());
  state.screenCallsOut.clear();
  state.activeScreens.delete(state.peer?.id);
  state.activeScreen = state.activeScreens.values().next().value || null;
  announceScreenState(false);
  clearScreenStage(state.peer?.id);
  renderMembers();
  updateControlState();
  playUiSound("screenStop", 0.52);
  toast("Compartilhamento encerrado.");
}

function announceScreenState(started) {
  const message = { type: started ? "screen-started" : "screen-stopped" };
  if (state.isHost) {
    if (started) state.activeScreens.set(state.peer.id, { peerId: state.peer.id, name: state.nickname });
    else state.activeScreens.delete(state.peer.id);
    state.activeScreen = state.activeScreens.values().next().value || null;
    broadcastRoster();
  } else if (state.hostConnection?.open) {
    state.hostConnection.send(message);
  }
}

function showScreenStage(stream, ownerName, isLocal, profile = null) {
  const peerId = String(profile?.peerId || (isLocal ? state.peer?.id : "") || "");
  if (!peerId || !stream) return;
  const quality = ["720p", "1080p", "1440p"].includes(profile?.quality) ? profile.quality : null;
  const fps = [15, 30, 60].includes(Number(profile?.fps)) ? Number(profile.fps) : null;
  state.screenStreams.set(peerId, { peerId, stream, name: ownerName || memberName(peerId) || "Amigo", isLocal: Boolean(isLocal), quality, fps });
  if (!state.focusedScreenPeerId || !state.screenStreams.has(state.focusedScreenPeerId)) state.focusedScreenPeerId = peerId;
  renderScreenStage();
}

function setScreenLayout(layout, peerId = null) {
  if (layout === "focus") {
    const target = peerId && state.screenStreams.has(peerId) ? peerId : state.focusedScreenPeerId;
    if (!target) return;
    state.focusedScreenPeerId = target;
    state.screenLayout = "focus";
  } else {
    state.screenLayout = "grid";
  }
  renderScreenStage();
}

function renderScreenStage() {
  if (!elements.screenGallery || !elements.screenGrid || !elements.screenSwitcher) return;
  const entries = Array.from(state.screenStreams.values());
  const hasScreens = entries.length > 0;
  elements.screenGallery.hidden = !hasScreens;
  elements.stageEmpty.hidden = hasScreens;
  elements.screenGrid.replaceChildren();
  elements.screenSwitcher.replaceChildren();
  elements.screenGridButton.classList.toggle("is-active", state.screenLayout === "grid");
  elements.screenGridButton.disabled = entries.length < 2;
  elements.screenGridButton.textContent = entries.length > 1 ? `Ver todas (${entries.length})` : "Ver todas";

  if (!hasScreens) {
    state.focusedScreenPeerId = null;
    state.screenLayout = "grid";
    renderVoiceGrid();
    return;
  }
  if (!state.focusedScreenPeerId || !state.screenStreams.has(state.focusedScreenPeerId)) state.focusedScreenPeerId = entries[0].peerId;
  if (entries.length === 1 && state.screenLayout === "grid") state.focusedScreenPeerId = entries[0].peerId;

  entries.forEach((entry) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "screen-switcher-button";
    tab.classList.toggle("is-active", state.screenLayout === "focus" && state.focusedScreenPeerId === entry.peerId);
    tab.textContent = entry.isLocal ? "Sua tela" : entry.name;
    tab.title = `Focar na tela de ${entry.isLocal ? "você" : entry.name}`;
    tab.addEventListener("click", () => setScreenLayout("focus", entry.peerId));
    elements.screenSwitcher.append(tab);
  });

  const shown = state.screenLayout === "focus"
    ? entries.filter((entry) => entry.peerId === state.focusedScreenPeerId)
    : entries;
  elements.screenGrid.classList.toggle("screen-grid--focus", state.screenLayout === "focus");
  elements.screenGrid.classList.toggle("screen-grid--two", state.screenLayout === "grid" && shown.length === 2);
  elements.screenGrid.classList.toggle("screen-grid--many", state.screenLayout === "grid" && shown.length > 2);

  shown.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "screen-stream-card";
    card.dataset.peerId = entry.peerId;

    const video = document.createElement("video");
    video.className = "screen-stream-video";
    video.dataset.screenVideo = entry.peerId;
    video.autoplay = true; video.playsInline = true;
    video.srcObject = entry.stream;

    const top = document.createElement("div");
    top.className = "screen-stream-top";
    const identity = document.createElement("div"); identity.className = "screen-stream-identity";
    const live = document.createElement("span"); live.className = "screen-live-dot";
    const copy = document.createElement("div");
    const label = document.createElement("small"); label.textContent = entry.isLocal ? "SUA TRANSMISSÃO" : "TRANSMITINDO";
    const owner = document.createElement("strong"); owner.textContent = entry.isLocal ? `${entry.name} (você)` : entry.name;
    copy.append(label, owner); identity.append(live, copy);
    const quality = document.createElement("span"); quality.className = "screen-stream-quality"; quality.textContent = entry.quality && entry.fps ? `${entry.quality} · ${entry.fps} FPS` : "P2P";
    top.append(identity, quality);

    const bottom = document.createElement("div"); bottom.className = "screen-stream-bottom";
    if (entry.isLocal) {
      const localHint = document.createElement("span"); localHint.className = "screen-local-hint"; localHint.textContent = "Seu áudio fica mutado só para você"; bottom.append(localHint);
    } else {
      const setting = getScreenAudioSetting(entry.peerId);
      const hasAudio = Boolean(entry.stream?.getAudioTracks().length);
      const mute = document.createElement("button"); mute.type = "button"; mute.className = "screen-card-mute";
      mute.classList.toggle("is-muted", setting.muted || !hasAudio);
      mute.disabled = !hasAudio;
      mute.textContent = !hasAudio ? "Sem áudio" : setting.muted ? "Ativar som" : "Mutar som";
      mute.addEventListener("click", () => toggleScreenAudio(entry.peerId));
      const range = document.createElement("input"); range.className = "audio-volume-range screen-card-volume"; range.type = "range"; range.min = "0"; range.max = "100"; range.step = "1"; range.value = String(Math.round(setting.volume * 100)); range.disabled = !hasAudio; range.setAttribute("aria-label", `Volume da tela de ${entry.name}`);
      range.addEventListener("input", () => setScreenVolume(entry.peerId, Number(range.value) / 100));
      const volume = document.createElement("span"); volume.className = "audio-volume-value"; volume.dataset.screenVolumeValue = entry.peerId; volume.textContent = `${Math.round(setting.volume * 100)}%`;
      bottom.append(mute, range, volume);
    }
    if (entries.length > 1 && state.screenLayout !== "focus") {
      const focus = document.createElement("button"); focus.type = "button"; focus.className = "screen-card-focus"; focus.textContent = "Focar"; focus.addEventListener("click", () => setScreenLayout("focus", entry.peerId)); bottom.append(focus);
    }
    card.append(video, top, bottom);
    elements.screenGrid.append(card);
    applyScreenAudioState(entry.peerId);
    video.play().catch(() => undefined);
  });
}

function updateScreenAudioControl() { applyAllScreenAudioStates(); }

function clearScreenStage(peerId) {
  if (peerId) {
    const entry = state.screenStreams.get(peerId);
    if (entry) { const video = document.querySelector(`[data-screen-video="${CSS.escape(peerId)}"]`); if (video) video.srcObject = null; }
    state.screenStreams.delete(peerId);
    if (state.focusedScreenPeerId === peerId) state.focusedScreenPeerId = state.screenStreams.keys().next().value || null;
  } else {
    document.querySelectorAll(".screen-stream-video").forEach((video) => { video.srcObject = null; });
    state.screenStreams.clear(); state.focusedScreenPeerId = null; state.screenLayout = "grid";
  }
  renderScreenStage();
}


function closeCallsForPeer(peerId) {
  state.voiceCalls.get(peerId)?.close();
  state.voiceCalls.delete(peerId);
  state.screenCallsOut.get(peerId)?.close();
  state.screenCallsOut.delete(peerId);
  state.screenCallsIn.get(peerId)?.close();
  state.screenCallsIn.delete(peerId);
  state.activeScreens.delete(peerId); state.activeScreen = state.activeScreens.values().next().value || null; clearScreenStage(peerId);
  removeRemoteAudio(peerId);
}

function closeAllMediaCalls() {
  state.voiceCalls.forEach((call) => call.close());
  state.screenCallsOut.forEach((call) => call.close());
  state.screenCallsIn.forEach((call) => call.close());
  state.voiceCalls.clear();
  state.screenCallsOut.clear();
  state.screenCallsIn.clear();
  elements.audioContainer.replaceChildren();
  clearScreenStage();
}

function cleanupMedia() {
  stopFilteredAudioCapture();
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.screenStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  state.screenStream = null;
  state.activeScreens.clear();
  state.screenStreams.clear();
  state.screenAudioSettings.clear();
}

function teardownConnections() {
  stopAllSpeakingDetectors();
  state.activitySoundInitialized = false;
  state.lastVoicePeers = new Set();
  state.lastScreenPeers = new Set();
  window.clearTimeout(state.reconnectTimer); window.clearTimeout(state.persistenceTimer);
  if (state.isHost) persistServerStateNow();
  if (state.screenStream) stopScreenShare();
  closeAllMediaCalls();
  state.hostConnection?.close();
  state.guestConnections.forEach((connection) => connection.close());
  state.guestConnections.clear();
  state.pendingGuestProfiles.clear();
  if (state.peer && !state.peer.destroyed) state.peer.destroy();
  cleanupMedia();
}

function leaveRoom() {
  teardownConnections();
  window.location.reload();
}

async function copyRoomCode() {
  try { if (window.resenhazinhaDesktop?.copyText) await window.resenhazinhaDesktop.copyText(state.roomCode); else await navigator.clipboard.writeText(state.roomCode); toast("Código copiado."); }
  catch (_error) { toast(`Código do servidor: ${state.roomCode}`); }
}


function setLobbyBusy(busy) { elements.createButton.disabled = busy; elements.joinButton.disabled = busy; elements.nicknameInput.disabled = busy; elements.roomInput.disabled = busy; elements.serverNameInput.disabled = busy; elements.randomCodeButton.disabled = busy; }


function setLobbyStatus(message, type = "neutral") {
  elements.lobbyStatus.textContent = message;
  elements.lobbyStatus.dataset.type = type;
}

function setConnectionState(label, tone) {
  elements.connectionPill.className = `connection-pill connection-pill--${tone}`;
  elements.connectionPill.innerHTML = `<i></i> ${escapeHtml(label)}`;
}

function toast(message, type = "normal") {
  const item = document.createElement("div");
  item.className = `toast toast--${type}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  window.setTimeout(() => item.classList.add("toast--visible"), 20);
  window.setTimeout(() => {
    item.classList.remove("toast--visible");
    window.setTimeout(() => item.remove(), 220);
  }, 3200);
}

function memberName(peerId) {
  return state.members.find((member) => member.peerId === peerId)?.name;
}

function initialFor(name) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function avatarTone(name) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return String(hash % 6);
}

function sanitizeAvatar(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 5_600_000) return null;
  return /^data:image\/(?:gif|png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
}

function paintAvatar(container, name, avatar) {
  const safeAvatar = sanitizeAvatar(avatar);
  container.replaceChildren();
  container.dataset.tone = avatarTone(name);
  container.classList.toggle("has-image", Boolean(safeAvatar));
  if (!safeAvatar) {
    container.textContent = initialFor(name);
    return;
  }

  const image = document.createElement("img");
  image.src = safeAvatar;
  image.alt = "";
  image.draggable = false;
  image.addEventListener("error", () => {
    container.classList.remove("has-image");
    container.textContent = initialFor(name);
  }, { once: true });
  container.append(image);
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
