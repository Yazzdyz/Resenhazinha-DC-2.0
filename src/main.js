import Peer from "peerjs";
import "./styles.css";
import {
  CloudConnection,
  buildCloudSocketUrl,
  createCloudOwnerKey,
  sanitizeCloudOwnerKey,
} from "./cloud-control.js";
import {
  CALL_PROTOCOL_VERSION,
  CallSessionManager,
  dedupeMembersByIdentity,
  shouldApplyVoicePresenceSnapshot,
  shouldInitiateVoiceCall,
} from "./call-session-manager.js";

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
const ROLE_BACKUP_KEY_PREFIX = "resenhazinha:role-backup:";
const MIC_DEVICE_KEY = "resenhazinha:microphone-device";
const SPEAKER_DEVICE_KEY = "resenhazinha:speaker-device";
const MIC_INPUT_VOLUME_KEY = "resenhazinha:microphone-input-volume";
const OUTPUT_VOLUME_KEY = "resenhazinha:output-volume";
const NOISE_SUPPRESSION_KEY = "resenhazinha:noise-suppression";
const FALLBACK_PROFILE_STATE_KEY = "resenhazinha:profile-state";
const DEFAULT_BACKGROUND_BLUR = 8;
const DEFAULT_BACKGROUND_ZOOM = 100;
const DEFAULT_FONT_SCALE = 100;
const DEFAULT_THEME = "dark";
const DEFAULT_PRESENCE = "available";
const REACTION_EMOJIS = ["👍", "❤️", "😂", "💀", "🔥", "👀"];
const DIAGNOSTIC_INTERVAL_MS = 5000;
const VOICE_RECONNECT_DELAYS = [700, 1500, 3000, 5000];
const SCREEN_RECONNECT_DELAYS = [900, 1800, 3600];
const CAMERA_RECONNECT_DELAYS = [1000, 2500, 5000];
const MEDIA_NEGOTIATION_TIMEOUT_MS = 12_000;
const CONNECTION_HEARTBEAT_MS = 12000;
const CONNECTION_GRACE_MS = 30000;
const MAX_SERVER_ROLES = 20;
const UI_SOUND_URLS = {
  // Sons clássicos do Discord hospedados pelo Myinstants. Se a internet falhar,
  // playUiSound usa um feedback local sintetizado para nunca ficar mudo.
  message: "https://www.myinstants.com/media/sounds/discord-notification.mp3",
  voiceJoin: "https://www.myinstants.com/media/sounds/yt1s_nYWSz5R.mp3",
  voiceLeave: "https://www.myinstants.com/media/sounds/y2mate_VKI8qDn.mp3",
  screenStart: null,
  screenStop: null,
  micMute: "https://www.myinstants.com/media/sounds/discord-mute-sound-effect.mp3",
  micUnmute: "https://www.myinstants.com/media/sounds/discord-unmute-sound.mp3",
  deafen: "https://www.myinstants.com/media/sounds/discord-deafen_jvTyxZk.mp3",
  undeafen: "https://www.myinstants.com/media/sounds/discord-undeafen.mp3",
};
const uiSoundPool = new Map();
let uiFallbackAudioContext = null;
const PEER_OPTIONS = {
  host: "0.peerjs.com",
  port: 443,
  path: "/",
  secure: true,
};

const callSessions = new CallSessionManager();

const state = {
  peer: null,
  hostConnection: null,
  cloudMode: true,
  cloudReady: false,
  cloudOwnerKey: "",
  guestConnections: new Map(),
  pendingGuestProfiles: new Map(),
  hostMembers: new Map(),
  memberRegistry: new Map(),
  revokedClientIds: new Set(),
  incomingProfileMedia: new Map(),
  pendingProfileMedia: new Map(),
  profileResyncTimer: null,
  mediaReconcileTimers: new Set(),
  members: [],
  voiceCalls: callSessions.map("voice"),
  voiceStats: new Map(),
  cameraCallsOut: callSessions.map("cameraOut"),
  cameraCallsIn: callSessions.map("cameraIn"),
  cameraStreams: new Map(),
  cameraStream: null,
  screenCallsOut: callSessions.map("screenOut"),
  screenCallsIn: callSessions.map("screenIn"),
  chatMessages: [],
  pendingChatFiles: [],
  chatSending: false,
  incomingChatUploads: new Map(),
  attachmentCache: new Map(),
  attachmentRequests: new Set(),
  attachmentWaiters: new Map(),
  incomingAttachmentDownloads: new Map(),
  editingMessageId: null,
  pendingReplyMessageId: null,
  contextMessageId: null,
  profilePopoverPeerId: null,
  pendingDeleteMessageId: null,
  localStream: null,
  rawMicrophoneStream: null,
  micAudioContext: null,
  microphoneDeviceId: String(localStorage.getItem(MIC_DEVICE_KEY) || ""),
  speakerDeviceId: String(localStorage.getItem(SPEAKER_DEVICE_KEY) || ""),
  microphoneInputVolume: normalizeMicInputVolume(localStorage.getItem(MIC_INPUT_VOLUME_KEY) || 1),
  outputVolume: normalizeOutputVolume(localStorage.getItem(OUTPUT_VOLUME_KEY) || 1),
  micGainNode: null,
  playbackAudioContext: null,
  memberAudioNodes: new Map(),
  screenAudioNodes: new Map(),
  microphoneTest: null,
  noiseSuppressionLevel: normalizeNoiseSuppressionLevel(localStorage.getItem(NOISE_SUPPRESSION_KEY) || "medium"),
  screenStream: null,
  screenSources: [],
  screenSourceFilter: "all",
  screenSourceSearch: "",
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
  joinInviteToken: "",
  serverBinding: loadServerBinding(),
  isHost: false,
  muted: false,
  serverMuted: false,
  deafened: false,
  mutedBeforeDeafen: false,
  inVoice: false,
  voiceJoinedAt: null,
  voicePresenceRevision: 0,
  resumeVoiceAfterReconnect: false,
  screenAudioMuted: false,
  screenVolume: 1,
  memberVolumes: new Map(),
  shareQuality: "1080p",
  shareFps: 30,
  currentScreenIsLocal: false,
  currentView: "text",
  serverSettingsTab: "general",
  unreadMessages: 0,
  unreadMentions: 0,
  moderationLog: [],
  appInfo: null,
  diagnosticsTimer: null,
  voiceUiTimer: null,
  roomEntered: false,
  selectedMemberPeerId: null,
  voiceContextPeerId: null,
  lastNonZeroMemberVolumes: new Map(),
  persistenceTimer: null,
  reconnectTimer: null,
  heartbeatTimer: null,
  hostDisconnectGraceTimer: null,
  guestDisconnectTimers: new Map(),
  server: createDefaultServer(),
};

document.addEventListener("pointerdown", unlockUiAudio, { capture: true });
document.addEventListener("keydown", unlockUiAudio, { capture: true });

const $ = (selector) => document.querySelector(selector);
const elements = {
  personalAppBackgroundMedia: $("#personal-app-background-media"),
  lobbyView: $("#lobby-view"), roomView: $("#room-view"), joinForm: $("#join-form"),
  nicknameInput: $("#nickname-input"), roomInput: $("#room-input"), serverNameInput: $("#server-name-input"),
  roomCodeLabel: $("#room-code-label"), serverNameLabel: $("#server-name-label"), lobbyNote: $("#lobby-note"), savedServerBanner: $("#saved-server-banner"), savedServerName: $("#saved-server-name"),
  randomCodeButton: $("#random-code-button"), createButton: $("#create-room-button"), joinButton: $("#join-room-button"),
  lobbyStatus: $("#lobby-status"), lobbyAvatar: $("#lobby-avatar"), lobbyAvatarButton: $("#lobby-avatar-button"),
  chooseAvatarButton: $("#choose-avatar-button"), removeAvatarButton: $("#remove-avatar-button"),
  serverNameDisplay: $("#server-name-display"), serverIconDisplay: $("#server-icon-display"),
  textChannelButton: $("#text-channel-button"), voiceChannelButton: $("#voice-channel-button"), textChannelName: $("#text-channel-name"), voiceChannelName: $("#voice-channel-name"),
  textChannelEmpty: $("#text-channel-empty"), voiceChannelEmpty: $("#voice-channel-empty"), createTextChannelButton: $("#create-text-channel-button"), createVoiceChannelButton: $("#create-voice-channel-button"),
  voiceMiniList: $("#voice-mini-list"), voiceChannelDuration: $("#voice-channel-duration"), voiceConnectionPanel: $("#voice-connection-panel"), voiceConnectionDetail: $("#voice-connection-detail"), voicePingIndicator: $("#voice-ping-indicator"), textView: $("#text-view"), voiceView: $("#voice-view"),
  contentChannelIcon: $("#content-channel-icon"), contentChannelKind: $("#content-channel-kind"), contentChannelTitle: $("#content-channel-title"),
  memberList: $("#member-list"), memberCount: $("#member-count"), onlineCount: $("#online-count"),
  selfAvatar: $("#self-avatar"), selfAvatarButton: $("#self-avatar-button"), selfName: $("#self-name"), selfState: $("#self-state"), userSettingsButton: $("#user-settings-button"),
  connectionPill: $("#connection-pill"), roomCodeDisplay: $("#room-code-display"), copyCodeButton: $("#copy-code-button"),
  stageEmpty: $("#stage-empty"), screenVideo: $("#screen-video"), screenBadge: $("#screen-badge"), screenOwner: $("#screen-owner"),
  screenAudioButton: $("#screen-audio-button"), screenAudioLabel: $("#screen-audio-label"), screenVolumeControl: $("#screen-volume-control"), screenVolumeRange: $("#screen-volume-range"), screenVolumeValue: $("#screen-volume-value"), screenQualityLabel: $("#screen-quality-label"), callHint: $("#call-hint"),
  screenGallery: $("#screen-gallery"), screenGrid: $("#screen-grid"), screenSwitcher: $("#screen-switcher"), screenGridButton: $("#screen-grid-button"),
  micButton: $("#mic-button"), deafenButton: $("#deafen-button"), shareButton: $("#share-button"), callMicButton: $("#call-mic-button"), callDeafenButton: $("#call-deafen-button"), cameraButton: $("#camera-button"),
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
  userDialog: $("#user-dialog"), closeUserDialogButton: $("#close-user-dialog-button"), userBannerPreview: $("#user-banner-preview"), userChooseBannerButton: $("#user-choose-banner-button"), userRemoveBannerButton: $("#user-remove-banner-button"), userAvatarPreview: $("#user-avatar-preview"), userChooseAvatarButton: $("#user-choose-avatar-button"), userRemoveAvatarButton: $("#user-remove-avatar-button"), userNameSettings: $("#user-name-settings"), userBioSettings: $("#user-bio-settings"), presenceChoiceButtons: [...document.querySelectorAll("[data-presence-choice]")], themeChoiceButtons: [...document.querySelectorAll("[data-theme-choice]")], appBackgroundPreview: $("#app-background-preview"), chooseAppBackgroundButton: $("#choose-app-background-button"), removeAppBackgroundButton: $("#remove-app-background-button"), appBackgroundBlurRange: $("#app-background-blur-range"), appBackgroundBlurValue: $("#app-background-blur-value"), appBackgroundZoomRange: $("#app-background-zoom-range"), appBackgroundZoomValue: $("#app-background-zoom-value"), appFontScaleRange: $("#app-font-scale-range"), appFontScaleValue: $("#app-font-scale-value"), fontSizePreview: $("#font-size-preview"), microphoneDeviceSelect: $("#microphone-device-select"), speakerDeviceSelect: $("#speaker-device-select"), refreshMicrophonesButton: $("#refresh-microphones-button"), microphoneInputVolumeRange: $("#microphone-input-volume-range"), microphoneInputVolumeValue: $("#microphone-input-volume-value"), outputVolumeRange: $("#output-volume-range"), outputVolumeValue: $("#output-volume-value"), microphoneTestButton: $("#microphone-test-button"), microphoneTestMeter: $("#microphone-test-meter"), noiseSuppressionSelect: $("#noise-suppression-select"), noiseLevelNote: $("#noise-level-note"), saveUserSettingsButton: $("#save-user-settings-button"),
  memberDialog: $("#member-dialog"), closeMemberDialogButton: $("#close-member-dialog-button"), memberDialogAvatar: $("#member-dialog-avatar"), memberDialogName: $("#member-dialog-name"),
  memberAudioSection: $("#member-audio-section"), memberVolumeRange: $("#member-volume-range"), memberVolumeValue: $("#member-volume-value"), memberModerationSection: $("#member-moderation-section"), memberRolesSection: $("#member-roles-section"),
  serverMuteMemberButton: $("#server-mute-member-button"), disconnectMemberButton: $("#disconnect-member-button"), kickMemberButton: $("#kick-member-button"), memberRoleOptions: $("#member-role-options"),
  voiceContextMenu: $("#voice-context-menu"), voiceContextProfileButton: $("#voice-context-profile-button"), voiceContextMentionButton: $("#voice-context-mention-button"), voiceContextVolumeSection: $("#voice-context-volume-section"), voiceContextVolumeRange: $("#voice-context-volume-range"), voiceContextVolumeValue: $("#voice-context-volume-value"), voiceContextLocalMuteButton: $("#voice-context-local-mute-button"), voiceContextAdminSection: $("#voice-context-admin-section"), voiceContextRolesButton: $("#voice-context-roles-button"), voiceContextServerMuteButton: $("#voice-context-server-mute-button"), voiceContextDisconnectButton: $("#voice-context-disconnect-button"), voiceContextKickButton: $("#voice-context-kick-button"),
  profilePopover: $("#member-profile-popover"), profileBanner: $("#member-profile-banner"), profileAvatar: $("#member-profile-avatar"), profileClose: $("#member-profile-close"), profileName: $("#member-profile-name"), profileOwner: $("#member-profile-owner"), profileStatus: $("#member-profile-status"), profileRoles: $("#member-profile-roles"), profileBioSection: $("#member-profile-bio-section"), profileBioText: $("#member-profile-bio-text"), profileActions: $("#member-profile-actions"), presencePopover: $("#presence-popover"),
  deleteMessageDialog: $("#delete-message-dialog"), closeDeleteMessageDialogButton: $("#close-delete-message-dialog-button"), deleteMessagePreviewAvatar: $("#delete-message-preview-avatar"), deleteMessagePreviewName: $("#delete-message-preview-name"), deleteMessagePreviewTime: $("#delete-message-preview-time"), deleteMessagePreviewText: $("#delete-message-preview-text"), deleteMessagePreviewAttachments: $("#delete-message-preview-attachments"), cancelDeleteMessageButton: $("#cancel-delete-message-button"), confirmDeleteMessageButton: $("#confirm-delete-message-button"),
};

Object.assign(elements, {
  pinnedMessagesButton: $("#pinned-messages-button"), pinnedCountBadge: $("#pinned-count-badge"),
  diagnosticsButton: $("#diagnostics-button"), diagnosticsDialog: $("#diagnostics-dialog"), closeDiagnosticsDialogButton: $("#close-diagnostics-dialog-button"), diagnosticsSummary: $("#diagnostics-summary"), diagnosticsPeers: $("#diagnostics-peers"), refreshDiagnosticsButton: $("#refresh-diagnostics-button"), copyDiagnosticsButton: $("#copy-diagnostics-button"),
  pinnedDialog: $("#pinned-dialog"), closePinnedDialogButton: $("#close-pinned-dialog-button"), pinnedMessageList: $("#pinned-message-list"),
  chatReplyPreview: $("#chat-reply-preview"), chatReplyName: $("#chat-reply-name"), chatReplyText: $("#chat-reply-text"), chatReplyCancel: $("#chat-reply-cancel"),
  voiceContextMessageSection: $("#voice-context-message-section"), voiceContextReplyButton: $("#voice-context-reply-button"), voiceContextPinButton: $("#voice-context-pin-button"), voiceContextDeleteButton: $("#voice-context-delete-button"), voiceContextReactions: $("#voice-context-reactions"),
  inviteCodeSettings: $("#invite-code-settings"), copyInviteSettingsButton: $("#copy-invite-settings-button"), rotateInviteButton: $("#rotate-invite-button"), moderationLog: $("#moderation-log"),
  appVersionLabel: $("#app-version-label"), updateStatusLabel: $("#update-status-label"), checkUpdateButton: $("#check-update-button"),
  sourceSearch: $("#source-search"), sourceFilterButtons: [...document.querySelectorAll("[data-source-filter]")],
});

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

const serverActionNoticeV306 = sessionStorage.getItem("resenhazinha:server-action-notice");
if (serverActionNoticeV306) {
  sessionStorage.removeItem("resenhazinha:server-action-notice");
  window.setTimeout(() => setLobbyStatus(serverActionNoticeV306, "neutral"), 0);
}

profileReady.then(() => {
  if (state.serverBinding && cleanNickname(elements.nicknameInput.value)) {
    window.setTimeout(() => enterRoom(state.serverBinding.isOwner ? "resume-host" : "resume-join"), 120);
  }
});

elements.nicknameInput.addEventListener("input", renderLocalAvatars);
elements.roomInput.addEventListener("input", () => { elements.roomInput.value = normalizeJoinCode(elements.roomInput.value); });
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
elements.callMicButton.addEventListener("click", toggleMute);
elements.callDeafenButton.addEventListener("click", toggleDeafen);
elements.cameraButton.addEventListener("click", () => void toggleCamera());
elements.shareButton.addEventListener("click", handleShareButton);
elements.voiceJoinButton.addEventListener("click", joinVoiceChannel);
elements.voiceLeaveButton.addEventListener("click", leaveVoiceChannel);
elements.screenGridButton.addEventListener("click", () => setScreenLayout("grid"));
elements.leaveButton.addEventListener("click", leaveVoiceChannel);
elements.chatToggleButton.addEventListener("click", () => switchView("text"));
elements.textChannelButton.addEventListener("click", () => switchView("text"));
elements.voiceChannelButton.addEventListener("click", () => switchView("voice"));
elements.pinnedMessagesButton.addEventListener("click", openPinnedMessages);
elements.diagnosticsButton.addEventListener("click", openDiagnostics);
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
elements.pinnedDialog.addEventListener("click", (event) => { if (event.target === elements.pinnedDialog) elements.pinnedDialog.close(); });
elements.diagnosticsDialog.addEventListener("click", (event) => { if (event.target === elements.diagnosticsDialog) closeDiagnostics(); });
elements.closePinnedDialogButton.addEventListener("click", () => elements.pinnedDialog.close());
elements.closeDiagnosticsDialogButton.addEventListener("click", closeDiagnostics);
elements.refreshDiagnosticsButton.addEventListener("click", () => void refreshDiagnostics());
elements.copyDiagnosticsButton.addEventListener("click", copyDiagnostics);
elements.chatReplyCancel.addEventListener("click", clearPendingReply);
elements.copyInviteSettingsButton.addEventListener("click", copyRoomCode);
elements.rotateInviteButton.addEventListener("click", () => requestAdminAction("invite-rotate"));
elements.checkUpdateButton.addEventListener("click", checkForUpdatesFromSettings);
elements.sourceSearch.addEventListener("input", () => { state.screenSourceSearch = elements.sourceSearch.value.trim().toLowerCase(); renderScreenSources(state.screenSources); });
elements.sourceFilterButtons.forEach((button) => button.addEventListener("click", () => { state.screenSourceFilter = button.dataset.sourceFilter || "all"; elements.sourceFilterButtons.forEach((item) => item.classList.toggle("is-active", item === button)); renderScreenSources(state.screenSources); }));
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
elements.microphoneInputVolumeRange.addEventListener("input", () => {
  state.microphoneInputVolume = normalizeMicInputVolume(Number(elements.microphoneInputVolumeRange.value) / 100);
  if (state.micGainNode) state.micGainNode.gain.value = state.microphoneInputVolume;
  if (state.microphoneTest?.capture?.gainNode) state.microphoneTest.capture.gainNode.gain.value = state.microphoneInputVolume;
  renderVoiceVolumeValues();
});
elements.outputVolumeRange.addEventListener("input", () => {
  state.outputVolume = normalizeOutputVolume(Number(elements.outputVolumeRange.value) / 100);
  renderVoiceVolumeValues();
  applyAllPlaybackAudioSettings();
});
elements.microphoneTestButton.addEventListener("click", () => void toggleMicrophoneTest());
elements.userDialog.addEventListener("close", stopMicrophoneTest);
elements.microphoneDeviceSelect.addEventListener("change", () => { if (state.microphoneTest) void restartMicrophoneTestFromSettings(); });
elements.speakerDeviceSelect.addEventListener("change", () => { if (state.microphoneTest?.monitorAudio) void applyOutputDevice(state.microphoneTest.monitorAudio, String(elements.speakerDeviceSelect.value || "")); });
elements.noiseSuppressionSelect.addEventListener("change", () => { renderNoiseSuppressionNote(); if (state.microphoneTest) void restartMicrophoneTestFromSettings(); });
document.querySelectorAll("[data-user-settings-tab]").forEach((button) => button.addEventListener("click", () => setUserSettingsTab(button.dataset.userSettingsTab)));
document.querySelectorAll("[data-server-settings-tab]").forEach((button) => button.addEventListener("click", () => setServerSettingsTab(button.dataset.serverSettingsTab)));
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
elements.voiceContextReplyButton.addEventListener("click", replyToContextMessage);
elements.voiceContextPinButton.addEventListener("click", togglePinContextMessage);
elements.voiceContextDeleteButton.addEventListener("click", deleteContextMessage);
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

window.addEventListener("focus", () => { if (state.currentView === "text") { state.unreadMessages = 0; state.unreadMentions = 0; updateChatVisibility(); } });
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.currentView === "text") { state.unreadMessages = 0; state.unreadMentions = 0; updateChatVisibility(); } });
window.resenhazinhaDesktop?.onNotificationClick?.((payload) => {
  switchView("text");
  window.setTimeout(() => scrollToMessage(payload?.messageId), 100);
});
void loadAppInfo();
window.addEventListener("beforeunload", () => { revokeAppBackgroundSource(state.appBackgroundData); teardownConnections(); });
document.addEventListener("pointerdown", primeUiSounds, { once: true, passive: true });
document.addEventListener("keydown", primeUiSounds, { once: true });

function normalizeNoiseSuppressionLevel(value) {
  return ["off", "light", "medium", "high"].includes(String(value)) ? String(value) : "medium";
}

function uiSoundElement(kind) {
  const source = UI_SOUND_URLS[kind];
  if (!source) return null;
  let audio = uiSoundPool.get(kind);
  if (!audio) {
    audio = new Audio(source);
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    uiSoundPool.set(kind, audio);
  }
  return audio;
}

function fallbackUiSound(kind, volume = 0.45) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  try {
    uiFallbackAudioContext ||= new AudioContextCtor();
    const context = uiFallbackAudioContext;
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const now = context.currentTime;
    const gain = context.createGain();
    const osc = context.createOscillator();
    const patterns = {
      message: [880, 0.055], voiceJoin: [620, 0.08], voiceLeave: [390, 0.09],
      screenStart: [740, 0.07], screenStop: [460, 0.07], micMute: [360, 0.055],
      micUnmute: [650, 0.055], deafen: [290, 0.075], undeafen: [560, 0.075],
    };
    const [frequency, duration] = patterns[kind] || [520, 0.055];
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, clampVolume(volume) * 0.12), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain); gain.connect(context.destination);
    osc.start(now); osc.stop(now + duration + 0.01);
  } catch (_error) {
    // Feedback sonoro é opcional; nunca interfere no restante do app.
  }
}

function primeUiSounds() {
  Object.keys(UI_SOUND_URLS).forEach((kind) => {
    try { uiSoundElement(kind)?.load?.(); } catch (_error) {}
  });
}

function unlockUiAudio() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  try {
    uiFallbackAudioContext ||= new AudioContextCtor();
    if (uiFallbackAudioContext.state === "suspended") void uiFallbackAudioContext.resume().catch(() => undefined);
    ["voiceJoin", "voiceLeave", "micMute", "micUnmute", "deafen", "undeafen"].forEach((kind) => {
      const audio = uiSoundElement(kind);
      try { audio?.load?.(); } catch (_error) {}
    });
  } catch (_error) {}
}

function playUiSound(kind, volume = 0.45) {
  if (state.microphoneTest?.silencingPlayback) return;
  unlockUiAudio();

  const base = uiSoundElement(kind);
  if (!base) {
    fallbackUiSound(kind, volume);
    return;
  }

  let started = false;
  let fallbackPlayed = false;
  const playFallback = () => {
    if (started || fallbackPlayed) return;
    fallbackPlayed = true;
    fallbackUiSound(kind, volume);
  };

  try {
    const audio = base.cloneNode(true);
    audio.volume = clampVolume(volume);
    audio.addEventListener("playing", () => {
      started = true;
    }, { once: true });
    const watchdog = window.setTimeout(playFallback, 450);
    const playback = audio.play();
    if (playback?.then) playback.then(() => {
      started = true;
      window.clearTimeout(watchdog);
    }).catch(() => {
      window.clearTimeout(watchdog);
      playFallback();
    });
  } catch (_error) {
    playFallback();
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
    const isOwner = Boolean(raw?.isOwner);
    return {
      roomCode,
      inviteToken: normalizeInviteToken(raw?.inviteToken || ""),
      isOwner,
      serverName: cleanServerName(raw?.serverName || "Resenhazinha"),
      ownerKey: isOwner ? sanitizeCloudOwnerKey(raw?.ownerKey || "") : "",
      cloudMigrated: isOwner ? Boolean(raw?.cloudMigrated) : false,
    };
  } catch (_error) {
    return null;
  }
}

function saveServerBinding(binding) {
  const roomCode = normalizeRoomCode(binding?.roomCode || "");
  if (roomCode.length < 4) return;
  const isOwner = Boolean(binding?.isOwner);
  state.serverBinding = {
    roomCode,
    inviteToken: normalizeInviteToken(binding?.inviteToken || state.server?.inviteToken || ""),
    isOwner,
    serverName: cleanServerName(binding?.serverName || state.server?.name || "Resenhazinha"),
    ownerKey: isOwner ? sanitizeCloudOwnerKey(binding?.ownerKey || state.cloudOwnerKey || state.serverBinding?.ownerKey || "") : "",
    cloudMigrated: isOwner ? Boolean(binding?.cloudMigrated ?? state.serverBinding?.cloudMigrated) : false,
  };
  localStorage.setItem(SERVER_BINDING_KEY, JSON.stringify(state.serverBinding));
  applySavedServerLobby();
}

function clearServerBinding() {
  state.serverBinding = null;
  localStorage.removeItem(SERVER_BINDING_KEY);
  applySavedServerLobby();
}

function getOrCreateCloudOwnerKey() {
  const existing = sanitizeCloudOwnerKey(state.serverBinding?.ownerKey || state.cloudOwnerKey || "");
  if (existing) return existing;
  return createCloudOwnerKey();
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

function roleBackupKey(roomCode = state.roomCode) {
  const room = normalizeRoomCode(roomCode || "");
  return room ? `${ROLE_BACKUP_KEY_PREFIX}${room}` : "";
}

function loadRoleBackup(roomCode = state.roomCode) {
  const key = roleBackupKey(roomCode);
  if (!key) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(raw?.roles) ? raw.roles.slice(0, MAX_SERVER_ROLES) : [];
  } catch (_error) { return []; }
}

function saveRoleBackup(roomCode = state.roomCode, roles = state.server?.roles) {
  const key = roleBackupKey(roomCode);
  if (!key || !Array.isArray(roles)) return;
  try {
    localStorage.setItem(key, JSON.stringify({ roomCode: normalizeRoomCode(roomCode), roles: roles.slice(0, MAX_SERVER_ROLES), savedAt: Date.now() }));
  } catch (_error) {}
}

function mergeRoleDefinitions(primaryRoles, backupRoles) {
  const map = new Map();
  const order = [];
  [...(backupRoles || []), ...(primaryRoles || [])].forEach((role) => {
    const id = String(role?.id || "").slice(0, 80);
    if (!id) return;
    if (!map.has(id)) order.push(id);
    map.set(id, role);
  });
  return order.map((id) => map.get(id)).filter(Boolean).slice(0, MAX_SERVER_ROLES);
}

function sanitizeRegistryRecord(raw) {
  const clientId = sanitizeClientId(raw?.clientId);
  if (!clientId) return null;
  return {
    clientId,
    name: cleanNickname(raw?.name || "Amigo") || "Amigo",
    roleIds: Array.isArray(raw?.roleIds) ? raw.roleIds.map(String).slice(0, MAX_SERVER_ROLES) : ["membro"],
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

function mergeSavedServerStates(candidates, roomCode) {
  const matching = (candidates || [])
    .filter(Boolean)
    .filter((item) => normalizeRoomCode(item.roomCode || "") === roomCode)
    .sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0));
  if (!matching.length) return null;

  const primary = structuredClone(matching[0]);
  primary.server = primary.server && typeof primary.server === "object" ? primary.server : {};

  // Recuperação/migração: versões antigas chegaram a salvar no localStorage,
  // enquanto versões novas usam o arquivo do Electron. Unimos os dois sem
  // apagar cargos, membros ou histórico que existiam numa das cópias.
  const roleMap = new Map();
  const roleOrder = [];
  [...matching].reverse().forEach((candidate) => {
    (candidate.server?.roles || []).forEach((rawRole) => {
      const id = String(rawRole?.id || "").slice(0, 80);
      if (!id) return;
      if (!roleMap.has(id)) roleOrder.push(id);
      roleMap.set(id, rawRole);
    });
  });
  const preferredOrder = [];
  (matching[0].server?.roles || []).forEach((role) => {
    const id = String(role?.id || "").slice(0, 80);
    if (id && !preferredOrder.includes(id)) preferredOrder.push(id);
  });
  roleOrder.forEach((id) => { if (!preferredOrder.includes(id)) preferredOrder.push(id); });
  primary.server.roles = preferredOrder.map((id) => roleMap.get(id)).filter(Boolean).slice(0, MAX_SERVER_ROLES);

  const memberMap = new Map();
  [...matching].reverse().forEach((candidate) => {
    (candidate.members || []).forEach((rawMember) => {
      const clientId = sanitizeClientId(rawMember?.clientId);
      if (!clientId) return;
      const previous = memberMap.get(clientId) || {};
      memberMap.set(clientId, {
        ...previous,
        ...rawMember,
        clientId,
        roleIds: [...new Set([...(previous.roleIds || []), ...(rawMember.roleIds || [])].map(String))].slice(0, MAX_SERVER_ROLES),
        lastSeenAt: Math.max(Number(previous.lastSeenAt) || 0, Number(rawMember.lastSeenAt) || 0),
      });
    });
  });
  primary.members = [...memberMap.values()].slice(0, 100);

  const messageMap = new Map();
  matching.forEach((candidate) => {
    (candidate.chatMessages || []).forEach((rawMessage) => {
      const id = sanitizeTransferId(rawMessage?.id);
      if (!id || messageMap.has(id)) return;
      messageMap.set(id, rawMessage);
    });
  });
  primary.chatMessages = [...messageMap.values()]
    .sort((a, b) => (Number(a?.sentAt) || 0) - (Number(b?.sentAt) || 0))
    .slice(-MAX_CHAT_HISTORY);

  primary.revokedClientIds = [...new Set(matching.flatMap((item) => item.revokedClientIds || []).map(sanitizeClientId).filter(Boolean))].slice(-200);
  const moderationMap = new Map();
  matching.forEach((candidate) => {
    (candidate.moderationLog || []).forEach((entry) => {
      const id = sanitizeTransferId(entry?.id) || `${Number(entry?.at) || 0}:${String(entry?.actor || "")}:${String(entry?.action || "")}`;
      if (!moderationMap.has(id)) moderationMap.set(id, entry);
    });
  });
  primary.moderationLog = [...moderationMap.values()]
    .sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0))
    .slice(-80);
  primary.savedAt = Math.max(...matching.map((item) => Number(item.savedAt) || 0), Date.now());
  return primary;
}

async function loadPersistentServerState(roomCode) {
  if (!state.isHost) return false;
  const candidates = [];
  try {
    if (window.resenhazinhaDesktop?.loadServerState) {
      const diskState = await window.resenhazinhaDesktop.loadServerState();
      if (diskState) candidates.push(diskState);
    }
  } catch (_error) {}
  try {
    const fallbackState = JSON.parse(localStorage.getItem(FALLBACK_SERVER_STATE_KEY) || "null");
    if (fallbackState) candidates.push(fallbackState);
  } catch (_error) {}

  const saved = mergeSavedServerStates(candidates, roomCode);
  if (!saved) return false;

  const independentRoleBackup = loadRoleBackup(roomCode);
  if (independentRoleBackup.length) {
    saved.server ||= {};
    saved.server.roles = mergeRoleDefinitions(saved.server.roles || [], independentRoleBackup);
  }

  const recoveredRoleCount = Math.max(0, (saved.server?.roles || []).length - (candidates[0]?.server?.roles || []).length);
  state.server = sanitizeServer(saved.server || state.server);
  state.server.ownerClientId = sanitizeClientId(state.server.ownerClientId) || state.clientId;
  state.chatMessages = (saved.chatMessages || []).map(sanitizeIncomingChatMessage).filter(Boolean).slice(-MAX_CHAT_HISTORY);
  state.moderationLog = sanitizeModerationLog(saved.moderationLog);
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
  if (recoveredRoleCount > 0) window.setTimeout(() => toast(`${recoveredRoleCount} cargo${recoveredRoleCount === 1 ? "" : "s"} antigo${recoveredRoleCount === 1 ? "" : "s"} recuperado${recoveredRoleCount === 1 ? "" : "s"}.`), 350);
  return true;
}

function persistentServerPayload() {
  const server = sanitizeServer(state.server);
  server.ownerPeerId = null;
  return {
    version: 5,
    roomCode: state.roomCode,
    server,
    chatMessages: state.chatMessages.slice(-MAX_CHAT_HISTORY),
    revokedClientIds: Array.from(state.revokedClientIds).slice(-200),
    moderationLog: sanitizeModerationLog(state.moderationLog).slice(-80),
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
  const payload = persistentServerPayload();
  // Mantemos uma cópia pequena também no armazenamento do Chromium. Isso
  // serve como backup/migração de cargos e configurações entre builds.
  try { localStorage.setItem(FALLBACK_SERVER_STATE_KEY, JSON.stringify(payload)); } catch (_error) {}
  saveRoleBackup(state.roomCode, payload.server?.roles || state.server?.roles || []);
  try {
    if (window.resenhazinhaDesktop?.saveServerState) await window.resenhazinhaDesktop.saveServerState(payload);
  } catch (_error) {
    // O servidor continua funcionando com a cópia local mesmo se o disco falhar.
  }
}

function scheduleServerPersistence() {
  if (!state.isHost) return;
  window.clearTimeout(state.persistenceTimer);
  state.persistenceTimer = window.setTimeout(() => persistServerStateNow(), 180);
}

function scheduleHostReconnect(delayMs = 1400) {
  if (!state.cloudMode || !state.roomCode || state.peer?.destroyed) return;
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = window.setTimeout(() => {
    if (!state.hostConnection?.open && state.peer?.open) connectToHost(true);
  }, Math.max(250, Number(delayMs) || 1400));
}

function normalizeVoicePresenceRevision(value) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
}

function localVoicePresenceState() {
  return {
    muted: state.muted,
    deafened: state.deafened,
    inVoice: state.inVoice && state.server.voiceChannel.exists,
    voiceJoinedAt: state.inVoice ? (normalizeVoiceJoinedAt(state.voiceJoinedAt) || Date.now()) : null,
    voiceSessionId: state.inVoice ? callSessions.sessionId("voice") : "",
    voicePresenceRevision: normalizeVoicePresenceRevision(state.voicePresenceRevision),
    presence: normalizePresence(state.presenceStatus),
  };
}

function scheduleVoicePresenceSyncBurst() {
  const revision = normalizeVoicePresenceRevision(state.voicePresenceRevision);
  [220, 800, 1800].forEach((delay) => {
    window.setTimeout(() => {
      if (!state.roomEntered || normalizeVoicePresenceRevision(state.voicePresenceRevision) !== revision) return;
      publishLocalStatus();
    }, delay);
  });
}

function applyGuestVoiceStatus(peerId, message) {
  const member = state.hostMembers.get(peerId);
  if (!member) return false;

  const currentRevision = normalizeVoicePresenceRevision(member.voicePresenceRevision);
  const hasRevision = message?.voicePresenceRevision !== undefined && message?.voicePresenceRevision !== null;
  const incomingRevision = hasRevision ? normalizeVoicePresenceRevision(message.voicePresenceRevision) : currentRevision;
  if (incomingRevision < currentRevision) return false;

  const wasInVoice = Boolean(member.inVoice);
  const previousVoiceSessionId = normalizeMediaSessionId(member.voiceSessionId);
  const previousMuted = Boolean(member.muted);
  const previousDeafened = Boolean(member.deafened);
  const nextInVoice = state.server.voiceChannel.exists && Boolean(message.inVoice);
  const nextVoiceSessionId = nextInVoice ? normalizeMediaSessionId(message.voiceSessionId) : "";

  member.deafened = Boolean(message.deafened);
  member.muted = member.deafened || Boolean(message.muted);
  member.inVoice = nextInVoice;
  member.voiceJoinedAt = member.inVoice
    ? normalizeVoiceJoinedAt(message.voiceJoinedAt) || (wasInVoice ? normalizeVoiceJoinedAt(member.voiceJoinedAt) : null) || Date.now()
    : null;
  member.voiceSessionId = nextVoiceSessionId;
  member.voicePresenceRevision = incomingRevision;
  if (message.presence) member.presence = normalizePresence(message.presence);

  const sessionChanged = Boolean(previousVoiceSessionId && nextVoiceSessionId && previousVoiceSessionId !== nextVoiceSessionId);
  const changed = wasInVoice !== member.inVoice
    || previousVoiceSessionId !== nextVoiceSessionId
    || previousMuted !== member.muted
    || previousDeafened !== member.deafened;

  rememberMember(member);
  state.members = Array.from(state.hostMembers.values());
  if (!member.inVoice || sessionChanged) closeCallsForPeer(peerId);
  return changed;
}

function scheduleMediaReconcileBurst() {
  state.mediaReconcileTimers.forEach((timer) => window.clearTimeout(timer));
  state.mediaReconcileTimers.clear();
  [80, 260, 700, 1500, 3200].forEach((delay) => {
    const timer = window.setTimeout(() => {
      state.mediaReconcileTimers.delete(timer);
      if (!state.roomEntered || !state.inVoice) return;
      reconcileVoiceCalls();
      reconcileScreenCalls();
      reconcileCameraCalls();
    }, delay);
    state.mediaReconcileTimers.add(timer);
  });
}

function memberForCloudIdentity(peerId, clientId) {
  const cleanClient = sanitizeClientId(clientId);
  return state.members.find((member) => member.peerId === String(peerId || ""))
    || (cleanClient ? state.members.find((member) => member.clientId === cleanClient) : null)
    || null;
}

function applyCloudVoicePresence(message) {
  const raw = message?.member;
  if (!raw || typeof raw !== "object") return;

  const clientId = sanitizeClientId(raw.clientId);
  const peerId = String(raw.peerId || "").slice(0, 120);
  if (!clientId || !peerId) return;

  const previous = memberForCloudIdentity(peerId, clientId);
  const previousPeerId = previous?.peerId || "";
  const incomingRevision = normalizeVoicePresenceRevision(raw.voicePresenceRevision);
  const currentRevision = normalizeVoicePresenceRevision(previous?.voicePresenceRevision);

  if (previous && incomingRevision < currentRevision) return;

  const isSelf = clientId === state.clientId || peerId === state.peer?.id;
  if (isSelf && incomingRevision < normalizeVoicePresenceRevision(state.voicePresenceRevision)) return;

  const member = previous || {
    peerId,
    clientId,
    name: cleanNickname(raw.name || "Amigo") || "Amigo",
    avatar: null,
    banner: null,
    bio: "",
    roleIds: normalizeRoleIds(raw.roleIds),
    sessionStartedAt: 0,
  };

  if (previousPeerId && previousPeerId !== peerId) {
    callSessions.cancelRetries("voice", previousPeerId);
    callSessions.cancelRetries("screen", previousPeerId);
    closeCallsForPeer(previousPeerId);
    clearScreenStage(previousPeerId);
    state.activeScreens.delete(previousPeerId);
  }

  member.peerId = peerId;
  member.clientId = clientId;
  member.name = cleanNickname(raw.name || member.name || "Amigo") || "Amigo";
  member.muted = Boolean(raw.muted);
  member.deafened = Boolean(raw.deafened);
  member.serverMuted = Boolean(raw.serverMuted);
  member.inVoice = Boolean(raw.inVoice) && state.server.voiceChannel.exists;
  member.voiceJoinedAt = member.inVoice ? normalizeVoiceJoinedAt(raw.voiceJoinedAt) || member.voiceJoinedAt || Date.now() : null;
  member.voiceSessionId = member.inVoice ? normalizeMediaSessionId(raw.voiceSessionId) : "";
  member.voicePresenceRevision = incomingRevision;
  member.roleIds = normalizeRoleIds(raw.roleIds || member.roleIds);
  member.presence = normalizePresence(raw.presence || member.presence || DEFAULT_PRESENCE);
  member.offlineSnapshot = Boolean(raw.offlineSnapshot);

  state.members = dedupeMembersByIdentity([
    ...state.members.filter((item) => item !== previous && item.clientId !== clientId),
    member,
  ]);

  if (isSelf && shouldApplyVoicePresenceSnapshot(state.voicePresenceRevision, incomingRevision)) {
    state.voicePresenceRevision = Math.max(normalizeVoicePresenceRevision(state.voicePresenceRevision), incomingRevision);
    if (!state.inVoice || !member.inVoice) {
      state.inVoice = member.inVoice;
      state.voiceJoinedAt = member.inVoice ? member.voiceJoinedAt : null;
    }
    state.serverMuted = member.serverMuted;
    applyLocalAudioState();
  }

  if (!member.inVoice) {
    closeCallsForPeer(peerId);
    if (previousPeerId && previousPeerId !== peerId) closeCallsForPeer(previousPeerId);
  }

  applyPendingProfileMediaToMembers();
  renderMembers();
  renderVoiceGrid();
  updateControlState();
  syncActivitySoundState();
  if (state.inVoice) scheduleMediaReconcileBurst();
}

function applyCloudScreenPresence(message) {
  const clientId = sanitizeClientId(message?.clientId);
  const announcedPeerId = String(message?.peerId || "").slice(0, 120);
  const member = memberForCloudIdentity(announcedPeerId, clientId);
  const peerId = member?.peerId || announcedPeerId;
  if (!peerId) return;

  if (message.started) {
    const screenSessionId = normalizeMediaSessionId(message.screenSessionId);
    state.activeScreens.set(peerId, {
      peerId,
      name: cleanNickname(message.name || member?.name || "Amigo") || "Amigo",
      screenSessionId,
    });
  } else {
    state.activeScreens.delete(peerId);
    clearScreenStage(peerId);
  }

  state.activeScreen = state.activeScreens.values().next().value || null;
  renderMembers();
  renderScreenStage();
  syncActivitySoundState();
  if (state.inVoice) scheduleMediaReconcileBurst();
}

function startConnectionHeartbeat() {
  window.clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
  state.heartbeatTimer = window.setInterval(() => {
    const connection = state.hostConnection;
    if (!connection?.open) return;
    try { connection.send({ type: "heartbeat", at: Date.now(), voiceState: localVoicePresenceState() }); } catch (_error) {}
  }, CONNECTION_HEARTBEAT_MS);
}

function stopConnectionHeartbeat() {
  window.clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
}

function cancelHostDisconnectGrace() {
  window.clearTimeout(state.hostDisconnectGraceTimer);
  state.hostDisconnectGraceTimer = null;
}

function finalizeHostOfflineAfterGrace() {
  if (state.hostConnection?.open || !state.roomEntered) return;
  state.resumeVoiceAfterReconnect = state.resumeVoiceAfterReconnect || state.inVoice;
  closeAllMediaCalls();
  if (state.cameraStream) stopCamera();
  state.inVoice = false;
  state.voiceJoinedAt = null;
  stopMicrophoneCapture();
  applyLocalAudioState();
  updateControlState();
  state.members = state.members.filter((member) => member.peerId === state.peer?.id);
  renderMembers();
  renderVoiceGrid();
  setConnectionState("Servidor offline", "warning");
  toast("A conexão com o anfitrião caiu por mais de 30 segundos. Vou continuar tentando reconectar.", "error");
}

function scheduleHostDisconnectGrace() {
  // v4.2.0: não força saída da call depois de um tempo offline.
  cancelHostDisconnectGrace();
}

function scheduleGuestDisconnect(peerId, connection) {
  if (state.guestConnections.get(peerId) !== connection) return;
  state.guestConnections.delete(peerId);
  window.clearTimeout(state.guestDisconnectTimers.get(peerId));
  const timer = window.setTimeout(() => {
    state.guestDisconnectTimers.delete(peerId);
    if (state.guestConnections.get(peerId)?.open) return;
    removeGuest(peerId);
  }, CONNECTION_GRACE_MS);
  state.guestDisconnectTimers.set(peerId, timer);
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function generateInviteToken() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function normalizeInviteToken(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function normalizeMediaSessionId(value) {
  const id = String(value || "").trim();
  return /^[a-z]+-[a-z0-9-]{8,100}$/i.test(id) ? id : "";
}

function normalizeJoinCode(value) {
  const raw = String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const parts = raw.split("-").filter(Boolean);
  if (parts.length <= 1) return raw.replace(/-/g, "").slice(0, 8);
  return `${parts[0].slice(0, 8)}-${parts.slice(1).join("").slice(0, 6)}`;
}

function parseJoinCode(value) {
  const normalized = normalizeJoinCode(value);
  const [room = "", token = ""] = normalized.split("-");
  return { roomCode: normalizeRoomCode(room), inviteToken: normalizeInviteToken(token) };
}

function currentInviteCode() {
  const room = normalizeRoomCode(state.roomCode);
  const token = normalizeInviteToken(state.server?.inviteToken);
  return token ? `${room}-${token}` : room;
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
    inviteToken: generateInviteToken(),
    pinnedMessageIds: [],
  };
}

function sanitizeServer(raw) {
  const base = createDefaultServer(raw?.name);
  const roles = Array.isArray(raw?.roles) ? raw.roles.slice(0, MAX_SERVER_ROLES).map((role) => ({
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
    roles: uniqueRoles.slice(0, MAX_SERVER_ROLES),
    ownerPeerId: raw?.ownerPeerId ? String(raw.ownerPeerId).slice(0, 120) : null,
    ownerClientId: sanitizeClientId(raw?.ownerClientId),
    inviteToken: normalizeInviteToken(raw?.inviteToken) || base.inviteToken,
    pinnedMessageIds: Array.isArray(raw?.pinnedMessageIds) ? [...new Set(raw.pinnedMessageIds.map(sanitizeTransferId).filter(Boolean))].slice(-50) : [],
  };
}

function normalizeRoleIds(roleIds) {
  if (!Array.isArray(roleIds)) return ["membro"];
  const known = new Set(state.server.roles.map((role) => role.id));
  const ids = [...new Set(roleIds.map(String).filter((id) => known.has(id)))].slice(0, MAX_SERVER_ROLES);
  if (!ids.includes("membro")) ids.unshift("membro");
  return ids.slice(0, MAX_SERVER_ROLES);
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
  const visualCustom = assigned.filter((role) => role.id !== "membro" && role.id !== "admin" && !role.admin);
  if (visualCustom.length) return visualCustom.at(-1);
  const customRoles = assigned.filter((role) => role.id !== "membro" && role.id !== "admin");
  if (customRoles.length) return customRoles.at(-1);
  return assigned.find((role) => role.admin) || assigned.find((role) => role.id === "membro") || null;
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

function pendingProfileKey(clientId, kind) {
  return `${sanitizeClientId(clientId)}:${String(kind || "")}`;
}

function rememberPendingProfileMedia(clientId, kind, value) {
  const id = sanitizeClientId(clientId);
  if (!id || !["avatar", "banner"].includes(kind)) return;
  const safe = sanitizeProfileMedia(kind, value);
  if (!safe) return;
  state.pendingProfileMedia.set(pendingProfileKey(id, kind), safe);
}

function applyPendingProfileMediaToMembers() {
  if (!state.pendingProfileMedia.size) return;
  for (const [key, value] of [...state.pendingProfileMedia.entries()]) {
    const split = key.lastIndexOf(":");
    const clientId = key.slice(0, split);
    const kind = key.slice(split + 1);
    const member = memberByClientId(clientId);
    if (!member) continue;
    member[kind] = value;
    state.pendingProfileMedia.delete(key);
    void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({
      clientId,
      [kind]: value,
      bio: member.bio || "",
    })).catch(() => undefined);
  }
}

function scheduleOwnProfileResync(delay = 180) {
  window.clearTimeout(state.profileResyncTimer);
  state.profileResyncTimer = window.setTimeout(() => {
    if (!state.hostConnection?.open) return;
    void sendOwnProfileMediaToHost();
  }, Math.max(50, Number(delay) || 180));
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
  if (!member) {
    rememberPendingProfileMedia(transfer.clientId, transfer.kind, safe);
    return;
  }
  void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({
    clientId: transfer.clientId,
    [transfer.kind]: safe,
    bio: member.bio || "",
  })).catch(() => undefined);
  if (state.isHost && !state.cloudMode) {
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
  if (state.isHost && !state.cloudMode) {
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

  const self = state.members.find((member) => member.peerId === state.peer.id);
  if (self) {
    self.avatar = state.avatarData;
    self.banner = state.bannerData;
    self.bio = cleanBio(state.profileBio);
    self.presence = normalizePresence(state.presenceStatus);
    self.name = state.nickname || self.name;
  }
  renderMembers();

  if (state.isHost) {
    void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({
      clientId: state.clientId,
      avatar: state.avatarData,
      banner: state.bannerData,
      bio: cleanBio(state.profileBio),
    })).catch(() => undefined);
    scheduleServerPersistence();
  }

  if (state.hostConnection?.open) {
    state.hostConnection.send({
      type: "profile",
      nickname: state.nickname,
      bio: cleanBio(state.profileBio),
      presence: normalizePresence(state.presenceStatus),
      clientId: state.clientId,
    });
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
  const parsedJoin = resuming && binding ? { roomCode: normalizeRoomCode(binding.roomCode), inviteToken: normalizeInviteToken(binding.inviteToken) } : parseJoinCode(elements.roomInput.value);
  const roomCode = parsedJoin.roomCode;
  if (!nickname) { setLobbyStatus("Coloque um apelido para entrar.", "error"); elements.nicknameInput.focus(); return; }
  if (roomCode.length < 4) { setLobbyStatus("O código precisa ter pelo menos 4 caracteres.", "error"); elements.roomInput.focus(); return; }

  state.nickname = nickname;
  state.roomCode = roomCode;
  state.joinInviteToken = parsedJoin.inviteToken;
  state.isHost = mode === "create" || mode === "resume-host";
  state.cloudReady = false;
  state.cloudOwnerKey = state.isHost ? getOrCreateCloudOwnerKey() : "";
  state.inVoice = false;
  state.voicePresenceRevision = 0;
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
  setLobbyStatus(state.isHost ? "Conectando seu servidor ao Cloudflare…" : "Conectando ao servidor do Resenhazinha…");

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

  // Cloudflare é a autoridade do servidor. PeerJS fica apenas para mídia P2P.
  state.peer = new Peer(undefined, PEER_OPTIONS);
  bindPeerEvents();
}


function bindPeerEvents() {
  state.peer.on("open", () => {
    if (state.isHost) {
      state.server.ownerPeerId = state.peer.id;
      state.server.ownerClientId = sanitizeClientId(state.server.ownerClientId) || state.clientId;
      if (!state.memberRegistry.has(state.clientId)) {
        state.memberRegistry.set(state.clientId, {
          clientId: state.clientId,
          name: state.nickname,
          bio: cleanBio(state.profileBio),
          presence: normalizePresence(state.presenceStatus),
          roleIds: ["membro", "admin"],
          serverMuted: false,
          lastSeenAt: Date.now(),
        });
      }
      saveServerBinding({
        roomCode: state.roomCode,
        inviteToken: state.server.inviteToken,
        isOwner: true,
        serverName: state.server.name,
        ownerKey: state.cloudOwnerKey,
        cloudMigrated: Boolean(state.serverBinding?.cloudMigrated),
      });
    }
    connectToHost();
  });

  state.peer.on("call", handleIncomingCall);

  state.peer.on("disconnected", () => {
    // A mídia já estabelecida não depende do canal de sinalização.
    setConnectionState(state.hostConnection?.open ? "Nuvem conectada · mídia indisponível" : "Reconectando à nuvem…", "warning");
  });

  state.peer.on("error", (error) => {
    console.warn("[Resenhazinha] PeerJS mídia:", error);
    if (!state.roomEntered && !state.hostConnection?.open) {
      setLobbyStatus("Não consegui preparar a conexão de mídia. Verifique sua internet e tente novamente.", "error");
    }
  });
}


function connectToHost(isReconnect = false) {
  if (!state.peer?.open || !state.roomCode) return;
  if (state.hostConnection?.open) return;
  if (state.hostConnection && !state.hostConnection.closed) return;

  const inviteToken = state.isHost
    ? normalizeInviteToken(state.server.inviteToken || state.serverBinding?.inviteToken)
    : normalizeInviteToken(state.joinInviteToken || state.serverBinding?.inviteToken);

  const socketUrl = buildCloudSocketUrl({
    room: state.roomCode,
    mode: state.isHost ? "create" : "join",
    clientId: state.clientId,
    peerId: state.peer.id,
    nickname: state.nickname,
    bio: cleanBio(state.profileBio),
    presence: normalizePresence(state.presenceStatus),
    inviteToken,
    serverName: state.server.name,
    ownerKey: state.isHost ? state.cloudOwnerKey : "",
    recoverOwner: state.isHost ? "1" : "",
  });

  const connection = new CloudConnection(socketUrl);
  state.hostConnection = connection;

  const timeout = window.setTimeout(() => {
    if (connection.open) return;
    if (!state.roomEntered) {
      setLobbyBusy(false);
      setLobbyStatus("O servidor Cloudflare não respondeu. Tente novamente em alguns segundos.", "error");
      connection.close();
      if (state.peer && !state.peer.destroyed) state.peer.destroy();
      state.peer = null;
    } else {
      setConnectionState("Nuvem offline", "warning");
      scheduleHostReconnect();
    }
  }, isReconnect ? 9000 : 12000);

  connection.on("open", () => {
    window.clearTimeout(timeout);
    window.clearTimeout(state.reconnectTimer);
    cancelHostDisconnectGrace();

    connection.send({
      type: "join",
      nickname: state.nickname,
      bio: cleanBio(state.profileBio),
      presence: normalizePresence(state.presenceStatus),
      clientId: state.clientId,
      inviteToken,
    });
    connection.send({ type: "status", ...localVoicePresenceState() });

    startConnectionHeartbeat();
    window.setTimeout(sendOwnProfileMediaToHost, 120);

    if (!state.serverBinding) {
      saveServerBinding({
        roomCode: state.roomCode,
        inviteToken,
        isOwner: state.isHost,
        serverName: state.server.name,
        ownerKey: state.isHost ? state.cloudOwnerKey : "",
        cloudMigrated: state.isHost,
      });
    }

    setConnectionState("Nuvem conectada", "ok");
  });

  connection.on("data", (message) => {
    if (state.hostConnection === connection) handleHostMessage(message);
  });

  connection.on("close", () => {
    window.clearTimeout(timeout);
    if (state.hostConnection !== connection) return;
    state.hostConnection = null;
    state.cloudReady = false;
    stopConnectionHeartbeat();
    if (state.roomEntered) {
      setConnectionState("Reconectando à nuvem…", "warning");
      scheduleHostReconnect(700);
    }
  });

  connection.on("error", () => {
    if (state.hostConnection !== connection) return;
    if (!state.roomEntered) {
      setLobbyStatus("Não consegui conectar ao servidor Cloudflare do Resenhazinha.", "error");
    } else {
      setConnectionState("Reconectando à nuvem…", "warning");
      scheduleHostReconnect(900);
    }
  });
}


function claimGuestIdentity(clientId, peerId) {
  if (!clientId) return null;
  let migratedMember = null;
  for (const [previousPeerId, previousMember] of [...state.hostMembers.entries()]) {
    if (previousPeerId === peerId || sanitizeClientId(previousMember.clientId) !== clientId) continue;
    migratedMember ||= { ...previousMember, peerId, inVoice: false, voiceJoinedAt: null, voiceSessionId: "" };
    window.clearTimeout(state.guestDisconnectTimers.get(previousPeerId));
    state.guestDisconnectTimers.delete(previousPeerId);
    state.pendingGuestProfiles.delete(previousPeerId);
    state.hostMembers.delete(previousPeerId);
    const previousConnection = state.guestConnections.get(previousPeerId);
    state.guestConnections.delete(previousPeerId);
    closeCallsForPeer(previousPeerId);
    try { previousConnection?.close?.(); } catch (_error) {}
  }
  return migratedMember;
}

function acceptGuestConnection(connection) {
  connection.on("data", (message) => {
    if (state.guestConnections.get(connection.peer) === connection) handleGuestMessage(connection.peer, message);
  });
  connection.on("close", () => scheduleGuestDisconnect(connection.peer, connection));
  connection.on("error", () => scheduleGuestDisconnect(connection.peer, connection));
  connection.on("open", () => {
    window.clearTimeout(state.guestDisconnectTimers.get(connection.peer));
    state.guestDisconnectTimers.delete(connection.peer);
    const pendingProfile = state.pendingGuestProfiles.get(connection.peer);
    const clientId = sanitizeClientId(pendingProfile?.clientId || connection.metadata?.clientId);
    if (clientId && clientId === state.clientId && connection.peer !== state.peer?.id) {
      connection.send({ type: "invalid-invite", serverName: state.server.name });
      window.setTimeout(() => connection.close(), 180);
      return;
    }
    if (clientId && state.revokedClientIds.has(clientId)) {
      connection.send({ type: "server-kicked", serverName: state.server.name });
      window.setTimeout(() => connection.close(), 180);
      return;
    }
    const rememberedClient = Boolean(clientId && state.memberRegistry.has(clientId));
    const suppliedInvite = normalizeInviteToken(connection.metadata?.inviteToken || pendingProfile?.inviteToken);
    if (!rememberedClient && suppliedInvite !== normalizeInviteToken(state.server.inviteToken)) {
      connection.send({ type: "invalid-invite", serverName: state.server.name });
      window.setTimeout(() => connection.close(), 180);
      return;
    }
    const migratedMember = claimGuestIdentity(clientId, connection.peer);
    const existingMember = state.hostMembers.get(connection.peer) || migratedMember;
    if (!existingMember && state.hostMembers.size >= MAX_MEMBERS) { connection.send({ type: "room-full" }); window.setTimeout(() => connection.close(), 250); return; }
    const nickname = cleanNickname(pendingProfile?.name || connection.metadata?.nickname || existingMember?.name || "Amigo");
    state.guestConnections.set(connection.peer, connection);
    const member = existingMember || applyRememberedMemberState(memberFrom(connection.peer, nickname, false, pendingProfile?.avatar || null, clientId, pendingProfile?.banner || null, pendingProfile?.bio || "", pendingProfile?.presence || DEFAULT_PRESENCE));
    member.name = nickname || member.name;
    if (clientId) member.clientId = clientId;
    if (pendingProfile?.bio) member.bio = cleanBio(pendingProfile.bio);
    if (pendingProfile?.presence) member.presence = normalizePresence(pendingProfile.presence);
    member.sessionStartedAt = Date.now();
    applyRememberedMemberState(member);
    state.hostMembers.set(connection.peer, member);
    state.pendingGuestProfiles.delete(connection.peer); state.members = Array.from(state.hostMembers.values());
    broadcastRoster(true); connection.send({ type: "chat-history", messages: state.chatMessages.slice(-MAX_CHAT_HISTORY) }); window.setTimeout(() => sendAllProfileMediaToGuest(connection), 120); scheduleServerPersistence(); if (!existingMember) toast(`${nickname} entrou no servidor.`);
  });
}


function handleGuestMessage(peerId, message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "heartbeat") {
    const voiceChanged = message.voiceState ? applyGuestVoiceStatus(peerId, message.voiceState) : false;
    const connection = state.guestConnections.get(peerId);
    if (connection?.open) { try { connection.send({ type: "heartbeat-ack", at: message.at, serverAt: Date.now() }); } catch (_error) {} }
    if (voiceChanged) broadcastRoster(false);
    return;
  }
  if (message.type === "member-left-server-v306") {
    const member = state.hostMembers.get(peerId);
    const clientId = sanitizeClientId(message.clientId || member?.clientId);
    const memberNameValue = member?.name || "Um membro";
    if (clientId) {
      state.memberRegistry.delete(clientId);
      void Promise.resolve(window.resenhazinhaDesktop?.deleteMemberProfile?.(clientId)).catch(() => undefined);
    }
    state.pendingGuestProfiles.delete(peerId);
    state.guestConnections.delete(peerId);
    state.hostMembers.delete(peerId);
    state.members = Array.from(state.hostMembers.values());
    closeCallsForPeer(peerId);
    state.activeScreens.delete(peerId);
    state.activeScreen = state.activeScreens.values().next().value || null;
    clearScreenStage(peerId);
    broadcastRoster(false);
    scheduleServerPersistence();
    toast(`${memberNameValue} saiu do servidor.`);
    return;
  }
  if (message.type === "join") {
    const member = state.hostMembers.get(peerId); const profile = { name: cleanNickname(message.nickname || member?.name || "Amigo") || "Amigo", bio: cleanBio(message.bio || ""), presence: normalizePresence(message.presence), clientId: sanitizeClientId(message.clientId || member?.clientId), inviteToken: normalizeInviteToken(message.inviteToken) };
    if (!member) { state.pendingGuestProfiles.set(peerId, profile); return; }
    member.name = profile.name; member.bio = profile.bio; member.presence = profile.presence; if (profile.clientId) member.clientId = profile.clientId; applyRememberedMemberState(member); state.members = Array.from(state.hostMembers.values()); rememberMember(member); void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({ clientId: member.clientId, bio: member.bio })).catch(() => undefined); broadcastRoster(true); scheduleServerPersistence();
  }
  if (message.type === "profile") { const member = state.hostMembers.get(peerId); if (member) { const nextName = cleanNickname(message.nickname || member.name) || member.name; member.name = nextName; member.bio = cleanBio(message.bio || ""); member.presence = normalizePresence(message.presence); rememberMember(member); void Promise.resolve(window.resenhazinhaDesktop?.cacheMemberProfile?.({ clientId: member.clientId, bio: member.bio })).catch(() => undefined); state.members = Array.from(state.hostMembers.values()); broadcastRoster(true); scheduleServerPersistence(); } }
  if (message.type === "profile-media-start") { const member = state.hostMembers.get(peerId); if (member && sanitizeClientId(message.clientId) === sanitizeClientId(member.clientId)) beginProfileMediaTransfer(peerId, message); }
  if (message.type === "profile-media-chunk") receiveProfileMediaChunk(message);
  if (message.type === "profile-media-complete") void finishProfileMediaTransfer(peerId, message);
  if (message.type === "profile-media-clear") { const member = state.hostMembers.get(peerId); if (member && sanitizeClientId(message.clientId) === sanitizeClientId(member.clientId)) clearProfileMedia(peerId, message); }
  if (message.type === "chat-send") acceptChatMessage(peerId, message.text, [], message.replyToMessageId);
  if (message.type === "chat-upload-start") beginIncomingChatUpload(peerId, message);
  if (message.type === "chat-upload-chunk") receiveIncomingChatUploadChunk(peerId, message);
  if (message.type === "chat-upload-complete") void finalizeIncomingChatUpload(peerId, message);
  if (message.type === "chat-edit") acceptChatEdit(peerId, message.messageId, message.text);
  if (message.type === "chat-delete") void acceptChatDelete(peerId, message.messageId);
  if (message.type === "chat-reaction") acceptChatReaction(peerId, message.messageId, message.emoji);
  if (message.type === "attachment-request") void sendAttachmentToGuest(peerId, message.attachmentId);
  if (message.type === "status") {
    if (applyGuestVoiceStatus(peerId, message)) broadcastRoster(false);
  }
  if (message.type === "admin-action") applyAdminAction(peerId, message.action, message.payload);
  if (message.type === "screen-started") {
    const member = state.hostMembers.get(peerId);
    if (!member?.inVoice || !state.server.voiceChannel.exists) return;
    state.activeScreens.set(peerId, { peerId, name: member.name, screenSessionId: normalizeMediaSessionId(message.screenSessionId) });
    state.activeScreen = state.activeScreens.values().next().value || null;
    broadcastRoster(false);
  }
  if (message.type === "screen-stopped") {
    const announced = state.activeScreens.get(peerId);
    const stoppedSessionId = normalizeMediaSessionId(message.screenSessionId);
    if (stoppedSessionId && announced?.screenSessionId && stoppedSessionId !== announced.screenSessionId) return;
    state.activeScreens.delete(peerId);
    state.activeScreen = state.activeScreens.values().next().value || null;
    clearScreenStage(peerId);
    broadcastRoster(false);
  }
}


function handleHostMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "heartbeat-ack") return;

  if (message.type === "voice-presence") {
    applyCloudVoicePresence(message);
    return;
  }

  if (message.type === "screen-presence") {
    applyCloudScreenPresence(message);
    return;
  }

  if (message.type === "profile-media-request-self") {
    scheduleOwnProfileResync(240);
    return;
  }

  if (message.type === "cloud-ready") {
    state.cloudReady = true;
    if (state.isHost && normalizeInviteToken(message.inviteToken)) {
      state.server.inviteToken = normalizeInviteToken(message.inviteToken);
    }

    if (state.isHost && message.created && state.hostConnection?.open) {
      const backup = persistentServerPayload();
      state.hostConnection.send({
        type: "cloud-bootstrap",
        server: backup.server,
        members: backup.members,
        chatMessages: backup.chatMessages,
      });
    }

    saveServerBinding({
      roomCode: state.roomCode,
      inviteToken: state.server.inviteToken || state.joinInviteToken || state.serverBinding?.inviteToken,
      isOwner: state.isHost,
      serverName: state.server.name,
      ownerKey: state.isHost ? state.cloudOwnerKey : "",
      cloudMigrated: state.isHost,
    });

    if (!state.roomEntered) {
      openRoomView();
      renderChatHistory();
    }
    setConnectionState("Nuvem conectada", "ok");
    unlockUiAudio();
    if (state.hostConnection?.open) {
      state.hostConnection.send({ type: "profile-media-request-all" });
      scheduleOwnProfileResync(320);
    }
    return;
  }

  if (message.type === "room-not-found") {
    setLobbyBusy(false);
    setConnectionState("Servidor não encontrado", "danger");
    if (!state.roomEntered) setLobbyStatus("Esse servidor ainda não existe na nuvem. O Owner precisa abrir a versão nova uma vez.", "error");
    return;
  }

  if (message.type === "owner-auth-failed") {
    setLobbyBusy(false);
    setConnectionState("Falha ao validar Owner", "danger");
    toast("Não consegui validar o Owner no servidor Cloudflare.", "error");
    return;
  }

  if (message.type === "force-voice-leave") {
    const incomingRevision = normalizeVoicePresenceRevision(message.voicePresenceRevision);
    if (shouldApplyVoicePresenceSnapshot(state.voicePresenceRevision, incomingRevision)) {
      state.voicePresenceRevision = incomingRevision;
      if (state.inVoice) leaveVoiceChannel({ forced: true, message: "Você foi removido da call por um ADM." });
    }
    return;
  }
  if (message.type === "server-deleted-v306") {
    const serverName = cleanServerName(message.serverName || state.server?.name || state.serverBinding?.serverName || "servidor");
    clearServerBinding();
    sessionStorage.setItem("resenhazinha:server-action-notice", `O servidor ${serverName} foi excluído pelo dono.`);
    state.roomEntered = false;
    teardownConnections();
    window.setTimeout(() => window.location.reload(), 80);
    return;
  }
  if (message.type === "server-kicked") {
    const serverName = cleanServerName(message.serverName || state.server?.name || "servidor");
    clearServerBinding();
    rotateClientIdAfterKick();
    sessionStorage.setItem("resenhazinha:kicked-notice", `Você foi expulso de ${serverName}. Se quiser voltar, peça o código e entre novamente.`);
    teardownConnections();
    window.setTimeout(() => window.location.reload(), 80);
    return;
  }
  if (message.type === "invalid-invite") {
    clearServerBinding();
    setConnectionState("Convite inválido", "danger");
    toast("Esse convite foi trocado pelo Owner. Peça o código novo para entrar.", "error");
    window.setTimeout(() => { teardownConnections(); state.peer = null; state.roomEntered = false; elements.roomView.hidden = true; elements.lobbyView.hidden = false; setLobbyBusy(false); setLobbyStatus("Convite antigo ou inválido. Peça o código novo ao Owner.", "error"); }, 250);
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
  if (message.type === "chat-message-reaction") { applyIncomingChatReaction(message); return; }
  if (message.type === "chat-upload-error") { state.chatSending = false; updateChatComposerState(); toast(cleanUploadError(message.reason), "error"); return; }
  if (message.type === "attachment-data-start") { beginAttachmentDownload(message); return; }
  if (message.type === "attachment-data-chunk") { receiveAttachmentDownloadChunk(message); return; }
  if (message.type === "attachment-data-complete") { finishAttachmentDownload(message); return; }
  if (message.type === "profile-media-start") { beginProfileMediaTransfer("host", message); return; }
  if (message.type === "profile-media-chunk") { receiveProfileMediaChunk(message); return; }
  if (message.type === "profile-media-complete") { void finishProfileMediaTransfer("host", message); return; }
  if (message.type === "profile-media-clear") { clearProfileMedia("host", message); return; }
  if (message.type === "roster") {
    const wasLocallyInVoice = state.inVoice;
    const previousMembers = new Map(state.members.map((member) => [member.peerId, member]));
    const previousByClient = new Map(state.members.filter((member) => member.clientId).map((member) => [member.clientId, member]));
    state.server = sanitizeServer(message.server || state.server);
    state.moderationLog = sanitizeModerationLog(message.moderationLog || state.moderationLog);
    const rosterMembers = (message.members || []).map((member) => {
      const peerId = String(member.peerId || "").slice(0, 120);
      const clientId = sanitizeClientId(member.clientId);
      const previous = previousMembers.get(peerId) || (clientId ? previousByClient.get(clientId) : null);
      return {
        peerId, clientId, name: cleanNickname(member.name || "Amigo") || "Amigo",
        muted: Boolean(member.muted), deafened: Boolean(member.deafened), serverMuted: Boolean(member.serverMuted), inVoice: Boolean(member.inVoice) && state.server.voiceChannel.exists,
        voiceJoinedAt: Boolean(member.inVoice) ? normalizeVoiceJoinedAt(member.voiceJoinedAt) : null,
        voiceSessionId: Boolean(member.inVoice) ? normalizeMediaSessionId(member.voiceSessionId) : "",
        voicePresenceRevision: normalizeVoicePresenceRevision(member.voicePresenceRevision ?? previous?.voicePresenceRevision),
        voicePresenceExplicit: member.voicePresenceRevision !== undefined && member.voicePresenceRevision !== null,
        sessionStartedAt: Number(member.sessionStartedAt) || 0,
        roleIds: normalizeRoleIds(member.roleIds),
        avatar: previous?.avatar || state.pendingProfileMedia.get(pendingProfileKey(clientId, "avatar")) || (peerId === state.peer?.id ? state.avatarData : null),
        banner: previous?.banner || state.pendingProfileMedia.get(pendingProfileKey(clientId, "banner")) || (peerId === state.peer?.id ? state.bannerData : null),
        bio: message.includeProfiles ? cleanBio(member.bio || previous?.bio || "") : previous?.bio || (peerId === state.peer?.id ? cleanBio(state.profileBio) : ""),
        presence: normalizePresence(member.presence || previous?.presence || (peerId === state.peer?.id ? state.presenceStatus : DEFAULT_PRESENCE)),
        offlineSnapshot: Boolean(member.offlineSnapshot),
      };
    });
    state.members = dedupeMembersByIdentity(rosterMembers);
    applyPendingProfileMediaToMembers();
    const self = state.members.find((member) => member.peerId === state.peer?.id);
    if (self) {
      self.clientId = self.clientId || state.clientId;
      const localRevision = normalizeVoicePresenceRevision(state.voicePresenceRevision);
      const incomingRevision = normalizeVoicePresenceRevision(self.voicePresenceRevision);
      const authoritativeVoiceState = !wasLocallyInVoice
        || !state.server.voiceChannel.exists
        || (self.voicePresenceExplicit && shouldApplyVoicePresenceSnapshot(localRevision, incomingRevision));

      if (authoritativeVoiceState) {
        state.voicePresenceRevision = Math.max(localRevision, incomingRevision);
        state.inVoice = self.inVoice;
        state.voiceJoinedAt = self.inVoice ? (normalizeVoiceJoinedAt(self.voiceJoinedAt) || state.voiceJoinedAt || Date.now()) : null;
      } else {
        self.inVoice = state.inVoice && state.server.voiceChannel.exists;
        self.voiceJoinedAt = self.inVoice ? (normalizeVoiceJoinedAt(state.voiceJoinedAt) || Date.now()) : null;
        self.voiceSessionId = self.inVoice ? callSessions.sessionId("voice") : "";
        self.voicePresenceRevision = localRevision;
      }
      state.serverMuted = self.serverMuted;
      applyLocalAudioState();
    }
    state.members.forEach((member) => { delete member.voicePresenceExplicit; });
    if (wasLocallyInVoice && !state.inVoice) {
      if (state.screenStream) stopScreenShare();
      if (state.cameraStream) stopCamera();
      closeAllMediaCalls();
      stopMicrophoneCapture();
      stopAllSpeakingDetectors();
    }
    if (state.serverBinding && state.serverBinding.serverName !== state.server.name) saveServerBinding({ ...state.serverBinding, serverName: state.server.name });
    const previousScreenIds = new Set(state.activeScreens.keys());
    const announcedScreens = Array.isArray(message.activeScreens) ? message.activeScreens : (message.activeScreen ? [message.activeScreen] : []);
    state.activeScreens = new Map(announcedScreens.map((screen) => [String(screen.peerId || ""), { peerId: String(screen.peerId || ""), name: cleanNickname(screen.name || memberName(screen.peerId) || "Amigo") || "Amigo", screenSessionId: normalizeMediaSessionId(screen.screenSessionId) }]).filter(([peerId]) => peerId));
    state.activeScreen = state.activeScreens.values().next().value || null;
    if (!state.inVoice && state.screenStream) stopScreenShare();
    if (!state.inVoice && state.cameraStream) stopCamera();
    previousScreenIds.forEach((peerId) => { if (!state.activeScreens.has(peerId) && peerId !== state.peer?.id) clearScreenStage(peerId); });
    ensureValidView(); renderServerUI(); renderMembers(); renderVoiceGrid(); renderScreenStage(); updateControlState();
    if (elements.serverDialog.open) renderServerSettings(); if (elements.memberDialog.open) renderMemberDialog();
    if (message.includeProfiles) renderChatHistory();
    reconcileVoiceCalls(); reconcileScreenCalls(); reconcileCameraCalls();
    if (state.inVoice) scheduleMediaReconcileBurst();
    if (state.resumeVoiceAfterReconnect && !state.inVoice && state.server.voiceChannel.exists) {
      state.resumeVoiceAfterReconnect = false;
      window.setTimeout(() => void joinVoiceChannel(), 250);
    }
  }
}


function guestHasLiveMedia(peerId) {
  return Boolean(
    state.voiceCalls.has(peerId)
    || state.screenCallsOut.has(peerId)
    || state.screenCallsIn.has(peerId)
    || state.activeScreens.has(peerId)
  );
}


function removeGuest(peerId) {
  state.pendingGuestProfiles.delete(peerId);
  const member = state.hostMembers.get(peerId);
  if (!state.hostMembers.has(peerId)) return;

  // O canal de controle PeerJS e a mídia WebRTC são conexões diferentes.
  // Nunca fecha voz/tela que continuam vivas só porque o controle deu erro/close.
  if (guestHasLiveMedia(peerId)) {
    const connection = state.guestConnections.get(peerId);
    if (connection && !connection.open) state.guestConnections.delete(peerId);

    console.warn("[Resenhazinha] Controle do convidado caiu; mídia continua ativa.", peerId);

    // Se a pessoa realmente fechou o app, a mídia também vai cair.
    // Só então limpamos o membro; não existe reconnect automático aqui.
    window.setTimeout(() => {
      if (!state.hostMembers.has(peerId)) return;
      if (state.guestConnections.get(peerId)?.open) return;
      if (guestHasLiveMedia(peerId)) return;
      removeGuest(peerId);
    }, 15000);
    return;
  }

  if (member) rememberMember(member);
  state.guestConnections.delete(peerId);
  state.hostMembers.delete(peerId);
  state.members = Array.from(state.hostMembers.values());
  closeCallsForPeer(peerId);
  state.activeScreens.delete(peerId);
  state.activeScreen = state.activeScreens.values().next().value || null;
  clearScreenStage(peerId);
  broadcastRoster(false);
  scheduleServerPersistence();
  if (member) toast(`${member.name} ficou offline.`);
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
    voiceJoinedAt: null,
    avatar: sanitizeAvatar(record?.avatar),
    banner: sanitizeProfileBanner(record?.banner),
    bio: cleanBio(record?.bio || ""),
    presence: "offline",
    roleIds: normalizeRoleIds(record?.roleIds || ["membro"]),
    offlineSnapshot: true,
  };
}

function composeRosterMembers() {
  const live = dedupeMembersByIdentity(Array.from(state.hostMembers.values()));
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
  if (!state.isHost || state.cloudMode) return;
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
      voiceJoinedAt: member.inVoice ? normalizeVoiceJoinedAt(member.voiceJoinedAt) : null,
      voiceSessionId: member.inVoice ? normalizeMediaSessionId(member.voiceSessionId) : "",
      voicePresenceRevision: normalizeVoicePresenceRevision(member.voicePresenceRevision),
      sessionStartedAt: Number(member.sessionStartedAt) || 0,
      roleIds: member.roleIds || ["membro"],
      presence: normalizePresence(member.presence),
      offlineSnapshot: Boolean(member.offlineSnapshot),
      ...(includeProfiles ? { bio: member.bio } : {}),
    })),
    activeScreen: state.activeScreens.values().next().value || null,
    activeScreens: Array.from(state.activeScreens.values()),
    moderationLog: sanitizeModerationLog(state.moderationLog).slice(-80) };
  state.guestConnections.forEach((connection) => { if (connection.open) connection.send(payload); });
  ensureValidView(); renderServerUI(); renderMembers(); renderVoiceGrid(); updateControlState(); if (includeProfiles) renderChatHistory(); reconcileVoiceCalls(); reconcileScreenCalls(); reconcileCameraCalls();
}



function sanitizeModerationLog(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-80).map((entry) => ({
    id: sanitizeTransferId(entry?.id) || crypto.randomUUID(),
    at: Number(entry?.at) || Date.now(),
    actor: cleanNickname(entry?.actor || "ADM") || "ADM",
    action: String(entry?.action || "Ação de moderação").replace(/[\r\n\u0000]/g, " ").slice(0, 180),
  }));
}

function memberHierarchyRank(memberOrPeerId) {
  const peerId = typeof memberOrPeerId === "string" ? memberOrPeerId : memberOrPeerId?.peerId;
  if (peerId && isServerOwner(peerId)) return Number.POSITIVE_INFINITY;
  const member = typeof memberOrPeerId === "string" ? state.hostMembers.get(memberOrPeerId) || state.members.find((item) => item.peerId === memberOrPeerId) : memberOrPeerId;
  const ids = new Set(member?.roleIds || []);
  let rank = 0;
  state.server.roles.forEach((role, index) => {
    if (!ids.has(role.id)) return;
    const base = role.admin ? 1000 : role.id === "membro" ? 0 : 100;
    rank = Math.max(rank, base + index);
  });
  return rank;
}

function canModerateTarget(requesterPeerId, target) {
  if (!target) return false;
  if (isServerOwner(requesterPeerId)) return true;
  if (isServerOwner(target.peerId)) return false;
  return memberHasAdmin(requesterPeerId) && memberHierarchyRank(requesterPeerId) > memberHierarchyRank(target);
}

function moderationActorName(peerId) {
  return state.hostMembers.get(peerId)?.name || state.members.find((item) => item.peerId === peerId)?.name || (isServerOwner(peerId) ? state.nickname : "ADM");
}

function recordModeration(peerId, action) {
  if (!state.isHost) return;
  state.moderationLog.push({ id: crypto.randomUUID(), at: Date.now(), actor: moderationActorName(peerId), action: String(action || "Ação de moderação").slice(0, 180) });
  state.moderationLog = state.moderationLog.slice(-80);
}

function requestAdminAction(action, payload = {}) {
  if (!canCurrentUserAdmin()) { toast("Você não tem permissão de administrador.", "error"); return; }
  if (!state.hostConnection?.open) { toast("O servidor Cloudflare está reconectando. Tente novamente.", "error"); return; }
  state.hostConnection.send({ type: "admin-action", action, payload });
}

function applyAdminAction(requesterPeerId, action, payload = {}) {
  if (!state.isHost || !memberHasAdmin(requesterPeerId)) return;
  const requesterIsOwner = isServerOwner(requesterPeerId);
  let changed = false;
  if (action === "invite-rotate") {
    if (!requesterIsOwner) return;
    state.server.inviteToken = generateInviteToken();
    recordModeration(requesterPeerId, "gerou um novo código de convite");
    changed = true;
  }
  if (action === "chat-pin") {
    const messageId = sanitizeTransferId(payload.messageId);
    const exists = state.chatMessages.some((message) => message.id === messageId);
    if (messageId && exists) {
      const ids = new Set(pinnedMessageIds());
      if (payload.pinned) ids.add(messageId); else ids.delete(messageId);
      state.server.pinnedMessageIds = [...ids].slice(-50);
      const message = state.chatMessages.find((item) => item.id === messageId);
      recordModeration(requesterPeerId, `${payload.pinned ? "fixou" : "desafixou"} uma mensagem de ${message?.name || "alguém"}`);
      changed = true;
    }
  }
  if (action === "server-name") { const previous = state.server.name; state.server.name = cleanServerName(payload.name); if (state.server.name !== previous) recordModeration(requesterPeerId, `renomeou o servidor para ${state.server.name}`); changed = true; }
  if (action === "server-icon") { state.server.icon = sanitizeServerIcon(payload.icon); recordModeration(requesterPeerId, `${state.server.icon ? "alterou" : "removeu"} a foto do servidor`); changed = true; }
  if (action === "channel-create") {
    if (payload.kind === "text" && !state.server.textChannel.exists) { state.server.textChannel = { exists: true, name: "chat-principal" }; recordModeration(requesterPeerId, "criou o canal de texto"); changed = true; }
    if (payload.kind === "voice" && !state.server.voiceChannel.exists) { state.server.voiceChannel = { exists: true, name: "call" }; recordModeration(requesterPeerId, "criou o canal de voz"); changed = true; }
  }
  if (action === "channel-rename") {
    if (payload.kind === "text" && state.server.textChannel.exists) { state.server.textChannel.name = cleanChannelName(payload.name, "chat-principal"); recordModeration(requesterPeerId, `renomeou o chat para #${state.server.textChannel.name}`); changed = true; }
    if (payload.kind === "voice" && state.server.voiceChannel.exists) { state.server.voiceChannel.name = cleanChannelName(payload.name, "call"); recordModeration(requesterPeerId, `renomeou a call para ${state.server.voiceChannel.name}`); changed = true; }
  }
  if (action === "channel-delete") {
    if (payload.kind === "text" && state.server.textChannel.exists) { state.server.textChannel.exists = false; recordModeration(requesterPeerId, "apagou o canal de texto"); changed = true; }
    if (payload.kind === "voice" && state.server.voiceChannel.exists) {
      state.server.voiceChannel.exists = false; state.hostMembers.forEach((member) => { member.inVoice = false; member.voiceJoinedAt = null; }); state.inVoice = false; state.voiceJoinedAt = null; if (state.cameraStream) stopCamera(); state.activeScreens.clear(); state.activeScreen = null; clearScreenStage();
      if (state.screenStream) stopScreenShare(); applyLocalAudioState(); recordModeration(requesterPeerId, "apagou o canal de voz"); changed = true;
    }
  }
  if (action === "role-create") {
    const name = cleanRoleName(payload.name);
    if (!name) { if (requesterPeerId === state.peer?.id) toast("Dê um nome para o cargo.", "error"); return; }
    if (state.server.roles.length >= MAX_SERVER_ROLES) { if (requesterPeerId === state.peer?.id) toast(`O servidor chegou ao limite de ${MAX_SERVER_ROLES} cargos.`, "error"); return; }
    if (!requesterIsOwner && Boolean(payload.admin)) { if (requesterPeerId === state.peer?.id) toast("Só o Owner pode criar um cargo de ADM.", "error"); return; }
    const createdRole = { id: crypto.randomUUID(), name, color: cleanRoleColor(payload.color), admin: Boolean(payload.admin) };
    state.server.roles.push(createdRole);
    recordModeration(requesterPeerId, `criou o cargo ${name}`);
    changed = true;
    if (requesterPeerId === state.peer?.id) toast(`Cargo ${name} criado.`);
  }
  if (action === "role-update") {
    const role = state.server.roles.find((item) => item.id === String(payload.roleId));
    if (role) {
      if (!requesterIsOwner && (role.admin || Boolean(payload.admin))) return;
      role.name = cleanRoleName(payload.name) || role.name; role.color = cleanRoleColor(payload.color || role.color); role.admin = role.id === "membro" ? false : Boolean(payload.admin); recordModeration(requesterPeerId, `alterou o cargo ${role.name}`); changed = true;
    }
  }
  if (action === "role-delete") {
    const roleId = String(payload.roleId || ""); if (roleId && roleId !== "membro" && roleId !== "admin") {
      const targetRole = state.server.roles.find((role) => role.id === roleId);
      if (!targetRole || (!requesterIsOwner && targetRole.admin)) return;
      const deletedName = targetRole.name;
      const before = state.server.roles.length; state.server.roles = state.server.roles.filter((role) => role.id !== roleId);
      if (state.server.roles.length !== before) { state.hostMembers.forEach((member) => { member.roleIds = normalizeRoleIds((member.roleIds || []).filter((id) => id !== roleId)); rememberMember(member); }); state.memberRegistry.forEach((record) => { record.roleIds = normalizeRoleIds((record.roleIds || []).filter((id) => id !== roleId)); }); recordModeration(requesterPeerId, `apagou o cargo ${deletedName}`); changed = true; }
    }
  }
  if (action === "role-move") {
    if (!requesterIsOwner) return;
    const roleId = String(payload.roleId || "");
    const direction = Number(payload.direction) < 0 ? -1 : 1;
    const index = state.server.roles.findIndex((role) => role.id === roleId);
    const nextIndex = index + direction;
    if (index >= 0 && nextIndex >= 0 && nextIndex < state.server.roles.length && roleId !== "membro") {
      const [role] = state.server.roles.splice(index, 1);
      state.server.roles.splice(nextIndex, 0, role);
      recordModeration(requesterPeerId, `moveu o cargo ${role.name} na hierarquia`);
      changed = true;
    }
  }
  if (action === "member-roles") {
    const target = state.hostMembers.get(String(payload.peerId || ""));
    if (target) {
      if (!canModerateTarget(requesterPeerId, target)) return;
      const requestedRoles = normalizeRoleIds(payload.roleIds);
      if (!requesterIsOwner && state.server.roles.some((role) => role.admin && requestedRoles.includes(role.id))) return;
      target.roleIds = requestedRoles; rememberMember(target); recordModeration(requesterPeerId, `alterou os cargos de ${target.name}`); changed = true;
    } else {
      const clientId = sanitizeClientId(payload.clientId);
      const record = clientId ? state.memberRegistry.get(clientId) : null;
      if (record) {
        if (clientId === state.server.ownerClientId && !requesterIsOwner) return;
        const targetSnapshot = registryOfflineMember(record);
        if (!requesterIsOwner && memberHierarchyRank(requesterPeerId) <= memberHierarchyRank(targetSnapshot)) return;
        const requestedRoles = normalizeRoleIds(payload.roleIds);
        if (!requesterIsOwner && state.server.roles.some((role) => role.admin && requestedRoles.includes(role.id))) return;
        record.roleIds = requestedRoles; record.lastSeenAt = Date.now(); recordModeration(requesterPeerId, `alterou os cargos de ${record.name}`); changed = true;
      }
    }
  }
  if (action === "server-mute") {
    const target = state.hostMembers.get(String(payload.peerId || ""));
    if (target && canModerateTarget(requesterPeerId, target)) { target.serverMuted = Boolean(payload.muted); rememberMember(target); if (target.peerId === state.peer.id) { state.serverMuted = target.serverMuted; applyLocalAudioState(); } recordModeration(requesterPeerId, `${target.serverMuted ? "mutou" : "desmutou"} ${target.name} no servidor`); changed = true; }
  }
  if (action === "disconnect-voice") {
    const target = state.hostMembers.get(String(payload.peerId || ""));
    if (target && target.inVoice && canModerateTarget(requesterPeerId, target)) {
      target.voicePresenceRevision = normalizeVoicePresenceRevision(target.voicePresenceRevision) + 1;
      target.inVoice = false;
      target.voiceJoinedAt = null;
      target.voiceSessionId = "";
      closeCallsForPeer(target.peerId);
      const targetConnection = state.guestConnections.get(target.peerId);
      if (targetConnection?.open) targetConnection.send({ type: "force-voice-leave", voicePresenceRevision: target.voicePresenceRevision });
      if (target.peerId === state.peer.id) {
        state.voicePresenceRevision = target.voicePresenceRevision;
        state.inVoice = false;
        state.voiceJoinedAt = null;
        applyLocalAudioState();
      }
      state.activeScreens.delete(target.peerId);
      state.activeScreen = state.activeScreens.values().next().value || null;
      clearScreenStage(target.peerId);
      recordModeration(requesterPeerId, `tirou ${target.name} da call`);
      changed = true;
    }
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
    const permissionTarget = target || (record ? registryOfflineMember(record) : null);
    if (!permissionTarget || !canModerateTarget(requesterPeerId, permissionTarget)) return;

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
    recordModeration(requesterPeerId, `expulsou ${targetName} do servidor`);
    changed = true;
  }
  if (!changed) return; state.server = sanitizeServer(state.server); state.server.ownerClientId = state.server.ownerClientId || state.clientId; state.server.ownerPeerId = state.peer?.id || state.server.ownerPeerId; if (state.serverBinding) saveServerBinding({ ...state.serverBinding, serverName: state.server.name }); broadcastRoster(true); scheduleServerPersistence(); if (elements.serverDialog.open) renderServerSettings(); if (elements.memberDialog.open) renderMemberDialog();
}

function createRoleFromSettings() {
  const name = cleanRoleName(elements.roleNameInput.value);
  if (!name) { toast("Dê um nome para o cargo.", "error"); elements.roleNameInput.focus(); return; }
  if (!canCurrentUserAdmin()) { toast("Você não tem permissão para criar cargos.", "error"); return; }
  if (state.server.roles.length >= MAX_SERVER_ROLES) { toast(`O servidor chegou ao limite de ${MAX_SERVER_ROLES} cargos.`, "error"); return; }
  requestAdminAction("role-create", { name, color: elements.roleColorInput.value, admin: elements.roleAdminInput.checked });
  elements.roleNameInput.value = "";
  elements.roleAdminInput.checked = false;
  if (state.isHost && !state.cloudMode) { renderRoleSettings(); scheduleServerPersistence(); }
}
function openServerSettings() {
  if (!canCurrentUserAdmin()) return;
  renderServerSettings();
  setServerSettingsTab(state.serverSettingsTab || "general");
  elements.serverDialog.showModal();
}

function setServerSettingsTab(tab = "general") {
  const allowed = ["general", "channels", "invite", "roles", "moderation"];
  const next = allowed.includes(String(tab)) ? String(tab) : "general";
  state.serverSettingsTab = next;
  document.querySelectorAll("[data-server-settings-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.serverSettingsTab === next));
  document.querySelectorAll("[data-server-settings-page]").forEach((page) => {
    const active = page.dataset.serverSettingsPage === next;
    page.hidden = !active;
    page.classList.toggle("is-active", active);
  });
  const titles = { general: "Geral", channels: "Canais", invite: "Convite", roles: "Cargos", moderation: "Moderação" };
  const title = document.getElementById("server-settings-page-title");
  if (title) title.textContent = titles[next] || "Geral";
}
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
  elements.voiceChannelSettingRow.hidden = !state.server.voiceChannel.exists; elements.createVoiceChannelSettingsButton.hidden = state.server.voiceChannel.exists; elements.voiceChannelSettings.value = state.server.voiceChannel.name;
  elements.inviteCodeSettings.textContent = currentInviteCode();
  elements.rotateInviteButton.hidden = !isServerOwner(state.peer?.id);
  elements.roleAdminInput.disabled = !isServerOwner(state.peer?.id);
  renderModerationLog();
  renderRoleSettings();
}

function renderModerationLog() {
  if (!elements.moderationLog) return;
  elements.moderationLog.replaceChildren();
  const entries = sanitizeModerationLog(state.moderationLog).slice(-30).reverse();
  if (!entries.length) { const empty = document.createElement("p"); empty.className = "moderation-log-empty"; empty.textContent = "Nenhuma ação registrada ainda."; elements.moderationLog.append(empty); return; }
  entries.forEach((entry) => {
    const row = document.createElement("div"); row.className = "moderation-log-row";
    const time = document.createElement("time"); time.textContent = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(entry.at);
    const copy = document.createElement("p"); const actor = document.createElement("strong"); actor.textContent = entry.actor; copy.append(actor, document.createTextNode(` ${entry.action}`));
    row.append(time, copy); elements.moderationLog.append(row);
  });
}

function renderRoleSettings() {
  if (!elements.roleList) return;
  state.server = sanitizeServer(state.server);
  elements.roleList.replaceChildren();
  const roles = [...state.server.roles].reverse();
  if (!roles.length) {
    const empty = document.createElement("p"); empty.className = "role-settings-empty"; empty.textContent = "Nenhum cargo encontrado. Crie um logo abaixo."; elements.roleList.append(empty); return;
  }
  roles.forEach((role) => {
    const row = document.createElement("div"); row.className = "role-setting-row";
    const dot = document.createElement("span"); dot.className = "role-color-dot"; dot.style.background = role.color;
    const name = document.createElement("input"); name.maxLength = 20; name.value = role.name;
    const color = document.createElement("input"); color.type = "color"; color.value = role.color; color.setAttribute("aria-label", `Cor de ${role.name}`);
    const admin = document.createElement("label"); admin.className = "admin-check"; const adminBox = document.createElement("input"); adminBox.type = "checkbox"; adminBox.checked = role.admin; adminBox.disabled = role.id === "membro" || (!isServerOwner(state.peer?.id) && role.admin); admin.append(adminBox, document.createTextNode(" ADM"));
    const save = document.createElement("button"); save.type = "button"; save.className = "mini-button"; save.textContent = "Salvar"; save.disabled = !isServerOwner(state.peer?.id) && role.admin; save.addEventListener("click", () => requestAdminAction("role-update", { roleId: role.id, name: name.value, color: color.value, admin: adminBox.checked }));
    const order = document.createElement("div"); order.className = "role-order-controls";
    if (isServerOwner(state.peer?.id) && role.id !== "membro") { const up = document.createElement("button"); up.type = "button"; up.className = "mini-button role-order-button"; up.textContent = "↑"; up.title = "Subir na hierarquia"; up.addEventListener("click", () => requestAdminAction("role-move", { roleId: role.id, direction: 1 })); const down = document.createElement("button"); down.type = "button"; down.className = "mini-button role-order-button"; down.textContent = "↓"; down.title = "Descer na hierarquia"; down.addEventListener("click", () => requestAdminAction("role-move", { roleId: role.id, direction: -1 })); order.append(up, down); }
    row.append(dot, name, color, admin, order, save);
    if (role.id !== "membro" && role.id !== "admin") { const remove = document.createElement("button"); remove.type = "button"; remove.className = "mini-button mini-button--danger"; remove.textContent = "Excluir"; remove.addEventListener("click", () => requestAdminAction("role-delete", { roleId: role.id })); row.append(remove); }
    elements.roleList.append(row);
  });
}

async function loadAppInfo() {
  try {
    state.appInfo = await window.resenhazinhaDesktop?.getAppInfo?.() || { version: "4.3.0", platform: navigator.platform, packaged: false };
  } catch (_error) {
    state.appInfo = { version: "4.3.0", platform: navigator.platform, packaged: false };
  }
  if (elements.appVersionLabel) elements.appVersionLabel.textContent = `v${state.appInfo.version || "4.3.0"}`;
  return state.appInfo;
}

async function checkForUpdatesFromSettings() {
  if (!window.resenhazinhaDesktop?.checkForUpdate) { toast("A verificação automática está disponível no aplicativo Windows."); return; }
  elements.checkUpdateButton.disabled = true;
  elements.checkUpdateButton.textContent = "Verificando…";
  elements.updateStatusLabel.textContent = "Consultando o GitHub Releases…";
  try {
    const result = await window.resenhazinhaDesktop.checkForUpdate();
    if (result?.updateAvailable && result?.deferred) elements.updateStatusLabel.textContent = `Versão ${result.latestVersion} disponível. Você escolheu atualizar depois.`;
    else if (result?.updateAvailable) elements.updateStatusLabel.textContent = `Preparando atualização ${result.latestVersion}…`;
    else if (result?.ok) elements.updateStatusLabel.textContent = `Você já está na versão mais recente (${result.latestVersion || state.appInfo?.version || "atual"}).`;
    else elements.updateStatusLabel.textContent = "Não consegui verificar agora. Tente novamente daqui a pouco.";
  } catch (_error) {
    elements.updateStatusLabel.textContent = "Não consegui verificar agora. Tente novamente daqui a pouco.";
  } finally {
    elements.checkUpdateButton.disabled = false;
    elements.checkUpdateButton.textContent = "Verificar atualização";
  }
}

async function openDiagnostics() {
  await loadAppInfo();
  await refreshDiagnostics();
  elements.diagnosticsDialog.showModal();
}

function closeDiagnostics() {
  if (elements.diagnosticsDialog.open) elements.diagnosticsDialog.close();
}

function diagnosticsStatusLabel() {
  if (!state.peer?.open) return "Mídia desconectada";
  if (state.hostConnection?.open) return "Cloudflare conectado";
  return "Reconectando ao Cloudflare";
}

async function refreshDiagnostics() {
  const jobs = [...state.voiceCalls.entries()].map(([peerId, call]) => collectVoiceStats(peerId, call));
  await Promise.allSettled(jobs);
  const summary = [
    ["Versão", `v${state.appInfo?.version || "4.4.0"}`],
    ["Servidor", diagnosticsStatusLabel()],
    ["Call", state.inVoice ? "Conectado" : "Fora da call"],
    ["Microfone", state.serverMuted ? "Mutado pelo servidor" : state.muted || state.deafened ? "Mutado" : state.inVoice ? "Ligado" : "Inativo"],
    ["Peers de voz", String(state.voiceCalls.size)],
    ["Transmissões", String(state.screenStreams.size)],
  ];
  elements.diagnosticsSummary.replaceChildren();
  summary.forEach(([label, value]) => { const card = document.createElement("div"); card.className = "diagnostic-card"; const small = document.createElement("small"); small.textContent = label; const strong = document.createElement("strong"); strong.textContent = value; card.append(small, strong); elements.diagnosticsSummary.append(card); });
  elements.diagnosticsPeers.replaceChildren();
  const stats = [...state.voiceStats.values()].sort((a, b) => (a.rttMs ?? 9999) - (b.rttMs ?? 9999));
  if (!stats.length) { const empty = document.createElement("div"); empty.className = "diagnostics-empty"; empty.textContent = state.inVoice ? "Ainda coletando dados da call…" : "Entre na call para medir ping, perda e jitter."; elements.diagnosticsPeers.append(empty); return; }
  stats.forEach((stat) => {
    const row = document.createElement("div"); row.className = "diagnostic-peer-row"; row.dataset.quality = stat.quality;
    const member = state.members.find((item) => item.peerId === stat.peerId);
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = member?.name || "Amigo"; const quality = document.createElement("small"); quality.textContent = `Conexão ${stat.quality}`; copy.append(name, quality);
    const metrics = document.createElement("div"); metrics.className = "diagnostic-peer-metrics";
    [["Ping", stat.rttMs == null ? "—" : `${stat.rttMs} ms`], ["Perda", `${stat.lossPercent}%`], ["Jitter", stat.jitterMs == null ? "—" : `${stat.jitterMs} ms`], ["Voz", `${stat.targetBitrateKbps} kb/s`]].forEach(([label, value]) => { const item = document.createElement("span"); item.innerHTML = `<small>${label}</small><strong>${value}</strong>`; metrics.append(item); });
    row.append(copy, metrics); elements.diagnosticsPeers.append(row);
  });
}

function diagnosticsText() {
  const lines = [
    `Resenhazinha v${state.appInfo?.version || "4.4.0"}`,
    `Servidor: ${diagnosticsStatusLabel()}`,
    `Call: ${state.inVoice ? "sim" : "não"} | voz peers: ${state.voiceCalls.size} | streams: ${state.screenStreams.size}`,
  ];
  [...state.voiceStats.values()].forEach((stat) => { const member = state.members.find((item) => item.peerId === stat.peerId); lines.push(`${member?.name || stat.peerId}: ping ${stat.rttMs ?? "—"}ms, perda ${stat.lossPercent}%, jitter ${stat.jitterMs ?? "—"}ms, voz ${stat.targetBitrateKbps}kb/s (${stat.quality})`); });
  return lines.join("\n");
}

async function copyDiagnostics() {
  const text = diagnosticsText();
  try { if (window.resenhazinhaDesktop?.copyText) await window.resenhazinhaDesktop.copyText(text); else await navigator.clipboard.writeText(text); toast("Diagnóstico copiado."); }
  catch (_error) { toast("Não consegui copiar o diagnóstico.", "error"); }
}

function openUserSettings() {
  renderUserSettings();
  setUserSettingsTab(state.userSettingsTab || "profile");
  elements.userDialog.showModal();
  refreshMicrophoneDevices(false);
}

function setUserSettingsTab(tab = "profile") {
  const allowed = ["profile", "audio", "background"];
  const next = allowed.includes(String(tab)) ? String(tab) : "profile";
  state.userSettingsTab = next;
  document.querySelectorAll("[data-user-settings-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.userSettingsTab === next));
  document.querySelectorAll("[data-user-settings-page]").forEach((page) => {
    const active = page.dataset.userSettingsPage === next;
    page.hidden = !active;
    page.classList.toggle("is-active", active);
  });
  const title = document.getElementById("user-settings-page-title");
  if (title) title.textContent = next === "audio" ? "Áudio" : next === "background" ? "Fundo" : "Perfil";
}

function renderUserSettings() {
  if (state.appInfo?.version) elements.appVersionLabel.textContent = `v${state.appInfo.version}`;
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
  elements.microphoneInputVolumeRange.value = String(Math.round(state.microphoneInputVolume * 100));
  elements.outputVolumeRange.value = String(Math.round(state.outputVolume * 100));
  elements.speakerDeviceSelect.value = [...elements.speakerDeviceSelect.options].some((option) => option.value === state.speakerDeviceId) ? state.speakerDeviceId : "";
  renderVoiceVolumeValues();
  renderNoiseSuppressionNote();
}

function renderNoiseSuppressionNote() {
  const level = normalizeNoiseSuppressionLevel(elements.noiseSuppressionSelect.value);
  const notes = {
    off: "Desligada: sem supressão de ruído e sem ganho automático. O cancelamento de eco continua ativo.",
    light: "Leve: usa apenas a supressão nativa do Chromium/Windows para manter a voz mais natural.",
    medium: "Média: supressão nativa + corte de graves + gate adaptativo suave para ventilador, teclado distante e ruído constante.",
    high: "Alta: processamento mais agressivo, gate mais fechado e isolamento de voz quando o sistema oferece suporte. Pode cortar fala muito baixa.",
  };
  elements.noiseLevelNote.textContent = notes[level];
}

function normalizeMicInputVolume(value) {
  const number = Number(value);
  return Math.min(1, Math.max(0, Number.isFinite(number) ? number : 1));
}

function normalizeOutputVolume(value) {
  const number = Number(value);
  return Math.min(2, Math.max(0, Number.isFinite(number) ? number : 1));
}

function clampIndividualVolume(value) {
  const number = Number(value);
  return Math.min(2, Math.max(0, Number.isFinite(number) ? number : 1));
}

function renderVoiceVolumeValues() {
  if (elements.microphoneInputVolumeValue) elements.microphoneInputVolumeValue.textContent = `${Math.round(state.microphoneInputVolume * 100)}%`;
  if (elements.outputVolumeValue) elements.outputVolumeValue.textContent = `${Math.round(state.outputVolume * 100)}%`;
  if (state.microphoneTest?.monitorGain) state.microphoneTest.monitorGain.gain.value = normalizeOutputVolume(state.outputVolume);
}

function renderMicrophoneTestMeter(level = 0) {
  if (!elements.microphoneTestMeter) return;
  const bars = [...elements.microphoneTestMeter.children];
  if (!bars.length) {
    for (let index = 0; index < 30; index += 1) {
      const bar = document.createElement("span");
      elements.microphoneTestMeter.append(bar);
    }
    return renderMicrophoneTestMeter(level);
  }
  const active = Math.round(Math.min(1, Math.max(0, Number(level) || 0)) * bars.length);
  bars.forEach((bar, index) => bar.classList.toggle("is-active", index < active));
}

async function toggleMicrophoneTest() {
  if (state.microphoneTest) { stopMicrophoneTest(); return; }

  const test = {
    silencingPlayback: true,
    previousMuted: state.muted,
    previousDeafened: state.deafened,
    previousMutedBeforeDeafen: state.mutedBeforeDeafen,
    frame: 0,
    capture: null,
    monitorContext: null,
    monitorAudio: null,
    monitorGain: null,
    analyser: null,
  };
  state.microphoneTest = test;

  try {
    state.muted = true;
    state.deafened = true;
    applyLocalAudioState();
    publishLocalStatus();
    updateControlState();
    renderMembers();
    renderVoiceGrid();
    silencePlaybackForMicrophoneTest();

    const selectedDevice = String(elements.microphoneDeviceSelect.value || "");
    const selectedLevel = normalizeNoiseSuppressionLevel(elements.noiseSuppressionSelect.value);
    const selectedInputVolume = normalizeMicInputVolume(Number(elements.microphoneInputVolumeRange.value) / 100);
    const capture = await createMicrophoneCapture(selectedDevice, selectedLevel, selectedInputVolume);
    if (state.microphoneTest !== test) { stopMicrophoneCapture(capture); return; }
    test.capture = capture;

    const monitorContext = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    await monitorContext.resume();
    const source = monitorContext.createMediaStreamSource(capture.stream);
    const analyser = monitorContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.68;
    const monitorGain = monitorContext.createGain();
    monitorGain.gain.value = normalizeOutputVolume(state.outputVolume);
    const monitorDestination = monitorContext.createMediaStreamDestination();
    source.connect(analyser);
    source.connect(monitorGain).connect(monitorDestination);

    const monitorAudio = new Audio();
    monitorAudio.autoplay = true;
    monitorAudio.srcObject = monitorDestination.stream;
    await applyOutputDevice(monitorAudio, String(elements.speakerDeviceSelect.value || ""));
    await monitorAudio.play();

    test.monitorContext = monitorContext;
    test.monitorAudio = monitorAudio;
    test.monitorGain = monitorGain;
    test.analyser = analyser;

    elements.microphoneTestButton.textContent = "Parar teste";
    elements.microphoneTestButton.classList.add("is-testing");
    const status = document.getElementById("microphone-test-status");
    if (status) status.textContent = `Ouvindo seu microfone · Supressão ${selectedLevel === "off" ? "desligada" : selectedLevel === "light" ? "leve" : selectedLevel === "high" ? "alta" : "média"}`;

    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (state.microphoneTest !== test) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) { const centered = (sample - 128) / 128; sum += centered * centered; }
      const rms = Math.sqrt(sum / samples.length);
      renderMicrophoneTestMeter(Math.min(1, rms * 5.8));
      test.frame = requestAnimationFrame(tick);
    };
    tick();
  } catch (error) {
    console.warn("[Resenhazinha] Falha no teste de microfone.", error);
    stopMicrophoneTest();
    toast("Não consegui iniciar o teste do microfone. Verifique o microfone e o dispositivo de saída.", "error");
  }
}

async function restartMicrophoneTestFromSettings() {
  if (!state.microphoneTest) return;
  stopMicrophoneTest();
  await new Promise((resolve) => setTimeout(resolve, 80));
  await toggleMicrophoneTest();
}

function silencePlaybackForMicrophoneTest() {
  state.memberAudioNodes.forEach((node) => { if (node?.gain) node.gain.gain.value = 0; if (node?.audio) node.audio.muted = true; });
  state.screenAudioNodes.forEach((node) => { if (node?.gain) node.gain.gain.value = 0; if (node?.audio) node.audio.muted = true; });
  elements.audioContainer?.querySelectorAll?.("audio")?.forEach?.((audio) => { audio.muted = true; });
  document.querySelectorAll("[data-screen-video]").forEach((video) => { video.muted = true; });
}

function stopMicrophoneTest() {
  const test = state.microphoneTest;
  if (!test) {
    if (elements.microphoneTestButton) { elements.microphoneTestButton.textContent = "Testar microfone"; elements.microphoneTestButton.classList.remove("is-testing"); }
    renderMicrophoneTestMeter(0);
    return;
  }
  state.microphoneTest = null;
  if (test.frame) cancelAnimationFrame(test.frame);
  if (test.monitorAudio) { try { test.monitorAudio.pause(); test.monitorAudio.srcObject = null; } catch (_error) {} }
  test.monitorContext?.close?.().catch?.(() => undefined);
  if (test.capture) stopMicrophoneCapture(test.capture);

  state.muted = Boolean(test.previousMuted);
  state.deafened = Boolean(test.previousDeafened);
  state.mutedBeforeDeafen = Boolean(test.previousMutedBeforeDeafen);
  applyLocalAudioState();
  publishLocalStatus();
  updateControlState();
  renderMembers();
  renderVoiceGrid();
  applyAllPlaybackAudioSettings();
  elements.audioContainer?.querySelectorAll?.("audio")?.forEach?.((audio) => { audio.muted = state.deafened; });
  state.screenStreams.forEach((_entry, peerId) => { void applyScreenAudioState(peerId); });

  if (elements.microphoneTestButton) { elements.microphoneTestButton.textContent = "Testar microfone"; elements.microphoneTestButton.classList.remove("is-testing"); }
  const status = document.getElementById("microphone-test-status");
  if (status) status.textContent = "Ao testar, a call fica muda para você e sua voz volta pelo alto-falante escolhido.";
  renderMicrophoneTestMeter(0);
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
    const outputs = devices.filter((device) => device.kind === "audiooutput");
    const selected = state.microphoneDeviceId;
    const selectedOutput = state.speakerDeviceId;
    elements.microphoneDeviceSelect.replaceChildren();
    const automatic = document.createElement("option"); automatic.value = ""; automatic.textContent = "Padrão do sistema"; elements.microphoneDeviceSelect.append(automatic);
    inputs.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Microfone ${index + 1}`;
      elements.microphoneDeviceSelect.append(option);
    });
    elements.microphoneDeviceSelect.value = [...elements.microphoneDeviceSelect.options].some((option) => option.value === selected) ? selected : "";
    elements.speakerDeviceSelect.replaceChildren();
    const automaticOutput = document.createElement("option"); automaticOutput.value = ""; automaticOutput.textContent = "Padrão do sistema"; elements.speakerDeviceSelect.append(automaticOutput);
    outputs.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Alto-falante ${index + 1}`;
      elements.speakerDeviceSelect.append(option);
    });
    elements.speakerDeviceSelect.value = [...elements.speakerDeviceSelect.options].some((option) => option.value === selectedOutput) ? selectedOutput : "";
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
  const previousSpeaker = state.speakerDeviceId;
  state.nickname = nextName;
  elements.nicknameInput.value = nextName;
  localStorage.setItem("resenhazinha:nickname", nextName);
  elements.selfName.textContent = nextName;
  state.microphoneDeviceId = String(elements.microphoneDeviceSelect.value || "");
  state.speakerDeviceId = String(elements.speakerDeviceSelect.value || "");
  state.microphoneInputVolume = normalizeMicInputVolume(Number(elements.microphoneInputVolumeRange.value) / 100);
  state.outputVolume = normalizeOutputVolume(Number(elements.outputVolumeRange.value) / 100);
  state.noiseSuppressionLevel = normalizeNoiseSuppressionLevel(elements.noiseSuppressionSelect.value);
  state.profileBio = cleanBio(elements.userBioSettings.value);
  state.appBackgroundBlur = normalizeBackgroundBlur(elements.appBackgroundBlurRange.value);
  state.appBackgroundZoom = normalizeBackgroundZoom(elements.appBackgroundZoomRange.value);
  state.appFontScale = normalizeFontScale(elements.appFontScaleRange.value);
  state.appTheme = normalizeTheme(state.appTheme);
  state.presenceStatus = normalizePresence(state.presenceStatus);
  localStorage.setItem(MIC_DEVICE_KEY, state.microphoneDeviceId);
  localStorage.setItem(SPEAKER_DEVICE_KEY, state.speakerDeviceId);
  localStorage.setItem(MIC_INPUT_VOLUME_KEY, String(state.microphoneInputVolume));
  localStorage.setItem(OUTPUT_VOLUME_KEY, String(state.outputVolume));
  localStorage.setItem(NOISE_SUPPRESSION_KEY, state.noiseSuppressionLevel);
  if (state.micGainNode) state.micGainNode.gain.value = state.microphoneInputVolume;
  await applyOutputDeviceToAll();
  applyAllPlaybackAudioSettings();
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
  state.contextMessageId = null;
  if (elements.voiceContextMenu) elements.voiceContextMenu.hidden = true;
}

function voiceContextMember() {
  return state.members.find((member) => member.peerId === state.voiceContextPeerId) || null;
}

function openVoiceContextMenu(event, peerId, messageId = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const member = state.members.find((item) => item.peerId === peerId);
  if (!member) return;
  closeMemberProfile();
  closePresencePopover();
  state.voiceContextPeerId = member.peerId;
  state.contextMessageId = sanitizeTransferId(messageId);
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
  const contextMessage = state.chatMessages.find((item) => item.id === state.contextMessageId) || null;
  elements.voiceContextMessageSection.hidden = !contextMessage;
  if (contextMessage) {
    elements.voiceContextPinButton.hidden = !canCurrentUserAdmin();
    elements.voiceContextPinButton.textContent = isMessagePinned(contextMessage.id) ? "Desafixar mensagem" : "Fixar mensagem";
    elements.voiceContextDeleteButton.hidden = !canCurrentUserDeleteMessage(contextMessage);
    elements.voiceContextReactions.replaceChildren();
    REACTION_EMOJIS.forEach((emoji) => { const button = document.createElement("button"); button.type = "button"; button.textContent = emoji; button.title = `Reagir com ${emoji}`; button.className = "voice-context-reaction"; button.classList.toggle("is-own", currentUserReacted(contextMessage, emoji)); button.addEventListener("click", () => { requestChatReaction(contextMessage.id, emoji); closeVoiceContextMenu(); }); elements.voiceContextReactions.append(button); });
  }
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
    const canModerate = canModerateTarget(state.peer?.id, member);
    elements.voiceContextRolesButton.disabled = protectedOwner || !canModerate;
    elements.voiceContextServerMuteButton.textContent = member.serverMuted ? "Desmutar voz no servidor" : "Silenciar voz no servidor";
    elements.voiceContextServerMuteButton.disabled = protectedOwner || !canModerate || !inVoice;
    elements.voiceContextDisconnectButton.disabled = protectedOwner || !canModerate || !inVoice;
    elements.voiceContextKickButton.disabled = protectedOwner || !canModerate;
    elements.voiceContextKickButton.title = protectedOwner ? "O Owner é protegido." : !canModerate ? "Você não pode moderar alguém com hierarquia igual ou superior." : member.offlineSnapshot ? "Expulsar este membro offline do servidor" : "Expulsar do servidor";
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


function replyToContextMessage() {
  const id = state.contextMessageId;
  closeVoiceContextMenu();
  if (id) setPendingReply(id);
}

function togglePinContextMessage() {
  const id = state.contextMessageId;
  const message = state.chatMessages.find((item) => item.id === id);
  if (!message || !canCurrentUserAdmin()) return;
  const pinned = !isMessagePinned(id);
  closeVoiceContextMenu();
  requestAdminAction("chat-pin", { messageId: id, pinned });
}

function deleteContextMessage() {
  const id = sanitizeTransferId(state.contextMessageId);
  const message = state.chatMessages.find((item) => item.id === id);
  if (!message || !canCurrentUserDeleteMessage(message)) return;
  closeVoiceContextMenu();
  openDeleteMessageDialog(message);
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
  const canModerate = admin && canModerateTarget(state.peer?.id, member);
  elements.serverMuteMemberButton.disabled = protectedOwner || !canModerate; elements.disconnectMemberButton.disabled = protectedOwner || !canModerate || !member.inVoice; elements.disconnectMemberButton.textContent = member.inVoice ? "Tirar da call" : "Fora da call";
  elements.kickMemberButton.disabled = protectedOwner || !canModerate;
  elements.kickMemberButton.textContent = protectedOwner ? "Owner protegido" : !canModerate ? "Hierarquia protegida" : "Expulsar do servidor";
  elements.memberRoleOptions.replaceChildren();
  if (!admin) return;
  const assigned = new Set(member.roleIds || []);
  state.server.roles.forEach((role) => {
    const option = document.createElement("label"); option.className = "member-role-option"; const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = assigned.has(role.id); checkbox.disabled = role.id === "membro" || protectedOwner || !canModerate || (!isServerOwner(state.peer?.id) && role.admin);
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
  const replyToMessageId = sanitizeTransferId(state.pendingReplyMessageId);
  if (!state.server.textChannel.exists) { toast("Esse servidor não tem um canal de texto agora.", "error"); return; }
  if ((!text && files.length === 0) || !state.peer?.open || state.chatSending) return;
  if (!state.hostConnection?.open) { toast("O chat está reconectando ao Cloudflare. Tente de novo em um instante."); return; }

  closeMentionMenu();
  state.chatSending = true; updateChatComposerState();
  try {
    if (files.length === 0) {
      state.hostConnection.send({ type: "chat-send", text, replyToMessageId });
    } else {
      const outgoing = await prepareOutgoingChatAttachments(files);
      await uploadChatMessageToHost(text, outgoing, replyToMessageId);
    }
    elements.chatInput.value = "";
    state.pendingChatFiles = [];
    clearPendingReply();
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

async function uploadChatMessageToHost(text, outgoing, replyToMessageId = null) {
  const connection = state.hostConnection;
  if (!connection?.open) throw new Error("offline");
  const uploadId = crypto.randomUUID();
  connection.send({ type: "chat-upload-start", uploadId, text, replyToMessageId: sanitizeTransferId(replyToMessageId), attachments: outgoing.map((entry) => entry.meta) });
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
  state.incomingChatUploads.set(key, { peerId, uploadId, text, replyToMessageId: sanitizeTransferId(message.replyToMessageId), attachments, files, startedAt: Date.now() });
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
    acceptChatMessage(peerId, upload.text, upload.attachments, upload.replyToMessageId);
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


function sanitizeMessageReactions(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  REACTION_EMOJIS.forEach((emoji) => {
    const ids = Array.isArray(source[emoji]) ? source[emoji].map(sanitizeClientId).filter(Boolean) : [];
    if (ids.length) result[emoji] = [...new Set(ids)].slice(0, MAX_MEMBERS);
  });
  return result;
}

function reactionCount(message, emoji) {
  return sanitizeMessageReactions(message?.reactions)[emoji]?.length || 0;
}

function currentUserReacted(message, emoji) {
  return Boolean(sanitizeMessageReactions(message?.reactions)[emoji]?.includes(state.clientId));
}

function requestChatReaction(messageId, emoji) {
  const id = sanitizeTransferId(messageId);
  if (!id || !REACTION_EMOJIS.includes(emoji)) return;
  if (state.hostConnection?.open) state.hostConnection.send({ type: "chat-reaction", messageId: id, emoji });
}

function acceptChatReaction(peerId, messageId, emoji) {
  if (!state.isHost || !REACTION_EMOJIS.includes(emoji)) return;
  const message = state.chatMessages.find((item) => item.id === sanitizeTransferId(messageId));
  const clientId = clientIdForPeer(peerId);
  if (!message || !clientId) return;
  const reactions = sanitizeMessageReactions(message.reactions);
  const users = new Set(reactions[emoji] || []);
  if (users.has(clientId)) users.delete(clientId); else users.add(clientId);
  if (users.size) reactions[emoji] = [...users].slice(0, MAX_MEMBERS); else delete reactions[emoji];
  message.reactions = reactions;
  broadcastRoomData({ type: "chat-message-reaction", messageId: message.id, reactions });
  renderChatHistory();
  if (elements.pinnedDialog?.open) renderPinnedMessages();
  scheduleServerPersistence();
}

function applyIncomingChatReaction(payload) {
  const message = state.chatMessages.find((item) => item.id === sanitizeTransferId(payload?.messageId));
  if (!message) return;
  message.reactions = sanitizeMessageReactions(payload?.reactions);
  renderChatHistory();
  if (elements.pinnedDialog?.open) renderPinnedMessages();
}

function replySnapshotText(message) {
  if (!message) return "Mensagem";
  const text = normalizeChatText(message.text);
  if (text) return text.slice(0, 150);
  const attachments = sanitizeChatAttachments(message.attachments);
  if (attachments.length) return `${attachments.length} anexo${attachments.length === 1 ? "" : "s"}`;
  return "Mensagem";
}

function setPendingReply(messageId) {
  const message = state.chatMessages.find((item) => item.id === sanitizeTransferId(messageId));
  if (!message) return;
  state.pendingReplyMessageId = message.id;
  elements.chatReplyName.textContent = message.name;
  elements.chatReplyText.textContent = replySnapshotText(message);
  elements.chatReplyPreview.hidden = false;
  switchView("text");
  focusChatComposer();
}

function clearPendingReply() {
  state.pendingReplyMessageId = null;
  if (elements.chatReplyPreview) elements.chatReplyPreview.hidden = true;
}

function scrollToMessage(messageId) {
  const id = sanitizeTransferId(messageId);
  if (!id) return;
  const node = elements.chatMessages.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  if (!node) return;
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.classList.add("chat-message--flash");
  window.setTimeout(() => node.classList.remove("chat-message--flash"), 1400);
}

function renderMessageReplyReference(container, message) {
  if (!message?.replyTo) return;
  const reply = document.createElement("button");
  reply.type = "button";
  reply.className = "chat-reply-reference";
  const name = document.createElement("strong"); name.textContent = message.replyTo.name;
  const text = document.createElement("span"); text.textContent = message.replyTo.text || "Mensagem";
  reply.append(name, text);
  reply.addEventListener("click", () => scrollToMessage(message.replyTo.id));
  container.append(reply);
}

function renderMessageReactions(container, message) {
  const reactions = sanitizeMessageReactions(message.reactions);
  const entries = REACTION_EMOJIS.filter((emoji) => (reactions[emoji] || []).length);
  if (!entries.length) return;
  const row = document.createElement("div"); row.className = "chat-reaction-row";
  entries.forEach((emoji) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "chat-reaction-pill";
    button.classList.toggle("is-own", currentUserReacted(message, emoji));
    button.innerHTML = `<span>${emoji}</span><strong>${reactionCount(message, emoji)}</strong>`;
    button.title = currentUserReacted(message, emoji) ? "Remover sua reação" : "Adicionar reação";
    button.addEventListener("click", () => requestChatReaction(message.id, emoji));
    row.append(button);
  });
  container.append(row);
}

function pinnedMessageIds() {
  return Array.isArray(state.server?.pinnedMessageIds) ? state.server.pinnedMessageIds.map(sanitizeTransferId).filter(Boolean) : [];
}

function isMessagePinned(messageId) { return pinnedMessageIds().includes(sanitizeTransferId(messageId)); }

function renderPinnedIndicator() {
  const count = pinnedMessageIds().filter((id) => state.chatMessages.some((message) => message.id === id)).length;
  elements.pinnedCountBadge.textContent = String(count);
  elements.pinnedCountBadge.hidden = count === 0;
  elements.pinnedMessagesButton.classList.toggle("has-items", count > 0);
}

function openPinnedMessages() {
  renderPinnedMessages();
  elements.pinnedDialog.showModal();
}

function renderPinnedMessages() {
  elements.pinnedMessageList.replaceChildren();
  const messages = pinnedMessageIds().map((id) => state.chatMessages.find((item) => item.id === id)).filter(Boolean).reverse();
  if (!messages.length) {
    const empty = document.createElement("div"); empty.className = "pinned-empty"; empty.textContent = "Nenhuma mensagem fixada ainda."; elements.pinnedMessageList.append(empty); return;
  }
  messages.forEach((message) => {
    const card = document.createElement("article"); card.className = "pinned-message-card";
    const head = document.createElement("div"); head.className = "pinned-message-head";
    const name = document.createElement("strong"); name.textContent = message.name;
    const time = document.createElement("time"); time.textContent = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(message.sentAt);
    head.append(name, time);
    const text = document.createElement("p"); text.textContent = replySnapshotText(message);
    const actions = document.createElement("div"); actions.className = "pinned-message-actions";
    const jump = document.createElement("button"); jump.type = "button"; jump.className = "mini-button"; jump.textContent = "Ir para mensagem"; jump.addEventListener("click", () => { elements.pinnedDialog.close(); switchView("text"); window.setTimeout(() => scrollToMessage(message.id), 80); });
    actions.append(jump);
    if (canCurrentUserAdmin()) { const unpin = document.createElement("button"); unpin.type = "button"; unpin.className = "mini-button mini-button--danger"; unpin.textContent = "Desafixar"; unpin.addEventListener("click", () => requestAdminAction("chat-pin", { messageId: message.id, pinned: false })); actions.append(unpin); }
    card.append(head, text, actions); elements.pinnedMessageList.append(card);
  });
}

function acceptChatMessage(peerId, rawText, rawAttachments = [], replyToMessageId = null) {
  if (!state.isHost || !state.server.textChannel.exists) return;
  const member = state.hostMembers.get(peerId); const text = normalizeChatText(rawText); const attachments = sanitizeChatAttachments(rawAttachments);
  if (!member || (!text && attachments.length === 0)) return;
  const replyTarget = state.chatMessages.find((item) => item.id === sanitizeTransferId(replyToMessageId));
  const replyTo = replyTarget ? { id: replyTarget.id, name: replyTarget.name, text: replySnapshotText(replyTarget).slice(0, 180), clientId: sanitizeClientId(replyTarget.clientId) } : null;
  const message = { id: crypto.randomUUID(), peerId, clientId: member.clientId || null, name: member.name, roleIds: normalizeRoleIds(member.roleIds), text, attachments, replyTo, reactions: {}, sentAt: Date.now(), editedAt: null };
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

function chatMessageAuthorSnapshot(message) {
  if (!message) return null;
  const live = memberForChatMessage(message);
  if (live) return live;
  const clientId = sanitizeClientId(message.clientId);
  const record = clientId ? state.memberRegistry.get(clientId) : null;
  if (record) return registryOfflineMember(record);
  return {
    peerId: String(message.peerId || ""),
    clientId,
    name: cleanNickname(message.name || "Membro") || "Membro",
    roleIds: normalizeRoleIds(message.roleIds || ["membro"]),
    offlineSnapshot: true,
  };
}

function peerCanDeleteChatMessage(peerId, message) {
  if (!message || !peerId) return false;
  if (peerOwnsChatMessage(peerId, message)) return true;
  if (!memberHasAdmin(peerId)) return false;
  if (isServerOwner(peerId)) return true;
  const author = chatMessageAuthorSnapshot(message);
  if (!author || isServerOwner(author.peerId) || (author.clientId && author.clientId === state.server.ownerClientId)) return false;
  return canModerateTarget(peerId, author);
}

function canCurrentUserDeleteMessage(message) {
  return Boolean(state.peer?.id && peerCanDeleteChatMessage(state.peer.id, message));
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
  if (index < 0 || !peerCanDeleteChatMessage(peerId, state.chatMessages[index])) return;
  const [removed] = state.chatMessages.splice(index, 1);
  const moderatorDelete = !peerOwnsChatMessage(peerId, removed);
  state.server.pinnedMessageIds = (state.server.pinnedMessageIds || []).filter((item) => item !== id);
  await deleteMessageAttachments(removed);
  if (moderatorDelete) recordModeration(peerId, `apagou uma mensagem de ${removed.name || "um membro"}`);
  broadcastRoomData({ type: "chat-message-delete", messageId: id });
  if (state.editingMessageId === id) state.editingMessageId = null;
  if (state.pendingDeleteMessageId === id) closeDeleteMessageDialog();
  renderChatHistory(); scheduleServerPersistence();
}

function requestChatEdit(messageId, text) {
  if (state.hostConnection?.open) state.hostConnection.send({ type: "chat-edit", messageId, text });
}

function requestChatDelete(messageId) {
  if (state.hostConnection?.open) state.hostConnection.send({ type: "chat-delete", messageId });
}

function applyIncomingChatEdit(message) {
  const id = sanitizeTransferId(message.messageId); const item = state.chatMessages.find((entry) => entry.id === id); if (!item) return;
  const text = normalizeChatText(message.text); if (!text && !(item.attachments || []).length) return;
  item.text = text; item.editedAt = Number(message.editedAt) || Date.now(); if (state.editingMessageId === id) state.editingMessageId = null; renderChatHistory();
}

function applyIncomingChatDelete(messageId) {
  const id = sanitizeTransferId(messageId); const index = state.chatMessages.findIndex((entry) => entry.id === id); if (index < 0) return;
  const [removed] = state.chatMessages.splice(index, 1); state.server.pinnedMessageIds = (state.server.pinnedMessageIds || []).filter((item) => item !== id); releaseMessageAttachmentCache(removed); if (state.editingMessageId === id) state.editingMessageId = null; if (state.pendingDeleteMessageId === id) closeDeleteMessageDialog(); renderChatHistory();
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
    if (state.isHost && !state.cloudMode) void deleteMessageAttachments(removed); else releaseMessageAttachmentCache(removed);
  }
  const incoming = message.clientId ? message.clientId !== state.clientId : message.peerId !== state.peer?.id;
  const mentioned = incoming && messageMentionsCurrentUser(message);
  const doNotDisturb = normalizePresence(state.presenceStatus) === "dnd";
  const notActivelyReading = state.currentView !== "text" || document.hidden || !document.hasFocus();
  if (incoming && !doNotDisturb) playUiSound("message", mentioned ? 0.58 : 0.42);
  renderChatMessage(message, previousMessage);
  if (mentioned && !doNotDisturb) toast(`${message.name} mencionou você.`);
  if (incoming && notActivelyReading) {
    state.unreadMessages = Math.min(99, state.unreadMessages + 1);
    if (mentioned) state.unreadMentions = Math.min(99, state.unreadMentions + 1);
    updateChatVisibility();
    if (!doNotDisturb) void showDesktopMessageNotification(message, mentioned);
  }
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
  const isSelfMessage = isSelfChatMessage(message); if (isSelfMessage) item.classList.add("chat-message--self"); if (messageMentionsCurrentUser(message)) item.classList.add("chat-message--mentioned"); if (grouped) item.classList.add("chat-message--grouped"); if (isMessagePinned(message.id)) item.classList.add("chat-message--pinned");
  if (member) item.addEventListener("contextmenu", (event) => openVoiceContextMenu(event, member.peerId, message.id));

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
    heading.append(createChatMessageActions(message, isSelfMessage));
    content.append(heading);
  } else {
    content.append(createChatMessageActions(message, isSelfMessage));
  }

  renderMessageReplyReference(content, message);
  if (state.editingMessageId === message.id) content.append(createChatEditBox(message));
  else {
    const body = document.createElement("p"); body.className = "chat-message-text"; appendMessageTextWithMentions(body, message.text); if (!message.text) body.hidden = true;
    if (grouped && message.editedAt && message.text) { const edited = document.createElement("span"); edited.className = "chat-edited-label chat-edited-label--inline"; edited.textContent = " (editado)"; body.append(edited); }
    content.append(body);
  }
  renderChatAttachments(content, message);
  renderMessageReactions(content, message);
  item.append(avatar, content); elements.chatMessages.append(item);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function createChatMessageActions(message, isSelfMessage = false) {
  const actions = document.createElement("div"); actions.className = "chat-message-actions";
  const reply = document.createElement("button"); reply.type = "button"; reply.title = "Responder"; reply.setAttribute("aria-label", "Responder mensagem"); reply.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6v1"/></svg>'; reply.addEventListener("click", () => setPendingReply(message.id)); actions.append(reply);
  const react = document.createElement("button"); react.type = "button"; react.title = "Reagir"; react.setAttribute("aria-label", "Reagir à mensagem"); react.textContent = "☺"; react.addEventListener("click", () => requestChatReaction(message.id, "😂")); actions.append(react);
  if (isSelfMessage) {
    const edit = document.createElement("button"); edit.type = "button"; edit.title = "Editar mensagem"; edit.setAttribute("aria-label", "Editar mensagem"); edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"/></svg>'; edit.addEventListener("click", () => { state.editingMessageId = message.id; renderChatHistory(); window.setTimeout(() => document.querySelector(`[data-edit-message="${CSS.escape(message.id)}"]`)?.focus(), 0); });
    actions.append(edit);
  }
  if (canCurrentUserDeleteMessage(message)) {
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "is-danger"; remove.title = isSelfMessage ? "Apagar mensagem" : "Apagar mensagem como moderador"; remove.setAttribute("aria-label", "Apagar mensagem"); remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>'; remove.addEventListener("click", (event) => { if (event.shiftKey) { requestChatDelete(message.id); return; } openDeleteMessageDialog(message); });
    actions.append(remove);
  }
  return actions;
}

function createChatEditBox(message) {
  const wrap = document.createElement("div"); wrap.className = "chat-edit-wrap";
  const input = document.createElement("textarea"); input.rows = 2; input.maxLength = 500; input.value = message.text; input.dataset.editMessage = message.id;
  const actions = document.createElement("div"); actions.className = "chat-edit-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancelar"; cancel.addEventListener("click", () => { state.editingMessageId = null; renderChatHistory(); });
  const save = document.createElement("button"); save.type = "button"; save.className = "chat-edit-save"; save.textContent = "Salvar"; const submit = () => { const text = normalizeChatText(input.value); if (!text && !(message.attachments || []).length) return; requestChatEdit(message.id, text); if (state.cloudMode || !state.isHost) { state.editingMessageId = null; renderChatHistory(); } }; save.addEventListener("click", submit); input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } if (event.key === "Escape") { state.editingMessageId = null; renderChatHistory(); } });
  actions.append(cancel, save); wrap.append(input, actions); return wrap;
}

function openDeleteMessageDialog(message) {
  const target = state.chatMessages.find((item) => item.id === message.id) || message;
  state.pendingDeleteMessageId = target.id;
  const member = memberForChatMessage(target);
  paintAvatar(elements.deleteMessagePreviewAvatar, target.name, member?.avatar || null);
  elements.deleteMessagePreviewName.textContent = isSelfChatMessage(target) ? `${target.name} (você)` : target.name;
  elements.confirmDeleteMessageButton.textContent = isSelfChatMessage(target) ? "Excluir" : "Excluir como moderador";
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
  elements.confirmDeleteMessageButton.textContent = "Excluir";
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
  elements.chatUnreadBadge.classList.toggle("has-mention", state.unreadMentions > 0);
  elements.chatUnreadBadge.textContent = state.unreadMentions > 0 ? `@${state.unreadMentions > 9 ? "9+" : state.unreadMentions}` : state.unreadMessages > 9 ? "9+" : String(state.unreadMessages);
  updateWindowTitle();
}

function updateWindowTitle() {
  const serverName = state.server?.name || "Resenhazinha";
  const prefix = state.unreadMessages > 0 ? `(${state.unreadMessages}) ` : "";
  document.title = `${prefix}${serverName} · Resenhazinha`;
}

async function showDesktopMessageNotification(message, mentioned = false) {
  if (!window.resenhazinhaDesktop?.showNotification) return;
  const body = normalizeChatText(message.text) || (sanitizeChatAttachments(message.attachments).length ? "Enviou um anexo" : "Nova mensagem");
  await window.resenhazinhaDesktop.showNotification({ title: mentioned ? `${message.name} mencionou você` : message.name, body, messageId: message.id, silent: true }).catch(() => undefined);
}


function ensureValidView() {
  if (state.currentView === "text" && state.server.textChannel.exists) return;
  if (state.currentView === "voice" && state.server.voiceChannel.exists) return;
  if (state.server.textChannel.exists) state.currentView = "text"; else if (state.server.voiceChannel.exists) state.currentView = "voice"; else state.currentView = "none";
}
function switchView(view) {
  if (view === "text" && !state.server.textChannel.exists) return; if (view === "voice" && !state.server.voiceChannel.exists) return;
  state.currentView = view; if (view === "text") { state.unreadMessages = 0; state.unreadMentions = 0; } renderServerUI(); updateChatVisibility(); if (view === "text") window.setTimeout(() => { elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight; elements.chatInput.focus(); }, 80);
}
function renderServerUI() {
  ensureValidView(); const admin = canCurrentUserAdmin(); elements.serverNameDisplay.textContent = state.server.name; elements.roomCodeDisplay.textContent = currentInviteCode(); paintAvatar(elements.serverIconDisplay, state.server.name, state.server.icon); updateWindowTitle();
  elements.textChannelButton.hidden = !state.server.textChannel.exists; elements.textChannelEmpty.hidden = state.server.textChannel.exists; elements.textChannelName.textContent = state.server.textChannel.name; elements.createTextChannelButton.hidden = !admin || state.server.textChannel.exists;
  elements.voiceChannelButton.hidden = !state.server.voiceChannel.exists; elements.voiceChannelEmpty.hidden = state.server.voiceChannel.exists; elements.voiceChannelName.textContent = state.server.voiceChannel.name; elements.createVoiceChannelButton.hidden = !admin || state.server.voiceChannel.exists;
  elements.textChannelButton.classList.toggle("is-active", state.currentView === "text"); elements.voiceChannelButton.classList.toggle("is-active", state.currentView === "voice");
  elements.textView.hidden = state.currentView !== "text"; elements.voiceView.hidden = state.currentView !== "voice"; elements.chatToggleButton.hidden = state.currentView !== "voice" || !state.server.textChannel.exists;
  if (state.currentView === "text") { elements.contentChannelIcon.textContent = "#"; elements.contentChannelKind.textContent = "CANAL DE TEXTO"; elements.contentChannelTitle.textContent = state.server.textChannel.name; elements.chatInput.placeholder = `Mensagem para #${state.server.textChannel.name}`; }
  else if (state.currentView === "voice") { elements.contentChannelIcon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/></svg>'; elements.contentChannelKind.textContent = "CANAL DE VOZ"; elements.contentChannelTitle.textContent = state.server.voiceChannel.name; }
  else { elements.contentChannelIcon.textContent = "·"; elements.contentChannelKind.textContent = "SERVIDOR"; elements.contentChannelTitle.textContent = "Nenhum canal criado"; }
  renderVoiceMiniList(); renderPinnedIndicator(); updateChatVisibility();
}
function normalizeVoiceJoinedAt(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const now = Date.now();
  if (timestamp > now + 60_000 || timestamp < now - (7 * 24 * 60 * 60 * 1000)) return null;
  return Math.round(timestamp);
}

function formatVoiceDuration(joinedAt) {
  const safe = normalizeVoiceJoinedAt(joinedAt);
  if (!safe) return "0:00";
  const total = Math.max(0, Math.floor((Date.now() - safe) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function refreshVoiceDurationLabels() {
  document.querySelectorAll("[data-voice-joined-at]").forEach((node) => {
    const joinedAt = normalizeVoiceJoinedAt(node.dataset.voiceJoinedAt);
    node.textContent = formatVoiceDuration(joinedAt);
  });
  if (elements.voiceChannelDuration) {
    elements.voiceChannelDuration.hidden = !state.inVoice;
    elements.voiceChannelDuration.dataset.voiceJoinedAt = String(normalizeVoiceJoinedAt(state.voiceJoinedAt) || "");
    if (state.inVoice) elements.voiceChannelDuration.textContent = formatVoiceDuration(state.voiceJoinedAt);
  }
}

function voiceConnectionSummary() {
  if (!state.inVoice) return { quality: "unknown", rttMs: null, title: "Fora da call" };
  const activePeerIds = new Set(state.members.filter((member) => member.inVoice && member.peerId !== state.peer?.id).map((member) => member.peerId));
  const stats = [...state.voiceStats.values()].filter((stat) => activePeerIds.has(stat.peerId) && Date.now() - Number(stat.updatedAt || 0) < 20_000);
  if (!activePeerIds.size) return { quality: "good", rttMs: null, title: "Conectado · entre outra pessoa para medir o ping P2P" };
  if (!stats.length) return { quality: "unknown", rttMs: null, title: "Medindo ping da call…" };
  const rank = { boa: 0, média: 1, ruim: 2 };
  stats.sort((a, b) => (rank[b.quality] ?? 0) - (rank[a.quality] ?? 0) || (b.rttMs ?? -1) - (a.rttMs ?? -1) || b.lossPercent - a.lossPercent);
  const worst = stats[0];
  const quality = worst.quality === "ruim" ? "bad" : worst.quality === "média" ? "medium" : "good";
  const member = state.members.find((item) => item.peerId === worst.peerId);
  const rtt = Number.isFinite(worst.rttMs) ? worst.rttMs : null;
  const title = rtt == null ? `Conexão ${worst.quality}` : `${rtt} ms · conexão ${worst.quality}${member?.name ? ` com ${member.name}` : ""}`;
  return { quality, rttMs: rtt, title };
}

function renderVoiceConnectionPanel() {
  if (!elements.voiceConnectionPanel || !elements.voicePingIndicator) return;
  elements.voiceConnectionPanel.hidden = !state.inVoice;
  if (!state.inVoice) return;
  if (elements.voiceConnectionDetail) elements.voiceConnectionDetail.textContent = `${state.server.voiceChannel.name} / ${state.server.name}`;
  const summary = voiceConnectionSummary();
  elements.voicePingIndicator.dataset.quality = summary.quality;
  elements.voicePingIndicator.title = summary.title;
  elements.voicePingIndicator.setAttribute("aria-label", summary.rttMs == null ? summary.title : `Ping ${summary.rttMs} milissegundos`);
  refreshVoiceDurationLabels();
}

function cameraStreamForPeer(peerId) {
  if (!peerId) return null;
  if (peerId === state.peer?.id) return state.cameraStream;
  return state.cameraStreams.get(peerId) || null;
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
    const right = document.createElement("span"); right.className = "voice-mini-right";
    const duration = document.createElement("time"); duration.className = "voice-call-duration voice-call-duration--mini"; duration.dataset.voiceJoinedAt = String(normalizeVoiceJoinedAt(member.voiceJoinedAt) || ""); duration.textContent = formatVoiceDuration(member.voiceJoinedAt); right.append(duration);
    if (cameraStreamForPeer(member.peerId)) {
      const camera = document.createElement("span"); camera.className = "voice-camera-indicator"; camera.title = "Câmera ligada"; camera.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3v-4Z"/></svg>'; right.append(camera);
    }
    if (state.activeScreens.has(member.peerId)) {
      const live = document.createElement("button"); live.type = "button"; live.className = "voice-live-badge"; live.textContent = "AO VIVO"; live.title = `Assistir à tela de ${member.name}`;
      live.addEventListener("click", (event) => { event.stopPropagation(); switchView("voice"); if (state.screenStreams.has(member.peerId)) setScreenLayout("focus", member.peerId); });
      right.append(live);
    }
    const states = voiceStateIcons(member); right.append(states);
    row.append(avatar, name, right); elements.voiceMiniList.append(row);
  });
  refreshVoiceDurationLabels();
  applySpeakingStateToDom();
}
function renderVoiceGrid() {
  elements.stageEmpty.replaceChildren();
  if (!state.server.voiceChannel.exists) {
    const empty = document.createElement("div"); empty.className = "voice-empty-card"; empty.innerHTML = "<strong>Não existe uma call ainda</strong><span>Um administrador pode criar o canal de voz.</span>"; elements.stageEmpty.append(empty); elements.stageEmpty.hidden = false; return;
  }
  if (!state.inVoice) {
    const empty = document.createElement("div"); empty.className = "voice-empty-card"; const title = document.createElement("strong"); title.textContent = "Você está fora da call"; const copy = document.createElement("span"); copy.textContent = `Entre em ${state.server.voiceChannel.name} para ouvir e falar com a galera.`; const join = document.createElement("button"); join.className = "button button--primary voice-empty-join"; join.type = "button"; join.textContent = "Entrar na call"; join.addEventListener("click", joinVoiceChannel); empty.append(title, copy, join); elements.stageEmpty.append(empty); elements.stageEmpty.hidden = state.screenStreams.size > 0; renderVoiceConnectionPanel(); return;
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
      tile.addEventListener("click", (event) => { if (!event.target.closest(".voice-tile-live-badge")) openMemberDialog(member.peerId); });
      tile.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openMemberDialog(member.peerId); } });
    }
    if (member.serverMuted || member.muted || member.deafened) tile.classList.add("voice-tile--muted");
    const cameraStream = cameraStreamForPeer(member.peerId);
    if (cameraStream) {
      tile.classList.add("voice-tile--camera");
      const video = document.createElement("video"); video.className = "voice-camera-video"; video.autoplay = true; video.playsInline = true; video.muted = isSelf; video.srcObject = cameraStream; tile.append(video);
    } else {
      const avatar = document.createElement("div"); avatar.className = "avatar voice-tile-avatar"; paintAvatar(avatar, member.name, member.avatar); tile.append(avatar);
    }
    if (state.activeScreens.has(member.peerId)) {
      const live = document.createElement("button"); live.type = "button"; live.className = "voice-tile-live-badge"; live.textContent = "AO VIVO"; live.title = `Assistir à tela de ${member.name}`;
      live.addEventListener("click", (event) => { event.stopPropagation(); if (state.screenStreams.has(member.peerId)) setScreenLayout("focus", member.peerId); }); tile.append(live);
    }
    const meta = document.createElement("div"); meta.className = "voice-tile-meta";
    const name = document.createElement("strong"); name.textContent = isSelf ? `${member.name} (você)` : member.name; const role = memberDisplayRole(member); if (role) name.style.color = role.color;
    const reconnecting = !isSelf && callSessions.retryScheduled("voice", member.peerId);
    if (reconnecting) tile.classList.add("voice-tile--reconnecting");
    const duration = document.createElement("time"); duration.className = "voice-call-duration voice-call-duration--tile"; duration.dataset.voiceJoinedAt = String(normalizeVoiceJoinedAt(member.voiceJoinedAt) || ""); duration.textContent = formatVoiceDuration(member.voiceJoinedAt);
    const status = document.createElement("span"); status.textContent = reconnecting ? "Reconectando…" : member.deafened ? "Áudio desativado" : member.serverMuted ? "Mutado pelo servidor" : member.muted ? "Microfone desligado" : "Na call";
    meta.append(name, duration, status);
    const states = voiceStateIcons(member); states.classList.add("voice-state-icons--tile");
    tile.append(meta, states); elements.stageEmpty.append(tile);
  });
  elements.stageEmpty.hidden = state.screenStreams.size > 0;
  refreshVoiceDurationLabels();
  renderVoiceConnectionPanel();
  applySpeakingStateToDom();
}
function applyLocalAudioState() { const enabled = state.inVoice && !state.muted && !state.serverMuted; state.localStream?.getAudioTracks().forEach((track) => { track.enabled = enabled; }); }

function microphoneAudioConstraints(deviceId = state.microphoneDeviceId, level = state.noiseSuppressionLevel) {
  const normalizedLevel = normalizeNoiseSuppressionLevel(level);
  const supported = navigator.mediaDevices.getSupportedConstraints();
  const constraints = {
    echoCancellation: true,
    noiseSuppression: normalizedLevel !== "off",
    autoGainControl: normalizedLevel !== "off",
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48_000 },
    sampleSize: { ideal: 16 },
  };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  if (supported.voiceIsolation && normalizedLevel === "high") constraints.voiceIsolation = true;
  return constraints;
}

async function createMicrophoneCapture(deviceId = state.microphoneDeviceId, levelOverride = state.noiseSuppressionLevel, inputVolumeOverride = state.microphoneInputVolume) {
  const requestedDevice = String(deviceId || "");
  const level = normalizeNoiseSuppressionLevel(levelOverride);
  let rawStream;
  try {
    rawStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneAudioConstraints(requestedDevice, level), video: false });
  } catch (error) {
    if (requestedDevice && ["NotFoundError", "OverconstrainedError"].includes(error?.name)) {
      rawStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneAudioConstraints("", level), video: false });
    } else throw error;
  }

  if (!window.AudioContext) return { stream: rawStream, rawStream, audioContext: null, gainNode: null, processing: level === "off" ? "off" : "native" };

  let context = null;
  try {
    context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    await context.resume();
    const source = context.createMediaStreamSource(rawStream);
    let tail = source;
    let processing = level === "off" ? "off" : "native";

    if (level === "medium" || level === "high") {
      try {
        await context.audioWorklet.addModule("./mic-noise-worklet.js");
        const highpass = context.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = level === "high" ? 115 : 85;
        highpass.Q.value = 0.72;
        const lowpass = context.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = level === "high" ? 7200 : 9000;
        lowpass.Q.value = 0.55;
        const gate = new AudioWorkletNode(context, "resenhazinha-noise-gate", { processorOptions: { level } });
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = level === "high" ? -34 : -31;
        compressor.knee.value = 14;
        compressor.ratio.value = level === "high" ? 4 : 3;
        compressor.attack.value = 0.003;
        compressor.release.value = level === "high" ? 0.16 : 0.22;
        source.connect(highpass).connect(lowpass).connect(gate).connect(compressor);
        tail = compressor;
        processing = `native+adaptive-${level}`;
      } catch (workletError) {
        console.warn("[Resenhazinha] Filtro extra de ruído indisponível; usando supressão nativa.", workletError);
        processing = "native-fallback";
      }
    }

    const gainNode = context.createGain();
    gainNode.gain.value = normalizeMicInputVolume(inputVolumeOverride);
    const destination = context.createMediaStreamDestination();
    tail.connect(gainNode).connect(destination);
    const processedTrack = destination.stream.getAudioTracks()[0];
    processedTrack.contentHint = "speech";
    return { stream: new MediaStream([processedTrack]), rawStream, audioContext: context, gainNode, processing };
  } catch (error) {
    console.warn("[Resenhazinha] Pipeline de microfone caiu para captura direta.", error);
    context?.close?.().catch?.(() => undefined);
    return { stream: rawStream, rawStream, audioContext: null, gainNode: null, processing: level === "off" ? "off" : "native-fallback" };
  }
}

function stopMicrophoneCapture(capture = null) {
  const stream = capture ? capture.stream : state.localStream;
  const rawStream = capture ? capture.rawStream : state.rawMicrophoneStream;
  const context = capture ? capture.audioContext : state.micAudioContext;
  stream?.getTracks().forEach((track) => track.stop());
  if (rawStream && rawStream !== stream) rawStream.getTracks().forEach((track) => track.stop());
  context?.close?.().catch?.(() => undefined);
  if (!capture) { stopSpeakingDetector(state.peer?.id); state.localStream = null; state.rawMicrophoneStream = null; state.micAudioContext = null; state.micGainNode = null; }
}

function installMicrophoneCapture(capture) {
  state.localStream = capture.stream;
  state.rawMicrophoneStream = capture.rawStream;
  state.micAudioContext = capture.audioContext;
  state.micGainNode = capture.gainNode || null;
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
  callSessions.beginSession("voice");
  state.voicePresenceRevision = normalizeVoicePresenceRevision(state.voicePresenceRevision) + 1;
  state.inVoice = true; state.voiceJoinedAt = Date.now(); state.resumeVoiceAfterReconnect = false;
  unlockUiAudio();
  applyLocalAudioState();
  publishLocalStatus();
  scheduleVoicePresenceSyncBurst();
  scheduleMediaReconcileBurst();
  reconcileVoiceCalls();
  renderVoiceGrid();
  updateControlState();
  switchView("voice");
  playUiSound("voiceJoin", 0.55);
  toast(`Você entrou em ${state.server.voiceChannel.name}.`);
}

function leaveVoiceChannel(options = {}) {
  if (!state.inVoice) { switchView(state.server.textChannel.exists ? "text" : "voice"); return; }
  const forced = Boolean(options?.forced);
  if (state.screenStream) stopScreenShare();
  if (state.cameraStream) stopCamera();
  if (state.deafened) state.muted = Boolean(state.mutedBeforeDeafen);
  state.deafened = false; state.mutedBeforeDeafen = false;
  if (!forced) state.voicePresenceRevision = normalizeVoicePresenceRevision(state.voicePresenceRevision) + 1;
  state.inVoice = false;
  state.voiceJoinedAt = null;
  callSessions.endSession("voice");
  callSessions.endSession("screen");
  applyLocalAudioState();
  [...state.voiceCalls.keys()].forEach((peerId) => callSessions.close("voice", peerId));
  [...state.screenCallsIn.keys()].forEach((peerId) => callSessions.close("screenIn", peerId));
  [...state.cameraCallsIn.keys()].forEach((peerId) => callSessions.close("cameraIn", peerId));
  state.cameraStreams.forEach((_stream, peerId) => clearCameraStream(peerId));
  clearScreenStage();
  elements.audioContainer.replaceChildren();
  stopAllSpeakingDetectors();
  stopMicrophoneCapture();
  publishLocalStatus(); scheduleVoicePresenceSyncBurst(); renderVoiceGrid(); updateControlState();
  playUiSound("voiceLeave", 0.55);
  if (state.server.textChannel.exists) switchView("text");
  toast(options?.message || "Você saiu da call e continuou no servidor pelo chat.");
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
    if (state.hostConnection?.open) state.hostConnection.send({ type: "attachment-request", attachmentId: cleanMeta.id });
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
  const replyRaw = message.replyTo && typeof message.replyTo === "object" ? message.replyTo : null;
  const replyTo = replyRaw && sanitizeTransferId(replyRaw.id) ? { id: sanitizeTransferId(replyRaw.id), name: cleanNickname(replyRaw.name || "Mensagem") || "Mensagem", text: normalizeChatText(replyRaw.text).slice(0, 180), clientId: sanitizeClientId(replyRaw.clientId) } : null;
  const reactions = sanitizeMessageReactions(message.reactions);
  return { id, peerId: String(message.peerId || "unknown").slice(0, 100), clientId: sanitizeClientId(message.clientId), name, roleIds: normalizeRoleIds(message.roleIds), text, attachments, replyTo, reactions, sentAt, editedAt };
}

function localMember() {
  const member = memberFrom(state.peer.id, state.nickname, state.muted, state.avatarData, state.clientId, state.bannerData, state.profileBio, state.presenceStatus); member.deafened = state.deafened; member.serverMuted = state.serverMuted; member.inVoice = state.inVoice && state.server.voiceChannel.exists; member.voiceJoinedAt = member.inVoice ? (normalizeVoiceJoinedAt(state.voiceJoinedAt) || Date.now()) : null; member.voiceSessionId = member.inVoice ? callSessions.sessionId("voice") : ""; member.voicePresenceRevision = normalizeVoicePresenceRevision(state.voicePresenceRevision); const remembered = registryRecordFor(state.clientId); member.roleIds = state.isHost ? normalizeRoleIds([...(remembered?.roleIds || ["membro"]), "admin"]) : normalizeRoleIds(remembered?.roleIds || ["membro"]); return member;
}


function memberFrom(peerId, name, muted = false, avatar = null, clientId = "", banner = null, bio = "", presence = DEFAULT_PRESENCE) { return { peerId, clientId: sanitizeClientId(clientId), name, muted: Boolean(muted), deafened: false, serverMuted: false, inVoice: false, voiceJoinedAt: null, voiceSessionId: "", voicePresenceRevision: 0, sessionStartedAt: Date.now(), avatar, banner: sanitizeProfileBanner(banner), bio: cleanBio(bio), presence: normalizePresence(presence), roleIds: ["membro"] }; }


function openRoomView() {
  state.roomEntered = true; setLobbyBusy(false); elements.lobbyView.hidden = true; elements.roomView.hidden = false; elements.roomCodeDisplay.textContent = currentInviteCode(); elements.selfName.textContent = state.nickname; state.inVoice = false; state.voiceJoinedAt = null; startConnectionHealthMonitor(); renderLocalAvatars(); setConnectionState("Conectado", "ok"); applyLocalAudioState(); ensureValidView(); renderServerUI(); updateControlState(); renderMembers(); renderVoiceGrid();
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
  if (!state.peer?.open || !state.localStream) return;
  const activeIds = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  state.voiceCalls.forEach((call, peerId) => {
    if (!activeIds.has(peerId)) {
      callSessions.cancelRetries("voice", peerId);
      callSessions.close("voice", peerId);
      removeRemoteAudio(peerId, call);
    }
  });
  if (!state.inVoice) return;
  state.members.forEach((member) => {
    if (!member.inVoice || member.peerId === state.peer.id || state.voiceCalls.has(member.peerId)) return;
    if (!shouldInitiateVoiceCall(state.peer.id, member.peerId)) return;
    const call = state.peer.call(member.peerId, state.localStream, {
      metadata: {
        kind: "voice",
        protocolVersion: CALL_PROTOCOL_VERSION,
        voiceSessionId: callSessions.sessionId("voice"),
        voicePresenceRevision: normalizeVoicePresenceRevision(state.voicePresenceRevision),
        clientId: state.clientId,
        nickname: state.nickname,
      },
    });
    if (call) registerVoiceCall(call, { direction: "outbound" });
  });
}


function clearCameraStream(peerId) {
  const id = String(peerId || "");
  if (!id) return;
  const stream = state.cameraStreams.get(id);
  if (stream) stream.getTracks().forEach((track) => { try { track.stop(); } catch (_error) {} });
  state.cameraStreams.delete(id);
  renderVoiceMiniList();
  renderVoiceGrid();
}

function stopCamera() {
  const stream = state.cameraStream;
  state.cameraStream = null;
  callSessions.endSession("camera");
  if (stream) stream.getTracks().forEach((track) => { try { track.stop(); } catch (_error) {} });
  [...state.cameraCallsOut.keys()].forEach((peerId) => callSessions.close("cameraOut", peerId));
  renderVoiceMiniList();
  renderVoiceGrid();
  updateControlState();
}

async function toggleCamera() {
  if (!state.inVoice || !state.server.voiceChannel.exists) { toast("Entre na call para ligar a câmera."); return; }
  if (state.cameraStream) { stopCamera(); toast("Câmera desligada."); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("camera-track-missing");
    track.contentHint = "motion";
    track.addEventListener("ended", () => { if (state.cameraStream === stream) stopCamera(); }, { once: true });
    callSessions.beginSession("camera");
    state.cameraStream = stream;
    reconcileCameraCalls();
    renderVoiceMiniList();
    renderVoiceGrid();
    updateControlState();
    toast("Câmera ligada.");
  } catch (error) {
    if (error?.name !== "NotAllowedError") console.warn("[Resenhazinha] Falha ao abrir câmera.", error);
    toast(error?.name === "NotAllowedError" ? "Permita o acesso à câmera para ligar o vídeo." : "Não consegui abrir a câmera.", "error");
  }
}

function reconcileCameraCalls() {
  const activeIds = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  state.cameraCallsOut.forEach((call, peerId) => {
    if (!state.cameraStream || !state.inVoice || !activeIds.has(peerId)) {
      callSessions.close("cameraOut", peerId);
    }
  });
  if (!state.cameraStream || !state.peer?.open || !state.inVoice) return;
  state.members.forEach((member) => {
    if (!member.inVoice || member.peerId === state.peer.id || state.cameraCallsOut.has(member.peerId)) return;
    const call = state.peer.call(member.peerId, state.cameraStream, { metadata: { kind: "camera", protocolVersion: CALL_PROTOCOL_VERSION, voiceSessionId: callSessions.sessionId("voice"), cameraSessionId: callSessions.sessionId("camera"), cameraName: state.nickname, clientId: state.clientId } });
    if (!call) return;
    callSessions.adopt("cameraOut", member.peerId, call, { voiceSessionId: callSessions.sessionId("voice"), cameraSessionId: callSessions.sessionId("camera") });
    const ended = () => {
      if (!callSessions.release("cameraOut", member.peerId, call)) return;
      if (state.cameraStream && state.inVoice) scheduleCameraReconnect(member.peerId);
    };
    call.on("close", ended);
    call.on("error", ended);
    window.setTimeout(() => {
      if (callSessions.isCurrent("cameraOut", member.peerId, call)) callSessions.markHealthy("camera", member.peerId);
    }, 5000);
  });
}

function scheduleCameraReconnect(peerId) {
  callSessions.scheduleRetry("camera", peerId, CAMERA_RECONNECT_DELAYS, ({ sessionId }) => {
    if (!state.cameraStream || sessionId !== callSessions.sessionId("camera")) return;
    reconcileCameraCalls();
    if (!state.cameraCallsOut.has(peerId)) scheduleCameraReconnect(peerId);
  });
}

function handleIncomingCall(call) {
  if (String(call.metadata?.kind || "").startsWith("camera")) {
    const member = memberForCloudIdentity(call.peer, call.metadata?.clientId);
    const remoteSessionId = normalizeMediaSessionId(call.metadata?.voiceSessionId);
    const remoteCameraSessionId = normalizeMediaSessionId(call.metadata?.cameraSessionId);
    const expectedRemoteSessionId = normalizeMediaSessionId(member?.voiceSessionId);
    if (!state.inVoice || !state.server.voiceChannel.exists || !member?.inVoice || (remoteSessionId && expectedRemoteSessionId && remoteSessionId !== expectedRemoteSessionId)) { call.close(); return; }
    const previousCall = state.cameraCallsIn.get(call.peer);
    const previousCameraSessionId = normalizeMediaSessionId(callSessions.detail("cameraIn", call.peer, previousCall)?.cameraSessionId);
    if (previousCall && previousCameraSessionId && remoteCameraSessionId === previousCameraSessionId) { call.close(); return; }
    call.answer(new MediaStream());
    callSessions.adopt("cameraIn", call.peer, call, { voiceSessionId: remoteSessionId, cameraSessionId: remoteCameraSessionId });
    call.on("stream", (stream) => {
      if (!callSessions.isCurrent("cameraIn", call.peer, call)) return;
      state.cameraStreams.set(call.peer, stream);
      stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => handleIncomingCameraDropped(call), { once: true }));
      renderVoiceMiniList(); renderVoiceGrid();
    });
    const ended = () => handleIncomingCameraDropped(call);
    call.on("close", ended); call.on("error", ended); return;
  }
  if (String(call.metadata?.kind || "").startsWith("screen")) {
    const sharer = memberForCloudIdentity(call.peer, call.metadata?.clientId);
    const remoteSessionId = normalizeMediaSessionId(call.metadata?.screenSessionId);
    const announcedSessionId = normalizeMediaSessionId(state.activeScreens.get(call.peer)?.screenSessionId);
    const invalidSession = Boolean(remoteSessionId && announcedSessionId && remoteSessionId !== announcedSessionId);
    if (!state.inVoice || !state.server.voiceChannel.exists || !sharer?.inVoice || invalidSession) { call.close(); return; }
    const previousCall = state.screenCallsIn.get(call.peer);
    const previousSessionId = normalizeMediaSessionId(callSessions.detail("screenIn", call.peer, previousCall)?.screenSessionId);
    if (previousCall && previousSessionId && remoteSessionId === previousSessionId) { call.close(); return; }
    call.answer(new MediaStream());
    callSessions.adopt("screenIn", call.peer, call, { screenSessionId: remoteSessionId });
    callSessions.armNegotiation("screenIn", call.peer, call, MEDIA_NEGOTIATION_TIMEOUT_MS, () => {
      handleIncomingScreenDropped(call);
      try { call.close(); } catch (_error) {}
    });
    call.on("stream", (stream) => {
      if (!callSessions.isCurrent("screenIn", call.peer, call)) return;
      callSessions.clearNegotiation("screenIn", call.peer);
      const name = call.metadata?.sharerName || memberName(call.peer) || "Um amigo";
      const screenSessionId = remoteSessionId || announcedSessionId;
      state.activeScreens.set(call.peer, { peerId: call.peer, name, screenSessionId });
      state.activeScreen = state.activeScreens.values().next().value || null;
      showScreenStage(stream, name, false, { peerId: call.peer, quality: call.metadata?.quality, fps: call.metadata?.fps, screenSessionId, ownerCall: call });
      stream.getTracks().forEach((track) => track.addEventListener("ended", () => handleIncomingScreenDropped(call), { once: true }));
      renderMembers();
    });
    call.on("close", () => handleIncomingScreenDropped(call));
    call.on("error", () => handleIncomingScreenDropped(call));
    return;
  }
  const caller = memberForCloudIdentity(call.peer, call.metadata?.clientId);
  if (caller && caller.peerId !== call.peer && sanitizeClientId(call.metadata?.clientId) === caller.clientId) {
    const oldPeerId = caller.peerId;
    caller.peerId = call.peer;
    closeCallsForPeer(oldPeerId);
    state.activeScreens.delete(oldPeerId);
  }
  const remoteSessionId = normalizeMediaSessionId(call.metadata?.voiceSessionId);
  const remoteRevision = normalizeVoicePresenceRevision(call.metadata?.voicePresenceRevision);
  const callerRevision = normalizeVoicePresenceRevision(caller?.voicePresenceRevision);
  let expectedRemoteSessionId = normalizeMediaSessionId(caller?.voiceSessionId);

  // A própria oferta WebRTC é uma prova mais nova de presença que um roster
  // atrasado. Isso evita que dois usuários entrem na call e cada lado continue
  // se vendo sozinho até o próximo roster.
  if (caller && !caller.offlineSnapshot && remoteSessionId && shouldApplyVoicePresenceSnapshot(callerRevision, remoteRevision)) {
    if (!caller.inVoice || !expectedRemoteSessionId || expectedRemoteSessionId !== remoteSessionId) {
      caller.inVoice = true;
      caller.voiceJoinedAt = normalizeVoiceJoinedAt(caller.voiceJoinedAt) || Date.now();
      caller.voiceSessionId = remoteSessionId;
      caller.voicePresenceRevision = Math.max(callerRevision, remoteRevision);
      expectedRemoteSessionId = remoteSessionId;
      renderMembers();
      renderVoiceGrid();
    }
  }

  const invalidSession = Boolean(remoteSessionId && expectedRemoteSessionId && remoteSessionId !== expectedRemoteSessionId);
  const wrongDirection = shouldInitiateVoiceCall(state.peer?.id, call.peer);
  if (!state.inVoice || !state.server.voiceChannel.exists || !caller || caller.offlineSnapshot || (!caller.inVoice && !remoteSessionId) || invalidSession || wrongDirection || state.voiceCalls.has(call.peer)) {
    call.close();
    if (wrongDirection) window.setTimeout(reconcileVoiceCalls, 0);
    return;
  }
  call.answer(state.localStream || new MediaStream());
  registerVoiceCall(call, { direction: "inbound", remoteSessionId, remoteRevision });
}

function handleIncomingCameraDropped(call) {
  if (!callSessions.release("cameraIn", call.peer, call)) return;
  clearCameraStream(call.peer);
}

function handleIncomingScreenDropped(call) {
  if (!callSessions.release("screenIn", call.peer, call)) return;
  const entry = state.screenStreams.get(call.peer);
  if (!entry?.ownerCall || entry.ownerCall === call) clearScreenStage(call.peer);
  renderMembers();
}


function registerVoiceCall(call, detail = {}) {
  if (!callSessions.adopt("voice", call.peer, call, detail)) return;
  callSessions.armNegotiation("voice", call.peer, call, MEDIA_NEGOTIATION_TIMEOUT_MS, () => {
    handleVoiceCallDropped(call);
    try { call.close(); } catch (_error) {}
  });
  call.on("stream", (stream) => {
    if (!callSessions.isCurrent("voice", call.peer, call)) return;
    callSessions.clearNegotiation("voice", call.peer);
    callSessions.markHealthy("voice", call.peer);
    void attachRemoteAudio(call.peer, stream, call);
  });
  call.on("close", () => handleVoiceCallDropped(call));
  call.on("error", () => handleVoiceCallDropped(call));
}

function handleVoiceCallDropped(call) {
  if (!callSessions.release("voice", call.peer, call)) return;
  removeRemoteAudio(call.peer, call);
  const member = state.members.find((item) => item.peerId === call.peer);
  if (state.inVoice && member?.inVoice) scheduleVoiceReconnect(call.peer);
}

function scheduleVoiceReconnect(peerId) {
  if (!state.inVoice || !state.peer?.open || !shouldInitiateVoiceCall(state.peer.id, peerId) || !state.members.some((member) => member.peerId === peerId && member.inVoice)) return;
  callSessions.scheduleRetry("voice", peerId, VOICE_RECONNECT_DELAYS, ({ sessionId }) => {
    if (!state.inVoice || sessionId !== callSessions.sessionId("voice")) return;
    reconcileVoiceCalls();
    if (!state.voiceCalls.has(peerId)) scheduleVoiceReconnect(peerId);
  });
}

function tuneVoiceSender(call, maxBitrate) {
  const pc = call?.peerConnection || call?._pc;
  const sender = pc?.getSenders?.().find((item) => item.track?.kind === "audio");
  if (!sender?.getParameters || !sender?.setParameters) return;
  try {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.encodings[0].maxBitrate = Math.max(24_000, Math.min(96_000, Number(maxBitrate) || 64_000));
    sender.setParameters(parameters).catch(() => undefined);
  } catch (_error) {}
}

async function collectVoiceStats(peerId, call) {
  const pc = call?.peerConnection || call?._pc;
  if (!pc?.getStats) return null;
  try {
    const reports = await pc.getStats();
    let rttMs = null; let lost = 0; let received = 0; let outboundBytes = 0; let inboundJitterMs = null;
    reports.forEach((report) => {
      if (report.type === "candidate-pair" && report.state === "succeeded" && (report.nominated || report.selected) && Number.isFinite(report.currentRoundTripTime)) rttMs = Math.round(report.currentRoundTripTime * 1000);
      if (report.type === "remote-inbound-rtp" && report.kind === "audio" && Number.isFinite(report.roundTripTime)) rttMs = Math.round(report.roundTripTime * 1000);
      if (report.type === "inbound-rtp" && report.kind === "audio") { lost += Number(report.packetsLost) || 0; received += Number(report.packetsReceived) || 0; if (Number.isFinite(report.jitter)) inboundJitterMs = Math.round(report.jitter * 1000); }
      if (report.type === "outbound-rtp" && report.kind === "audio") outboundBytes += Number(report.bytesSent) || 0;
    });
    const lossPercent = received + lost > 0 ? Math.max(0, Math.round((lost / (received + lost)) * 1000) / 10) : 0;
    const quality = (rttMs ?? 0) > 320 || lossPercent >= 8 ? "ruim" : (rttMs ?? 0) > 180 || lossPercent >= 3 ? "média" : "boa";
    const targetBitrate = quality === "ruim" ? 32_000 : quality === "média" ? 48_000 : 64_000;
    tuneVoiceSender(call, targetBitrate);
    const result = { peerId, rttMs, lossPercent, jitterMs: inboundJitterMs, targetBitrateKbps: Math.round(targetBitrate / 1000), outboundBytes, quality, updatedAt: Date.now() };
    state.voiceStats.set(peerId, result);
    renderVoiceConnectionPanel();
    return result;
  } catch (_error) { return null; }
}

function startConnectionHealthMonitor() {
  window.clearInterval(state.diagnosticsTimer);
  window.clearInterval(state.voiceUiTimer);
  state.diagnosticsTimer = window.setInterval(() => {
    state.voiceCalls.forEach((call, peerId) => { void collectVoiceStats(peerId, call); });
    renderVoiceConnectionPanel();
    if (elements.diagnosticsDialog?.open) void refreshDiagnostics();
  }, DIAGNOSTIC_INTERVAL_MS);
  state.voiceUiTimer = window.setInterval(() => {
    refreshVoiceDurationLabels();
    renderVoiceConnectionPanel();
  }, 1000);
  renderVoiceConnectionPanel();
}

function stopConnectionHealthMonitor() {
  window.clearInterval(state.diagnosticsTimer);
  window.clearInterval(state.voiceUiTimer);
  state.diagnosticsTimer = null;
  state.voiceUiTimer = null;
}

function clampVolume(value) { return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1)); }
function getMemberVolume(peerId) { return state.memberVolumes.has(peerId) ? clampIndividualVolume(state.memberVolumes.get(peerId)) : 1; }

async function ensurePlaybackAudioContext() {
  if (!window.AudioContext) return null;
  if (!state.playbackAudioContext || state.playbackAudioContext.state === "closed") state.playbackAudioContext = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
  if (state.playbackAudioContext.state === "suspended") await state.playbackAudioContext.resume().catch(() => undefined);
  return state.playbackAudioContext;
}

async function applyOutputDevice(element, deviceId = state.speakerDeviceId) {
  if (!element?.setSinkId) return;
  try { await element.setSinkId(String(deviceId || "") || "default"); } catch (_error) { /* usa o padrão do sistema */ }
}

async function applyOutputDeviceToAll() {
  const elementsToUpdate = [...state.memberAudioNodes.values(), ...state.screenAudioNodes.values()].map((node) => node.audio).filter(Boolean);
  await Promise.all(elementsToUpdate.map((audio) => applyOutputDevice(audio)));
}

function updateMemberPlaybackGain(peerId) {
  const volume = getMemberVolume(peerId);
  const effective = state.microphoneTest?.silencingPlayback ? 0 : volume * normalizeOutputVolume(state.outputVolume);
  const node = state.memberAudioNodes.get(peerId);
  if (node?.gain) node.gain.gain.value = effective;
  const audio = document.getElementById(`audio-${safeId(peerId)}`);
  if (audio && !node?.gain) audio.volume = Math.min(1, effective);
}

function disposeMemberAudioNode(peerId) {
  const node = state.memberAudioNodes.get(peerId);
  if (!node) return;
  try { node.source?.disconnect?.(); } catch (_error) {}
  try { node.gain?.disconnect?.(); } catch (_error) {}
  try { node.audio.srcObject = null; } catch (_error) {}
  state.memberAudioNodes.delete(peerId);
}

function setMemberVolume(peerId, value) {
  const volume = clampIndividualVolume(value);
  state.memberVolumes.set(peerId, volume);
  if (volume > 0.001) state.lastNonZeroMemberVolumes.set(peerId, volume);
  updateMemberPlaybackGain(peerId);
  if (state.selectedMemberPeerId === peerId) { elements.memberVolumeRange.value = String(Math.round(volume * 100)); elements.memberVolumeValue.textContent = `${Math.round(volume * 100)}%`; }
  if (state.voiceContextPeerId === peerId && !elements.voiceContextMenu.hidden) {
    elements.voiceContextVolumeRange.value = String(Math.round(volume * 100));
    elements.voiceContextVolumeValue.textContent = `${Math.round(volume * 100)}%`;
    elements.voiceContextLocalMuteButton.classList.toggle("is-checked", volume <= 0.001);
    elements.voiceContextLocalMuteButton.setAttribute("aria-pressed", volume <= 0.001 ? "true" : "false");
  }
}

async function attachRemoteAudio(peerId, stream, ownerCall) {
  if (!callSessions.isCurrent("voice", peerId, ownerCall)) return;
  removeRemoteAudio(peerId);
  const audio = document.createElement("audio");
  audio.id = `audio-${safeId(peerId)}`;
  audio.autoplay = true;
  audio.dataset.voicePeerId = peerId;
  audio._resenhazinhaOwnerCall = ownerCall;
  audio.muted = state.deafened;
  elements.audioContainer.append(audio);
  try {
    const context = await ensurePlaybackAudioContext();
    if (!callSessions.isCurrent("voice", peerId, ownerCall)) { audio.remove(); return; }
    if (context) {
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      source.connect(gain).connect(destination);
      audio.srcObject = destination.stream;
      state.memberAudioNodes.set(peerId, { source, gain, destination, audio, stream, ownerCall });
    } else audio.srcObject = stream;
    updateMemberPlaybackGain(peerId);
    await applyOutputDevice(audio);
    if (!callSessions.isCurrent("voice", peerId, ownerCall)) { removeRemoteAudio(peerId, ownerCall); return; }
    await audio.play().catch(() => undefined);
  } catch (_error) {
    if (!callSessions.isCurrent("voice", peerId, ownerCall)) { removeRemoteAudio(peerId, ownerCall); return; }
    audio.srcObject = stream;
    audio.volume = Math.min(1, getMemberVolume(peerId) * state.outputVolume);
    audio.play().catch(() => undefined);
  }
  startSpeakingDetector(peerId, stream);
}

function removeRemoteAudio(peerId, ownerCall = null) {
  const node = state.memberAudioNodes.get(peerId);
  const audio = document.getElementById(`audio-${safeId(peerId)}`);
  if (ownerCall && node?.ownerCall && node.ownerCall !== ownerCall) return;
  if (ownerCall && !node && audio?._resenhazinhaOwnerCall && audio._resenhazinhaOwnerCall !== ownerCall) return;
  disposeMemberAudioNode(peerId);
  audio?.remove();
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
  elements.audioContainer.querySelectorAll("audio[data-voice-peer-id]").forEach((audio) => { audio.muted = state.deafened; });
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

function disposeScreenAudioNode(peerId) {
  const node = state.screenAudioNodes.get(peerId);
  if (!node) return;
  try { node.source?.disconnect?.(); } catch (_error) {}
  try { node.gain?.disconnect?.(); } catch (_error) {}
  try { node.audio?.remove?.(); } catch (_error) {}
  state.screenAudioNodes.delete(peerId);
}

async function ensureScreenAudioNode(peerId) {
  const entry = state.screenStreams.get(peerId);
  if (!entry || entry.isLocal || !entry.stream?.getAudioTracks().length) { disposeScreenAudioNode(peerId); return null; }
  const existing = state.screenAudioNodes.get(peerId);
  if (existing?.stream === entry.stream) return existing;
  disposeScreenAudioNode(peerId);
  const context = await ensurePlaybackAudioContext();
  if (state.screenStreams.get(peerId)?.stream !== entry.stream) return null;
  if (!context) return null;
  const source = context.createMediaStreamSource(entry.stream);
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  source.connect(gain).connect(destination);
  const audio = document.createElement("audio");
  audio.id = `screen-audio-${safeId(peerId)}`;
  audio.autoplay = true;
  audio.dataset.screenAudioPeerId = peerId;
  audio.srcObject = destination.stream;
  elements.audioContainer.append(audio);
  const node = { source, gain, destination, audio, stream: entry.stream };
  state.screenAudioNodes.set(peerId, node);
  await applyOutputDevice(audio);
  if (state.screenStreams.get(peerId)?.stream !== entry.stream || state.screenAudioNodes.get(peerId) !== node) {
    try { source.disconnect(); gain.disconnect(); audio.remove(); } catch (_error) {}
    return null;
  }
  await audio.play().catch(() => undefined);
  return node;
}

function setScreenVolume(peerId, value) {
  const entry = state.screenStreams.get(peerId);
  if (!entry || entry.isLocal) return;
  const setting = getScreenAudioSetting(peerId);
  setting.volume = clampIndividualVolume(value);
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

async function applyScreenAudioState(peerId) {
  const entry = state.screenStreams.get(peerId);
  const video = document.querySelector(`[data-screen-video="${CSS.escape(peerId)}"]`);
  if (!entry) return;
  if (entry.isLocal) { if (video) video.muted = true; disposeScreenAudioNode(peerId); return; }
  const setting = getScreenAudioSetting(peerId);
  const hasAudio = Boolean(entry.stream?.getAudioTracks().length);
  const node = await ensureScreenAudioNode(peerId).catch(() => null);
  if (state.screenStreams.get(peerId)?.stream !== entry.stream) return;
  if (node?.gain) {
    node.gain.gain.value = state.microphoneTest?.silencingPlayback || setting.muted || !hasAudio ? 0 : setting.volume * normalizeOutputVolume(state.outputVolume);
    node.audio.muted = false;
    if (video) video.muted = true;
  } else if (video) {
    video.volume = Math.min(1, setting.volume * normalizeOutputVolume(state.outputVolume));
    video.muted = Boolean(state.microphoneTest?.silencingPlayback) || setting.muted || !hasAudio;
  }
}

function applyAllScreenAudioStates() {
  state.screenStreams.forEach((_entry, peerId) => { void applyScreenAudioState(peerId); });
  renderScreenStage();
}

function applyAllPlaybackAudioSettings() {
  state.memberVolumes.forEach((_volume, peerId) => updateMemberPlaybackGain(peerId));
  state.memberAudioNodes.forEach((_node, peerId) => updateMemberPlaybackGain(peerId));
  state.screenStreams.forEach((_entry, peerId) => { void applyScreenAudioState(peerId); });
}

function publishLocalStatus() {
  if (!state.peer?.open) return;
  const voiceState = localVoicePresenceState();

  const self = state.members.find((member) => member.peerId === state.peer.id);
  if (self) {
    self.muted = state.muted;
    self.deafened = state.deafened;
    self.inVoice = voiceState.inVoice;
    self.voiceJoinedAt = voiceState.voiceJoinedAt;
    self.voiceSessionId = voiceState.voiceSessionId;
    self.voicePresenceRevision = voiceState.voicePresenceRevision;
    self.serverMuted = state.serverMuted;
    self.presence = normalizePresence(state.presenceStatus);
  }

  if (state.hostConnection?.open) {
    state.hostConnection.send({ type: "status", ...voiceState });
  }

  if (state.isHost) scheduleServerPersistence();
  renderMembers();
  renderVoiceGrid();
  reconcileVoiceCalls();
  reconcileCameraCalls();
}


function updateControlState() {
  try { window.resenhazinhaDesktop?.setVoiceActive?.(Boolean(state.inVoice)); } catch (_error) {}
  const micOff = state.muted || state.serverMuted || state.deafened || !state.inVoice;
  const micButtons = [elements.micButton, elements.callMicButton].filter(Boolean);
  micButtons.forEach((button) => {
    button.classList.toggle("is-off", micOff); button.classList.toggle("is-server-muted", state.serverMuted);
    button.disabled = state.serverMuted || state.deafened || !state.inVoice;
    button.setAttribute("aria-label", state.serverMuted ? "Mutado pelo servidor" : state.deafened ? "Microfone mutado porque o áudio está desativado" : state.muted ? "Ligar microfone" : "Desligar microfone");
    if (button.dataset.tooltip !== undefined) button.dataset.tooltip = state.muted ? "Ligar microfone" : "Desligar microfone";
  });
  const deafenButtons = [elements.deafenButton, elements.callDeafenButton].filter(Boolean);
  deafenButtons.forEach((button) => {
    button.classList.toggle("is-off", state.deafened); button.disabled = !state.inVoice;
    button.setAttribute("aria-label", state.deafened ? "Ativar áudio da call" : "Desativar áudio da call");
    if (button.dataset.tooltip !== undefined) button.dataset.tooltip = state.deafened ? "Ativar áudio" : "Desativar áudio";
  });
  elements.cameraButton.classList.toggle("is-active", Boolean(state.cameraStream));
  elements.cameraButton.disabled = !state.inVoice || !state.server.voiceChannel.exists;
  elements.cameraButton.setAttribute("aria-label", state.cameraStream ? "Desligar câmera" : "Ligar câmera");
  elements.cameraButton.dataset.tooltip = state.cameraStream ? "Desligar câmera" : "Ligar câmera";
  elements.shareButton.classList.toggle("is-sharing", Boolean(state.screenStream)); elements.shareButton.disabled = !state.inVoice || !state.server.voiceChannel.exists; elements.shareButton.setAttribute("aria-label", state.screenStream ? "Parar compartilhamento" : "Compartilhar tela");
  elements.shareButton.dataset.tooltip = state.screenStream ? "Parar compartilhamento" : "Compartilhar tela";
  elements.voiceJoinButton.hidden = state.inVoice || !state.server.voiceChannel.exists; elements.voiceLeaveButton.hidden = !state.inVoice || !state.server.voiceChannel.exists;
  elements.leaveButton.hidden = !state.inVoice || !state.server.voiceChannel.exists; elements.leaveButton.disabled = !state.inVoice; elements.leaveButton.setAttribute("aria-label", "Sair da call e continuar no chat"); elements.leaveButton.title = "Sair da call e continuar no servidor";
  const selfPresence = presenceLabel(state.presenceStatus);
  elements.selfState.textContent = !state.inVoice ? `${selfPresence} · fora da call` : state.deafened ? `${selfPresence} · áudio e microfone desativados` : state.serverMuted ? `${selfPresence} · mutado pelo servidor` : state.muted ? `${selfPresence} · microfone desligado` : `${selfPresence} · microfone ligado`;
  elements.selfState.dataset.presence = normalizePresence(state.presenceStatus);
  renderVoiceConnectionPanel();
  refreshVoiceDurationLabels();
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
  state.screenSourceFilter = "all"; state.screenSourceSearch = "";
  elements.sourceSearch.value = ""; elements.sourceFilterButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.sourceFilter === "all"));
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
  const filter = state.screenSourceFilter || "all";
  const query = state.screenSourceSearch || "";
  const filtered = (sources || []).filter((source) => {
    const kind = String(source.id || "").startsWith("screen:") ? "screen" : "window";
    if (filter !== "all" && kind !== filter) return false;
    return !query || String(source.name || "").toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
  });
  if (!filtered.length) { const empty = document.createElement("div"); empty.className = "source-loading"; empty.textContent = query ? "Nenhuma tela ou aplicativo com esse nome." : "Nada disponível nessa categoria."; elements.sourceGrid.append(empty); return; }
  filtered.forEach((source) => {
    const card = document.createElement("article");
    card.className = "source-card";
    const kindBadge = document.createElement("span"); kindBadge.className = "source-kind-badge"; kindBadge.textContent = String(source.id || "").startsWith("screen:") ? "TELA" : "APLICATIVO"; card.append(kindBadge);
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
        try {
          const fallbackSelected = window.resenhazinhaDesktop?.selectScreenSource?.(source.id);
          if (fallbackSelected === false) throw new Error("invalid-desktop-source");
          const fallbackStream = await captureDisplayMedia(true);
          displayStream.getTracks().forEach((track) => track.stop());
          stream = fallbackStream;
          toast("O filtro de aplicativos falhou; usando o áudio completo do computador.");
        } catch (_fallbackError) {
          toast("Não consegui capturar o som do computador; a imagem continua compartilhada.", "error");
        }
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
  const screenSessionId = callSessions.beginSession("screen");
  state.screenStream = stream;
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.contentHint = shareProfile().fps >= 60 ? "motion" : "detail";
    videoTrack.addEventListener("ended", () => {
      if (state.screenStream === stream && callSessions.sessionId("screen") === screenSessionId) stopScreenShare();
    }, { once: true });
  }
  state.activeScreens.set(state.peer.id, { peerId: state.peer.id, name: state.nickname, screenSessionId });
  state.activeScreen = state.activeScreens.values().next().value || null;
  showScreenStage(stream, state.nickname, true, { peerId: state.peer.id, screenSessionId, ...shareProfile() });
  publishLocalStatus();
  announceScreenState(true);
  renderMembers();
  reconcileScreenCalls();
  scheduleMediaReconcileBurst();
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
  const activeIds = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  state.screenCallsIn.forEach((call, peerId) => {
    const receivedSessionId = normalizeMediaSessionId(callSessions.detail("screenIn", peerId, call)?.screenSessionId);
    const announcedSessionId = normalizeMediaSessionId(state.activeScreens.get(peerId)?.screenSessionId);
    if (!state.inVoice || !activeIds.has(peerId) || !state.activeScreens.has(peerId) || (receivedSessionId && announcedSessionId && receivedSessionId !== announcedSessionId)) {
      callSessions.close("screenIn", peerId);
      clearScreenStage(peerId);
    }
  });
  if (!state.screenStream || !state.peer?.open || !state.inVoice) return;
  state.screenCallsOut.forEach((call, peerId) => {
    if (!activeIds.has(peerId)) {
      callSessions.cancelRetries("screen", peerId);
      callSessions.close("screenOut", peerId);
    }
  });
  const profile = shareProfile();
  state.members.forEach((member) => {
    if (!member.inVoice || member.peerId === state.peer.id || state.screenCallsOut.has(member.peerId)) return;
    const call = state.peer.call(member.peerId, state.screenStream, { metadata: { kind: "screen", protocolVersion: CALL_PROTOCOL_VERSION, screenSessionId: callSessions.sessionId("screen"), sharerName: state.nickname, clientId: state.clientId, quality: profile.quality, fps: profile.fps } });
    if (!call) return;
    callSessions.adopt("screenOut", member.peerId, call, { screenSessionId: callSessions.sessionId("screen") });
    tuneScreenCall(call);
    const markDropped = () => handleOutgoingScreenDropped(member.peerId, call);
    call.on("close", markDropped);
    call.on("error", markDropped);
    window.setTimeout(() => {
      if (callSessions.isCurrent("screenOut", member.peerId, call)) callSessions.markHealthy("screen", member.peerId);
    }, 5000);
  });
}

function handleOutgoingScreenDropped(peerId, call) {
  if (!callSessions.release("screenOut", peerId, call)) return;
  if (!state.screenStream || !state.inVoice || !state.members.some((member) => member.peerId === peerId && member.inVoice)) return;
  scheduleScreenReconnect(peerId);
}

function scheduleScreenReconnect(peerId) {
  callSessions.scheduleRetry("screen", peerId, SCREEN_RECONNECT_DELAYS, ({ sessionId }) => {
    if (!state.screenStream || sessionId !== callSessions.sessionId("screen")) return;
    reconcileScreenCalls();
    if (!state.screenCallsOut.has(peerId)) scheduleScreenReconnect(peerId);
  });
}

function stopScreenShare() {
  if (!state.screenStream) return;
  const stream = state.screenStream;
  state.screenStream = null;
  const screenSessionId = callSessions.sessionId("screen");
  callSessions.endSession("screen");
  stream.getTracks().forEach((track) => track.stop());
  stopFilteredAudioCapture();
  [...state.screenCallsOut.keys()].forEach((peerId) => callSessions.close("screenOut", peerId));
  state.activeScreens.delete(state.peer?.id);
  state.activeScreen = state.activeScreens.values().next().value || null;
  announceScreenState(false, screenSessionId);
  clearScreenStage(state.peer?.id);
  renderMembers();
  updateControlState();
  playUiSound("screenStop", 0.52);
  toast("Compartilhamento encerrado.");
}

function announceScreenState(started, stoppedSessionId = "") {
  const screenSessionId = started ? callSessions.sessionId("screen") : normalizeMediaSessionId(stoppedSessionId);
  const message = { type: started ? "screen-started" : "screen-stopped", screenSessionId };
  if (state.hostConnection?.open) state.hostConnection.send(message);
}

function showScreenStage(stream, ownerName, isLocal, profile = null) {
  const peerId = String(profile?.peerId || (isLocal ? state.peer?.id : "") || "");
  if (!peerId || !stream) return;
  const quality = ["720p", "1080p", "1440p"].includes(profile?.quality) ? profile.quality : null;
  const fps = [15, 30, 60].includes(Number(profile?.fps)) ? Number(profile.fps) : null;
  state.screenStreams.set(peerId, { peerId, stream, name: ownerName || memberName(peerId) || "Amigo", isLocal: Boolean(isLocal), quality, fps, screenSessionId: normalizeMediaSessionId(profile?.screenSessionId), ownerCall: profile?.ownerCall || null });
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
    if (!entry.isLocal) video.muted = true;

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
    const viewActions = document.createElement("div"); viewActions.className = "screen-card-view-actions";
    const pipButton = document.createElement("button");
    pipButton.type = "button";
    pipButton.className = "screen-card-view-action";
    pipButton.title = "Picture-in-Picture";
    pipButton.setAttribute("aria-label", "Abrir Picture-in-Picture");
    pipButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5h6v6"/><path d="m19 5-8 8"/><path d="M11 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5"/></svg>';
    pipButton.addEventListener("click", () => void toggleStreamPictureInPicture(entry.peerId));
    const fullscreenButton = document.createElement("button");
    fullscreenButton.type = "button";
    fullscreenButton.className = "screen-card-view-action screen-card-fullscreen";
    fullscreenButton.title = "Tela cheia";
    fullscreenButton.setAttribute("aria-label", "Assistir em tela cheia");
    fullscreenButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg>';
    fullscreenButton.addEventListener("click", () => void toggleStreamFullscreen(entry.peerId));
    viewActions.append(pipButton, fullscreenButton);
    video.addEventListener("dblclick", () => void toggleStreamFullscreen(entry.peerId));
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
      const range = document.createElement("input"); range.className = "audio-volume-range screen-card-volume"; range.type = "range"; range.min = "0"; range.max = "200"; range.step = "1"; range.value = String(Math.round(setting.volume * 100)); range.disabled = !hasAudio; range.setAttribute("aria-label", `Volume da tela de ${entry.name}`);
      range.addEventListener("input", () => setScreenVolume(entry.peerId, Number(range.value) / 100));
      const volume = document.createElement("span"); volume.className = "audio-volume-value"; volume.dataset.screenVolumeValue = entry.peerId; volume.textContent = `${Math.round(setting.volume * 100)}%`;
      bottom.append(mute, range, volume);
    }
    if (entries.length > 1 && state.screenLayout !== "focus") {
      const focus = document.createElement("button"); focus.type = "button"; focus.className = "screen-card-focus"; focus.textContent = "Focar"; focus.addEventListener("click", () => setScreenLayout("focus", entry.peerId)); bottom.append(focus);
    }
    bottom.append(viewActions);
    card.append(video, top, bottom);
    elements.screenGrid.append(card);
    applyScreenAudioState(entry.peerId);
    video.play().catch(() => undefined);
  });
}


function screenVideoElement(peerId) {
  return document.querySelector(`[data-screen-video="${CSS.escape(String(peerId || ""))}"]`);
}

async function toggleStreamFullscreen(peerId) {
  const video = screenVideoElement(peerId);
  if (!video) return;
  try {
    if (document.pictureInPictureElement === video) await document.exitPictureInPicture().catch(() => undefined);
    if (document.fullscreenElement === video) {
      await document.exitFullscreen();
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    if (!video.requestFullscreen) {
      toast("Tela cheia não está disponível nessa versão do Windows.");
      return;
    }
    await video.play().catch(() => undefined);
    await video.requestFullscreen();
  } catch (error) {
    console.warn("[Resenhazinha] Falha ao abrir tela cheia.", error);
    toast("Não consegui colocar a transmissão em tela cheia.", "error");
  }
}

async function toggleStreamPictureInPicture(peerId) {
  const video = screenVideoElement(peerId);
  if (!video) return;
  try {
    if (document.pictureInPictureElement === video) { await document.exitPictureInPicture(); return; }
    if (!document.pictureInPictureEnabled || !video.requestPictureInPicture) { toast("Picture-in-Picture não está disponível nessa versão do Windows."); return; }
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    await video.play().catch(() => undefined);
    await video.requestPictureInPicture();
  } catch (_error) { toast("Não consegui abrir o Picture-in-Picture.", "error"); }
}

function updateScreenAudioControl() { applyAllScreenAudioStates(); }

function clearScreenStage(peerId) {
  if (peerId) {
    const entry = state.screenStreams.get(peerId);
    if (entry) { const video = document.querySelector(`[data-screen-video="${CSS.escape(peerId)}"]`); if (video) video.srcObject = null; }
    state.screenStreams.delete(peerId);
    disposeScreenAudioNode(peerId);
    if (state.focusedScreenPeerId === peerId) state.focusedScreenPeerId = state.screenStreams.keys().next().value || null;
  } else {
    document.querySelectorAll(".screen-stream-video").forEach((video) => { video.srcObject = null; });
    state.screenStreams.clear(); state.screenAudioNodes.forEach((_node, id) => disposeScreenAudioNode(id)); state.focusedScreenPeerId = null; state.screenLayout = "grid";
  }
  renderScreenStage();
}


function closeCallsForPeer(peerId) {
  state.voiceStats.delete(peerId);
  callSessions.closePeer(peerId);
  clearCameraStream(peerId);
  state.activeScreens.delete(peerId); state.activeScreen = state.activeScreens.values().next().value || null; clearScreenStage(peerId);
  removeRemoteAudio(peerId);
}

function closeAllMediaCalls() {
  callSessions.endSession("voice");
  callSessions.endSession("screen");
  callSessions.endSession("camera");
  callSessions.closeAll();
  state.voiceStats.clear();
  state.cameraStreams.forEach((stream) => stream.getTracks().forEach((track) => { try { track.stop(); } catch (_error) {} }));
  state.cameraStreams.clear();
  state.memberAudioNodes.forEach((_node, peerId) => disposeMemberAudioNode(peerId));
  state.screenAudioNodes.forEach((_node, peerId) => disposeScreenAudioNode(peerId));
  elements.audioContainer.replaceChildren();
  clearScreenStage();
}

function cleanupMedia() {
  stopFilteredAudioCapture();
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.screenStream?.getTracks().forEach((track) => track.stop());
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  state.screenStream = null;
  state.cameraStream = null;
  state.activeScreens.clear();
  state.screenStreams.clear();
  state.cameraStreams.clear();
  callSessions.closeAll();
  state.screenAudioSettings.clear();
  state.memberAudioNodes.forEach((_node, peerId) => disposeMemberAudioNode(peerId));
  state.screenAudioNodes.forEach((_node, peerId) => disposeScreenAudioNode(peerId));
  state.playbackAudioContext?.close?.().catch?.(() => undefined);
  state.playbackAudioContext = null;
  stopMicrophoneTest();
}

function teardownConnections() {
  stopConnectionHealthMonitor();
  stopAllSpeakingDetectors();
  state.activitySoundInitialized = false;
  window.clearTimeout(state.profileResyncTimer);
  state.profileResyncTimer = null;
  state.mediaReconcileTimers.forEach((timer) => window.clearTimeout(timer));
  state.mediaReconcileTimers.clear();
  state.lastVoicePeers = new Set();
  state.lastScreenPeers = new Set();
  window.clearTimeout(state.reconnectTimer); window.clearTimeout(state.persistenceTimer);
  cancelHostDisconnectGrace();
  stopConnectionHeartbeat();
  state.guestDisconnectTimers.forEach((timer) => window.clearTimeout(timer));
  state.guestDisconnectTimers.clear();
  try { window.resenhazinhaDesktop?.setVoiceActive?.(false); } catch (_error) {}
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
  const invite = currentInviteCode();
  try { if (window.resenhazinhaDesktop?.copyText) await window.resenhazinhaDesktop.copyText(invite); else await navigator.clipboard.writeText(invite); toast("Convite copiado."); }
  catch (_error) { toast(`Convite do servidor: ${invite}`); }
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


// v3.0.6 - menu do servidor estilo Discord + sair/excluir realmente visivel.
function currentServerNameV306() {
  return cleanServerName(state.server?.name || state.serverBinding?.serverName || elements.serverNameDisplay?.textContent || "Resenhazinha");
}

function isServerOwnerV306() {
  return Boolean(state.isHost || state.serverBinding?.isOwner);
}

function closeServerMenuV306() {
  const menu = document.getElementById("server-action-menu-v306");
  if (menu) menu.hidden = true;
  const titleCopy = document.querySelector(".server-title-copy");
  titleCopy?.classList.remove("is-open-v306");
  titleCopy?.setAttribute("aria-expanded", "false");
}

function showLeaveServerConfirmV306() {
  const serverName = currentServerNameV306();
  const ok = window.confirm(`Sair de ${serverName}?\n\nVoce podera entrar em outro servidor depois.`);
  if (ok) void leaveCurrentServerV306();
}

async function leaveCurrentServerV306() {
  if (isServerOwnerV306()) {
    openDeleteServerConfirmV306();
    return;
  }

  const serverName = currentServerNameV306();
  try {
    if (state.hostConnection?.open) {
      state.hostConnection.send({ type: "member-left-server-v306", clientId: state.clientId });
    }
  } catch (_error) {}

  clearServerBinding();
  sessionStorage.setItem("resenhazinha:server-action-notice", `Voce saiu de ${serverName}.`);
  state.roomEntered = false;
  teardownConnections();
  window.setTimeout(() => window.location.reload(), 80);
}

function closeDeleteServerConfirmV306() {
  const overlay = document.getElementById("server-delete-overlay-v306");
  if (!overlay) return;
  overlay.hidden = true;
  const input = document.getElementById("server-delete-name-v306");
  if (input) input.value = "";
  const confirmButton = document.getElementById("server-delete-confirm-v306");
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = "Excluir servidor";
  }
}

function openDeleteServerConfirmV306() {
  const overlay = document.getElementById("server-delete-overlay-v306");
  const input = document.getElementById("server-delete-name-v306");
  const expected = currentServerNameV306();
  const nameLabel = document.getElementById("server-delete-expected-v306");
  if (!overlay || !input) return;
  if (nameLabel) nameLabel.textContent = expected;
  input.value = "";
  input.dataset.expectedName = expected;
  const confirmButton = document.getElementById("server-delete-confirm-v306");
  if (confirmButton) confirmButton.disabled = true;
  overlay.hidden = false;
  closeServerMenuV306();
  window.setTimeout(() => input.focus(), 30);
}

async function deleteCurrentServerV306() {
  if (!isServerOwnerV306()) return;
  const serverName = currentServerNameV306();
  const input = document.getElementById("server-delete-name-v306");
  if (!input || input.value.trim() !== serverName) return;

  const confirmButton = document.getElementById("server-delete-confirm-v306");
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = "Excluindo...";
  }

  state.guestConnections.forEach((connection) => {
    try {
      if (connection?.open) connection.send({ type: "server-deleted-v306", serverName });
    } catch (_error) {}
  });

  window.clearTimeout(state.persistenceTimer);
  clearServerBinding();
  localStorage.removeItem(FALLBACK_SERVER_STATE_KEY);
  state.isHost = false;
  state.roomEntered = false;

  try { await window.resenhazinhaDesktop?.deleteServerState?.(); } catch (_error) {}

  sessionStorage.setItem("resenhazinha:server-action-notice", `O servidor ${serverName} foi excluido.`);
  teardownConnections();
  window.setTimeout(() => window.location.reload(), 100);
}

function refreshSavedServerActionV306() {
  const button = document.getElementById("saved-server-action-v306");
  if (!button) return;
  const binding = state.serverBinding;
  button.hidden = !binding;
  button.textContent = binding?.isOwner ? "Excluir servidor" : "Sair do servidor";
}

function setupServerMenuV306() {
  const titlebar = document.querySelector(".server-titlebar");
  const titleCopy = document.querySelector(".server-title-copy");
  if (titlebar && titleCopy && !document.getElementById("server-action-menu-v306")) {
    titleCopy.classList.add("server-title-menu-trigger-v306");
    titleCopy.setAttribute("role", "button");
    titleCopy.setAttribute("tabindex", "0");
    titleCopy.setAttribute("aria-haspopup", "menu");
    titleCopy.setAttribute("aria-expanded", "false");

    const chevron = document.createElement("span");
    chevron.className = "server-title-chevron-v306";
    chevron.textContent = "⌄";
    chevron.setAttribute("aria-hidden", "true");
    titleCopy.append(chevron);

    const menu = document.createElement("div");
    menu.id = "server-action-menu-v306";
    menu.className = "server-action-menu-v306";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "server-action-item-v306";
    settings.textContent = "Configurações do servidor";
    settings.addEventListener("click", () => {
      closeServerMenuV306();
      openServerSettings();
    });
    menu.append(settings);

    const danger = document.createElement("button");
    danger.type = "button";
    danger.className = "server-action-item-v306 server-action-item-danger-v306";
    danger.id = "server-leave-delete-v306";
    danger.addEventListener("click", () => {
      closeServerMenuV306();
      if (isServerOwnerV306()) openDeleteServerConfirmV306();
      else showLeaveServerConfirmV306();
    });
    menu.append(danger);
    titlebar.append(menu);

    const toggleMenu = (event) => {
      event?.stopPropagation?.();
      if (!menu.hidden) {
        closeServerMenuV306();
        return;
      }
      const owner = isServerOwnerV306();
      danger.textContent = owner ? "Excluir servidor" : "Sair do servidor";
      settings.hidden = !canCurrentUserAdmin();
      menu.hidden = false;
      titleCopy.classList.add("is-open-v306");
      titleCopy.setAttribute("aria-expanded", "true");
    };

    titleCopy.addEventListener("click", toggleMenu);
    titleCopy.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleMenu(event);
      } else if (event.key === "Escape") {
        closeServerMenuV306();
      }
    });
  }

  if (!document.getElementById("server-delete-overlay-v306")) {
    const overlay = document.createElement("div");
    overlay.id = "server-delete-overlay-v306";
    overlay.className = "server-delete-overlay-v306";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="server-delete-card-v306" role="dialog" aria-modal="true" aria-labelledby="server-delete-title-v306">
        <div class="server-delete-icon-v306">!</div>
        <h3 id="server-delete-title-v306">Excluir servidor?</h3>
        <p>Isso apaga o servidor deste PC e remove o vinculo dos membros que estiverem conectados.</p>
        <p class="server-delete-type-v306">Digite <strong id="server-delete-expected-v306"></strong> para confirmar.</p>
        <input id="server-delete-name-v306" autocomplete="off" spellcheck="false" placeholder="Nome do servidor" />
        <div class="server-delete-actions-v306">
          <button type="button" class="server-delete-cancel-v306" id="server-delete-cancel-v306">Cancelar</button>
          <button type="button" class="server-delete-danger-v306" id="server-delete-confirm-v306" disabled>Excluir servidor</button>
        </div>
      </div>`;
    document.body.append(overlay);

    const input = document.getElementById("server-delete-name-v306");
    const confirmButton = document.getElementById("server-delete-confirm-v306");
    input.addEventListener("input", () => {
      confirmButton.disabled = input.value.trim() !== String(input.dataset.expectedName || "");
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDeleteServerConfirmV306();
      if (event.key === "Enter" && !confirmButton.disabled) void deleteCurrentServerV306();
    });
    document.getElementById("server-delete-cancel-v306").addEventListener("click", closeDeleteServerConfirmV306);
    confirmButton.addEventListener("click", () => void deleteCurrentServerV306());
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeDeleteServerConfirmV306();
    });
  }

  const savedBanner = elements.savedServerBanner;
  if (savedBanner && !document.getElementById("saved-server-action-v306")) {
    const savedButton = document.createElement("button");
    savedButton.type = "button";
    savedButton.id = "saved-server-action-v306";
    savedButton.className = "saved-server-action-v306";
    savedButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.serverBinding?.isOwner) openDeleteServerConfirmV306();
      else showLeaveServerConfirmV306();
    });
    savedBanner.append(savedButton);
  }
  refreshSavedServerActionV306();

  document.addEventListener("click", (event) => {
    const menu = document.getElementById("server-action-menu-v306");
    if (!menu || menu.hidden) return;
    if (event.target.closest(".server-titlebar")) return;
    closeServerMenuV306();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeServerMenuV306();
      closeDeleteServerConfirmV306();
    }
  });
}

setupServerMenuV306();
