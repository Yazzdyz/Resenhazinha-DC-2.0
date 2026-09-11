const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, session, Notification, powerSaveBlocker } = require("electron");
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { promisify } = require("util");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

let mainWindow;
let voicePowerSaveBlockerId = null;
let pendingDesktopSourceId = null;
let filteredAudioCaptures = new Map();
let filteredAudioSender = null;
let filteredAudioRefreshTimer = null;
let filteredAudioExcludedProcessIds = new Set();
let allowedAudioProcessIds = new Set();
let protectedAudioProcessIds = new Set([process.pid]);
let audioProcessParents = new Map([[process.pid, process.ppid]]);
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const MAX_PROFILE_BANNER_BYTES = 8 * 1024 * 1024;
const MAX_APP_BACKGROUND_BYTES = 40 * 1024 * 1024;
const MAX_SERVER_STATE_BYTES = 2 * 1024 * 1024;
const MAX_CHAT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_MIXED_AUDIO_PROCESSES = 24;
const execFileAsync = promisify(execFile);
const UPDATE_REPOSITORY = "Yazzdyz/Resenhazinha-DC-2.0";
const UPDATE_ASSET_PATTERN = /Resenhazinha.*Windows\.zip$/i;

function stopFilteredAudioCapture() {
  if (filteredAudioRefreshTimer) {
    clearInterval(filteredAudioRefreshTimer);
    filteredAudioRefreshTimer = null;
  }
  filteredAudioExcludedProcessIds = new Set();
  const captures = [...filteredAudioCaptures.values()];
  filteredAudioCaptures = new Map();
  filteredAudioSender = null;
  captures.forEach((capture) => {
    try {
      capture.stop();
    } catch (_error) {
      // A captura pode já ter sido encerrada pelo Windows.
    }
  });
}

function filteredAudioAddonPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "loopback_capture_addon.node")
    : path.join(__dirname, "../node_modules/loopback-capture/build/Release/loopback_capture_addon.node");
}

async function resolveWindowProcessIds(sources) {
  const processIds = new Map();
  const ownSourceId = mainWindow?.getMediaSourceId();
  if (ownSourceId) processIds.set(ownSourceId, process.pid);
  if (process.platform !== "win32") return processIds;

  const windows = sources
    .map((source) => ({ source, match: /^window:(\d+):\d+$/.exec(source.id) }))
    .filter((item) => item.match);
  const handles = [...new Set(windows.map((item) => item.match[1]))];
  if (!handles.length) return processIds;

  const script = [
    "$signature = @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class ResenhazinhaWindowProcess {",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "}",
    "'@",
    "Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue",
    `$handles = @(${handles.map((handle) => `[Int64]${handle}`).join(",")})`,
    "$rows = foreach ($handle in $handles) {",
    "  [UInt32]$ownerProcess = 0",
    "  [void][ResenhazinhaWindowProcess]::GetWindowThreadProcessId([IntPtr]$handle, [ref]$ownerProcess)",
    "  [PSCustomObject]@{ handle = [string]$handle; processId = [Int64]$ownerProcess }",
    "}",
    "@($rows) | ConvertTo-Json -Compress",
  ].join("\n");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout || "[]");
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const byHandle = new Map(rows.map((row) => [String(row.handle), Number(row.processId)]));
    windows.forEach(({ source, match }) => {
      if (source.id === ownSourceId) return;
      const processId = byHandle.get(match[1]);
      if (Number.isInteger(processId) && processId > 0) processIds.set(source.id, processId);
    });
  } catch (_error) {
    // O Resenhazinha continua disponível mesmo se outros processos não forem identificados.
  }

  return processIds;
}

async function resolveProcessParents() {
  const processParents = new Map([[process.pid, process.ppid]]);
  if (process.platform !== "win32") return processParents;

  const script = [
    "$rows = Get-CimInstance Win32_Process | ForEach-Object {",
    "  [PSCustomObject]@{ processId = [Int64]$_.ProcessId; parentProcessId = [Int64]$_.ParentProcessId }",
    "}",
    "@($rows) | ConvertTo-Json -Compress",
  ].join("\n");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 5_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout || "[]");
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    rows.forEach((row) => {
      const processId = Number(row.processId);
      const parentProcessId = Number(row.parentProcessId);
      if (
        Number.isInteger(processId)
        && processId > 0
        && Number.isInteger(parentProcessId)
        && parentProcessId >= 0
      ) processParents.set(processId, parentProcessId);
    });
  } catch (_error) {
    // A relação direta com o processo que abriu o app ainda protege o caso mais comum.
  }

  processParents.set(process.pid, process.ppid);
  return processParents;
}

function isProcessAncestor(ancestorProcessId, descendantProcessId) {
  if (ancestorProcessId === descendantProcessId) return true;
  const visited = new Set();
  let currentProcessId = descendantProcessId;

  while (audioProcessParents.has(currentProcessId) && !visited.has(currentProcessId)) {
    visited.add(currentProcessId);
    currentProcessId = audioProcessParents.get(currentProcessId);
    if (currentProcessId === ancestorProcessId) return true;
    if (!Number.isInteger(currentProcessId) || currentProcessId <= 0) break;
  }
  return false;
}

function processTreesOverlap(firstProcessId, secondProcessId) {
  return isProcessAncestor(firstProcessId, secondProcessId)
    || isProcessAncestor(secondProcessId, firstProcessId);
}

function getProfilePath() {
  return path.join(app.getPath("userData"), "profile.json");
}

async function readProfile() {
  try {
    return JSON.parse(await fs.readFile(getProfilePath(), "utf8"));
  } catch (_error) {
    return {};
  }
}

async function writeProfile(profile) {
  const userDataPath = app.getPath("userData");
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(getProfilePath(), JSON.stringify(profile || {}), "utf8");
}

function getServerStatePath() {
  return path.join(app.getPath("userData"), "server-state.json");
}

async function readJsonFile(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); }
  catch (_error) { return null; }
}

function storedRoleCount(payload) {
  return Array.isArray(payload?.server?.roles) ? payload.server.roles.length : 0;
}

function mergeLegacyRolesIntoState(current, legacy) {
  if (!current || !legacy) return current || legacy || null;
  const currentRoom = String(current.roomCode || "").toUpperCase();
  const legacyRoom = String(legacy.roomCode || "").toUpperCase();
  if (!currentRoom || currentRoom !== legacyRoom) return current;

  const merged = { ...current, server: { ...(current.server || {}) } };
  const roleMap = new Map();
  const order = [];
  [legacy, current].forEach((candidate) => {
    (candidate.server?.roles || []).forEach((role) => {
      const id = String(role?.id || "").slice(0, 80);
      if (!id) return;
      if (!roleMap.has(id)) order.push(id);
      roleMap.set(id, role);
    });
  });
  merged.server.roles = order.map((id) => roleMap.get(id)).filter(Boolean).slice(0, 12);

  const memberMap = new Map();
  [...(legacy.members || []), ...(current.members || [])].forEach((member) => {
    const clientId = String(member?.clientId || "").trim();
    if (!clientId) return;
    const previous = memberMap.get(clientId) || {};
    memberMap.set(clientId, {
      ...previous,
      ...member,
      roleIds: [...new Set([...(previous.roleIds || []), ...(member.roleIds || [])].map(String))].slice(0, 12),
      lastSeenAt: Math.max(Number(previous.lastSeenAt) || 0, Number(member.lastSeenAt) || 0),
    });
  });
  if (memberMap.size) merged.members = [...memberMap.values()].slice(0, 100);
  return merged;
}

async function readServerState() {
  const currentPath = getServerStatePath();
  let current = await readJsonFile(currentPath);
  const backup = await readJsonFile(`${currentPath}.bak`);
  if (!current && backup) current = backup;
  else if (current && backup && storedRoleCount(backup) > storedRoleCount(current)) {
    current = mergeLegacyRolesIntoState(current, backup);
  }

  // Algumas builds antigas do Electron usaram uma pasta de userData com
  // capitalização/nome diferente. Se a build atual abriu só com os cargos
  // padrão, procuramos um server-state antigo e recuperamos os cargos.
  try {
    const appDataPath = app.getPath("appData");
    const currentDir = path.resolve(app.getPath("userData"));
    const entries = await fs.readdir(appDataPath, { withFileTypes: true });
    const legacyStates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/resenhazinha/i.test(entry.name)) continue;
      const directory = path.resolve(appDataPath, entry.name);
      if (directory === currentDir) continue;
      const candidate = await readJsonFile(path.join(directory, "server-state.json"));
      if (candidate) legacyStates.push(candidate);
    }

    if (!current && legacyStates.length) {
      current = legacyStates.sort((a, b) => {
        const roleDiff = storedRoleCount(b) - storedRoleCount(a);
        return roleDiff || (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0);
      })[0];
    } else if (current && storedRoleCount(current) <= 2) {
      const compatible = legacyStates
        .filter((candidate) => String(candidate.roomCode || "").toUpperCase() === String(current.roomCode || "").toUpperCase())
        .sort((a, b) => storedRoleCount(b) - storedRoleCount(a) || (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0));
      const richer = compatible.find((candidate) => storedRoleCount(candidate) > storedRoleCount(current));
      if (richer) current = mergeLegacyRolesIntoState(current, richer);
    }
  } catch (_error) {
    // Falhar ao procurar uma pasta antiga nunca impede o servidor atual de abrir.
  }
  return current;
}

async function writeServerState(payload) {
  const serialized = JSON.stringify(payload || {});
  if (Buffer.byteLength(serialized, "utf8") > MAX_SERVER_STATE_BYTES) return { saved: false, reason: "too-large" };
  const userDataPath = app.getPath("userData");
  await fs.mkdir(userDataPath, { recursive: true });
  const target = getServerStatePath();
  const temporary = `${target}.tmp`;
  const backup = `${target}.bak`;
  await fs.writeFile(temporary, serialized, "utf8");
  try {
    // Guardamos a última cópia válida antes de trocar o arquivo principal.
    if (fsSync.existsSync(target)) await fs.copyFile(target, backup).catch(() => undefined);
    await fs.rename(temporary, target);
  } catch (_error) {
    if (fsSync.existsSync(target)) await fs.copyFile(target, backup).catch(() => undefined);
    await fs.writeFile(target, serialized, "utf8");
    await fs.unlink(temporary).catch(() => undefined);
  }
  return { saved: true };
}

async function deleteServerStateV306() {
  const target = getServerStatePath();
  const candidates = [target, `${target}.bak`, `${target}.tmp`];
  await Promise.all(candidates.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
  return { deleted: true };
}

async function imageDataUrl(imagePath, maxBytes) {
  if (!imagePath) return null;
  try {
    const extension = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      ".gif": "image/gif",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    const mimeType = mimeTypes[extension];
    if (!mimeType) return null;
    const file = await fs.readFile(imagePath);
    if (file.length > maxBytes) return null;
    return `data:${mimeType};base64,${file.toString("base64")}`;
  } catch (_error) {
    return null;
  }
}

async function avatarDataUrl(avatarPath) {
  return imageDataUrl(avatarPath, MAX_AVATAR_BYTES);
}

async function bannerDataUrl(bannerPath) {
  return imageDataUrl(bannerPath, MAX_PROFILE_BANNER_BYTES);
}

function normalizeClientId(value) {
  const clientId = String(value || "").trim();
  return /^[a-z0-9-]{12,80}$/i.test(clientId) ? clientId : "";
}

function memberProfileDirectory(clientId) {
  return path.join(app.getPath("userData"), "member-profiles", normalizeClientId(clientId));
}

function memberProfileMetaPath(clientId) {
  return path.join(memberProfileDirectory(clientId), "profile.json");
}

async function readMemberProfileMeta(clientId) {
  const id = normalizeClientId(clientId);
  if (!id) return {};
  try {
    return JSON.parse(await fs.readFile(memberProfileMetaPath(id), "utf8"));
  } catch (_error) {
    return {};
  }
}

function parseImageDataUrl(value, maxBytes) {
  if (value === null) return { remove: true };
  if (typeof value !== "string") return null;
  const match = /^data:image\/(gif|png|jpe?g|webp);base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match) return null;
  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > maxBytes) return null;
  return { buffer, ext };
}

async function writeCachedMemberImage(clientId, kind, value, maxBytes, previousPath) {
  const parsed = parseImageDataUrl(value, maxBytes);
  if (!parsed) return previousPath || null;
  if (parsed.remove) {
    if (previousPath) await fs.unlink(previousPath).catch(() => undefined);
    return null;
  }
  const directory = memberProfileDirectory(clientId);
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${kind}.${parsed.ext}`);
  await fs.writeFile(target, parsed.buffer);
  if (previousPath && previousPath !== target) await fs.unlink(previousPath).catch(() => undefined);
  return target;
}

async function cacheMemberProfile(payload) {
  const clientId = normalizeClientId(payload?.clientId);
  if (!clientId) return { saved: false, reason: "invalid-client" };
  const previous = await readMemberProfileMeta(clientId);
  const next = { ...previous, clientId };
  if (Object.prototype.hasOwnProperty.call(payload || {}, "avatar")) {
    next.avatarPath = await writeCachedMemberImage(clientId, "avatar", payload.avatar, MAX_AVATAR_BYTES, previous.avatarPath);
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, "banner")) {
    next.bannerPath = await writeCachedMemberImage(clientId, "banner", payload.banner, MAX_PROFILE_BANNER_BYTES, previous.bannerPath);
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, "bio")) {
    next.bio = typeof payload.bio === "string" ? payload.bio.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, 190) : "";
  }
  next.updatedAt = Date.now();
  await fs.mkdir(memberProfileDirectory(clientId), { recursive: true });
  await fs.writeFile(memberProfileMetaPath(clientId), JSON.stringify(next), "utf8");
  return { saved: true };
}

async function loadMemberProfiles() {
  const root = path.join(app.getPath("userData"), "member-profiles");
  let entries = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (_error) { return []; }
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const clientId = normalizeClientId(entry.name);
    if (!clientId) continue;
    const meta = await readMemberProfileMeta(clientId);
    results.push({
      clientId,
      avatar: await avatarDataUrl(meta.avatarPath),
      banner: await bannerDataUrl(meta.bannerPath),
      bio: typeof meta.bio === "string" ? meta.bio.slice(0, 190) : "",
    });
  }
  return results;
}

async function deleteMemberProfile(clientId) {
  const id = normalizeClientId(clientId);
  if (!id) return { deleted: false };
  await fs.rm(memberProfileDirectory(id), { recursive: true, force: true }).catch(() => undefined);
  return { deleted: true };
}

async function backgroundPayload(backgroundPath) {
  if (!backgroundPath) return null;
  try {
    const extension = path.extname(backgroundPath).toLowerCase();
    const mimeTypes = {
      ".gif": "image/gif",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    const mimeType = mimeTypes[extension];
    if (!mimeType) return null;
    const bytes = await fs.readFile(backgroundPath);
    if (!bytes.length || bytes.length > MAX_APP_BACKGROUND_BYTES) return null;
    return { mimeType, bytes };
  } catch (_error) {
    return null;
  }
}

function normalizeBackgroundBlur(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(0, Math.min(30, Math.round(parsed)));
}

function normalizeBackgroundZoom(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(85, Math.min(160, Math.round(parsed / 5) * 5));
}

function normalizeFontScale(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(85, Math.min(130, Math.round(parsed / 5) * 5));
}

function normalizeTheme(value) {
  const theme = String(value || "");
  return ["light", "dark", "ultra-dark"].includes(theme) ? theme : "dark";
}

function normalizePresence(value) {
  const presence = String(value || "");
  return ["available", "away", "dnd", "offline"].includes(presence) ? presence : "available";
}


function getChatAttachmentsDirectory() {
  return path.join(app.getPath("userData"), "chat-attachments");
}

function normalizeAttachmentId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9-]{12,100}$/i.test(id) ? id : "";
}

async function saveChatAttachment(payload) {
  const id = normalizeAttachmentId(payload?.id);
  if (!id) return { saved: false, reason: "invalid-id" };
  const raw = payload?.bytes;
  let buffer = null;
  if (Buffer.isBuffer(raw)) buffer = raw;
  else if (raw instanceof Uint8Array) buffer = Buffer.from(raw);
  else if (raw instanceof ArrayBuffer) buffer = Buffer.from(new Uint8Array(raw));
  else if (ArrayBuffer.isView(raw)) buffer = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (!buffer || buffer.length > MAX_CHAT_ATTACHMENT_BYTES) return { saved: false, reason: "too-large" };
  const directory = getChatAttachmentsDirectory();
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, id), buffer);
  return { saved: true, size: buffer.length };
}

async function readChatAttachment(attachmentId) {
  const id = normalizeAttachmentId(attachmentId);
  if (!id) return { found: false };
  try {
    const file = await fs.readFile(path.join(getChatAttachmentsDirectory(), id));
    if (file.length > MAX_CHAT_ATTACHMENT_BYTES) return { found: false };
    return { found: true, bytes: file };
  } catch (_error) {
    return { found: false };
  }
}

async function deleteChatAttachment(attachmentId) {
  const id = normalizeAttachmentId(attachmentId);
  if (!id) return { deleted: false };
  await fs.unlink(path.join(getChatAttachmentsDirectory(), id)).catch(() => undefined);
  return { deleted: true };
}

function parseVersionParts(value) {
  return String(value || "").replace(/^v/i, "").split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function isVersionNewer(candidate, current) {
  const a = parseVersionParts(candidate);
  const b = parseVersionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return true;
    if ((a[index] || 0) < (b[index] || 0)) return false;
  }
  return false;
}

async function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fsSync.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function downloadUpdateAsset(url, destination, expectedDigest = "") {
  const response = await fetch(url, {
    headers: { "User-Agent": "Resenhazinha-Updater", Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`download-${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > 500 * 1024 * 1024) throw new Error("invalid-update-size");
  if (!response.body) throw new Error("empty-update-body");

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(destination));

  const stats = await fs.stat(destination);
  if (!stats.size || stats.size > 500 * 1024 * 1024) {
    await fs.unlink(destination).catch(() => undefined);
    throw new Error("invalid-update-size");
  }

  const digest = String(expectedDigest || "").trim().toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/.test(digest)) {
    const actual = await fileSha256(destination);
    if (`sha256:${actual}` !== digest) {
      await fs.unlink(destination).catch(() => undefined);
      throw new Error("update-checksum-mismatch");
    }
  }
}

async function launchPortableUpdater(zipPath) {
  if (process.platform !== "win32" || !app.isPackaged) return false;
  const installDirectory = path.dirname(process.execPath);
  const currentExe = process.execPath;
  const updateRoot = path.join(app.getPath("temp"), `resenhazinha-update-${Date.now()}`);
  const extractDirectory = path.join(updateRoot, "extract");
  const scriptPath = path.join(updateRoot, "update.ps1");
  await fs.mkdir(updateRoot, { recursive: true });
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    `$pidToWait = ${process.pid}`,
    `$zip = ${JSON.stringify(zipPath)}`,
    `$extract = ${JSON.stringify(extractDirectory)}`,
    `$target = ${JSON.stringify(installDirectory)}`,
    `$exeName = ${JSON.stringify(path.basename(currentExe))}`,
    "while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 350 }",
    "if (Test-Path $extract) { Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue }",
    "New-Item -ItemType Directory -Path $extract -Force | Out-Null",
    "Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force",
    "$newExe = Get-ChildItem -Path $extract -Filter $exeName -File -Recurse | Select-Object -First 1",
    "if (-not $newExe) { throw 'Resenhazinha.exe não encontrado no pacote de atualização.' }",
    "$source = Split-Path -Parent $newExe.FullName",
    "Get-ChildItem -Path $source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force }",
    "$installedExe = Join-Path $target $exeName",
    "Start-Process -FilePath $installedExe",
    "Start-Sleep -Seconds 2",
    "Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue",
    "Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue",
  ].join("\r\n");
  await fs.writeFile(scriptPath, ps, "utf8");
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  app.quit();
  return true;
}

async function checkForPortableUpdate(options = {}) {
  const manual = Boolean(options?.manual);
  if (!app.isPackaged || process.platform !== "win32") return { ok: false, reason: "not-packaged" };
  try {
    const response = await fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`, {
      headers: { "User-Agent": "Resenhazinha-Updater", Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return { ok: false, reason: `github-${response.status}` };
    const release = await response.json();
    const latestVersion = String(release?.tag_name || release?.name || "").replace(/^v/i, "");
    if (!latestVersion || !isVersionNewer(latestVersion, app.getVersion())) {
      if (manual && mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, { type: "info", title: "Resenhazinha atualizado", message: `Você já está na versão mais recente (${app.getVersion()}).`, buttons: ["Fechar"], noLink: true });
      }
      return { ok: true, updateAvailable: false, currentVersion: app.getVersion(), latestVersion: latestVersion || app.getVersion() };
    }
    const asset = Array.isArray(release?.assets) ? release.assets.find((item) => UPDATE_ASSET_PATTERN.test(String(item?.name || ""))) : null;
    if (!asset?.browser_download_url) return { ok: false, reason: "asset-not-found", latestVersion };
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Atualização do Resenhazinha",
      message: `Resenhazinha ${latestVersion} está disponível`,
      detail: "Quer baixar e instalar agora? O app vai fechar, atualizar e abrir novamente sozinho.",
      buttons: ["Atualizar agora", "Depois"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response !== 0) return { ok: true, updateAvailable: true, deferred: true, latestVersion };
    const updateDirectory = path.join(app.getPath("temp"), "resenhazinha-updates");
    await fs.mkdir(updateDirectory, { recursive: true });
    const zipPath = path.join(updateDirectory, `Resenhazinha-${latestVersion}.zip`);
    await downloadUpdateAsset(asset.browser_download_url, zipPath, asset.digest);
    await launchPortableUpdater(zipPath);
    return { ok: true, updateAvailable: true, installing: true, latestVersion };
  } catch (error) {
    if (manual && mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, { type: "error", title: "Atualização", message: "Não consegui verificar ou instalar a atualização agora.", detail: String(error?.message || error || "Erro desconhecido"), buttons: ["Fechar"], noLink: true });
    }
    return { ok: false, reason: String(error?.message || "update-failed") };
  }
}

function setVoicePowerSave(active) {
  if (active) {
    if (voicePowerSaveBlockerId == null || !powerSaveBlocker.isStarted(voicePowerSaveBlockerId)) {
      voicePowerSaveBlockerId = powerSaveBlocker.start("prevent-display-sleep");
    }
    return;
  }
  if (voicePowerSaveBlockerId != null && powerSaveBlocker.isStarted(voicePowerSaveBlockerId)) powerSaveBlocker.stop(voicePowerSaveBlockerId);
  voicePowerSaveBlockerId = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "Resenhazinha",
    autoHideMenuBar: true,
    frame: false,
    show: false,
    icon: path.join(__dirname, "../public/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow.isMaximized()) mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on("closed", () => { stopFilteredAudioCapture(); setVoicePowerSave(false); });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (url !== currentUrl) event.preventDefault();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media" || permission === "display-capture";
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });

  ipcMain.on("resenhazinha:select-screen-source", (event, sourceId) => {
    pendingDesktopSourceId = typeof sourceId === "string" && /^(screen|window):/.test(sourceId)
      ? sourceId
      : null;
    event.returnValue = Boolean(pendingDesktopSourceId);
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const requestedSourceId = pendingDesktopSourceId;
    pendingDesktopSourceId = null;

    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      const source = sources.find((item) => item.id === requestedSourceId);
      if (!source) {
        callback({});
        return;
      }

      // O mixer por aplicativo é a rota principal. O loopback nativo fica
      // disponível como fallback quando o addon não consegue capturar áudio.
      callback({ video: source, ...(request.audioRequested ? { audio: "loopback" } : {}) });
    } catch (_error) {
      callback({});
    }
  });

  ipcMain.handle("resenhazinha:list-screen-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });

    const [processIds, processParents] = await Promise.all([
      resolveWindowProcessIds(sources),
      resolveProcessParents(),
    ]);
    audioProcessParents = processParents;
    allowedAudioProcessIds = new Set([process.pid, ...processIds.values()]);
    const ownSourceId = mainWindow?.getMediaSourceId();
    protectedAudioProcessIds = new Set([process.pid]);
    const ownSourceProcessId = ownSourceId ? processIds.get(ownSourceId) : null;
    if (ownSourceProcessId) protectedAudioProcessIds.add(ownSourceProcessId);

    return sources.map((source) => {
      const processId = processIds.get(source.id) || null;
      return {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
        processId,
        canMuteAudio: Boolean(processId),
        isOwnApp: source.id === ownSourceId || processId === process.pid,
      };
    });
  });

  ipcMain.handle("resenhazinha:start-filtered-audio", async (event, excludedProcessIds) => {
    if (process.platform !== "win32") return { ok: false, reason: "unsupported-platform" };

    const requestedExclusions = Array.isArray(excludedProcessIds)
      ? excludedProcessIds.map(Number).filter((processId) => Number.isInteger(processId) && processId > 0)
      : excludedProcessIds == null ? [] : [Number(excludedProcessIds)].filter((processId) => Number.isInteger(processId) && processId > 0);

    const sender = event.sender;
    stopFilteredAudioCapture();
    filteredAudioSender = sender;
    filteredAudioExcludedProcessIds = new Set(requestedExclusions);

    try {
      const { LoopbackCapture } = require(filteredAudioAddonPath());

      // Caminho principal: o WASAPI captura o sistema inteiro EXCETO a árvore
      // do Resenhazinha. Isso mantém a call fora do compartilhamento e, por ser
      // uma captura contínua do sistema, aplicativos abertos depois entram no
      // áudio automaticamente sem reiniciar a transmissão.
      if (requestedExclusions.length === 0) {
        const capture = new LoopbackCapture();
        capture.start(process.pid, false, (chunk) => {
          if (
            filteredAudioCaptures.get("system-except-resenhazinha") !== capture
            || filteredAudioSender !== sender
            || sender.isDestroyed()
          ) return;
          sender.send("resenhazinha:filtered-audio-chunk", {
            processId: "system-except-resenhazinha",
            chunk,
          });
        });
        filteredAudioCaptures.set("system-except-resenhazinha", capture);
        return {
          ok: true,
          mode: "system-except-resenhazinha",
          sampleRate: 48_000,
          channels: 2,
          format: "s16le",
          capturedProcessIds: ["system-except-resenhazinha"],
          failedProcessIds: [],
        };
      }

      // Se a pessoa escolheu silenciar aplicativos extras, preservamos o mixer
      // seletivo por processo. Ele é reavaliado enquanto a transmissão estiver
      // ativa para incluir aplicativos que surgirem depois.
      const syncFilteredAudioCaptures = async () => {
        if (!filteredAudioSender || filteredAudioSender.isDestroyed()) {
          stopFilteredAudioCapture();
          return { capturedProcessIds: [] };
        }

        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 1, height: 1 },
          fetchWindowIcons: false,
        });
        const [processIds, processParents] = await Promise.all([
          resolveWindowProcessIds(sources),
          resolveProcessParents(),
        ]);
        audioProcessParents = processParents;
        allowedAudioProcessIds = new Set([process.pid, ...processIds.values()]);

        const ownSourceId = mainWindow?.getMediaSourceId();
        protectedAudioProcessIds = new Set([process.pid]);
        const ownSourceProcessId = ownSourceId ? processIds.get(ownSourceId) : null;
        if (ownSourceProcessId) protectedAudioProcessIds.add(ownSourceProcessId);

        const excluded = new Set([
          ...protectedAudioProcessIds,
          ...filteredAudioExcludedProcessIds,
        ]);
        const captureCandidates = [...allowedAudioProcessIds]
          .filter((processId) => ![...excluded].some((excludedProcessId) => processTreesOverlap(processId, excludedProcessId)));
        const includedProcessIds = captureCandidates
          .filter((processId) => !captureCandidates.some((otherProcessId) => (
            otherProcessId !== processId && isProcessAncestor(otherProcessId, processId)
          )))
          .slice(0, MAX_MIXED_AUDIO_PROCESSES);
        const includedSet = new Set(includedProcessIds);

        for (const [processId, capture] of [...filteredAudioCaptures.entries()]) {
          if (includedSet.has(processId)) continue;
          filteredAudioCaptures.delete(processId);
          try { capture.stop(); } catch (_error) {}
        }

        const failedProcessIds = [];
        for (const processId of includedProcessIds) {
          if (filteredAudioCaptures.has(processId)) continue;
          const capture = new LoopbackCapture();
          try {
            capture.start(processId, true, (chunk) => {
              if (
                filteredAudioCaptures.get(processId) !== capture
                || filteredAudioSender !== sender
                || sender.isDestroyed()
              ) return;
              sender.send("resenhazinha:filtered-audio-chunk", { processId, chunk });
            });
            filteredAudioCaptures.set(processId, capture);
          } catch (_error) {
            failedProcessIds.push(processId);
          }
        }

        return {
          capturedProcessIds: [...filteredAudioCaptures.keys()],
          failedProcessIds,
        };
      };

      const first = await syncFilteredAudioCaptures();
      if (!first.capturedProcessIds.length) {
        stopFilteredAudioCapture();
        return { ok: false, reason: "no-audio-apps" };
      }

      filteredAudioRefreshTimer = setInterval(() => {
        syncFilteredAudioCaptures().catch(() => undefined);
      }, 1500);

      return {
        ok: true,
        mode: "dynamic-application-allow-list",
        sampleRate: 48_000,
        channels: 2,
        format: "s16le",
        capturedProcessIds: first.capturedProcessIds,
        failedProcessIds: first.failedProcessIds,
      };
    } catch (_error) {
      stopFilteredAudioCapture();
      return { ok: false, reason: "capture-unavailable" };
    }
  });

  ipcMain.handle("resenhazinha:stop-filtered-audio", () => {
    stopFilteredAudioCapture();
    return { stopped: true };
  });

  ipcMain.handle("resenhazinha:search-gifs", async (_event, rawQuery) => {
    const query = String(rawQuery || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const term = query || "";
    const slug = encodeURIComponent(term.toLocaleLowerCase("pt-BR").replace(/\s+/g, "-"));
    const url = term ? `https://tenor.com/search/${slug}-gifs` : "https://tenor.com/search/trending-gifs";

    try {
      const response = await fetch(url, {
        headers: {
          "accept": "text/html,application/xhtml+xml",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.7",
          "user-agent": "Mozilla/5.0 Resenhazinha/5.1",
        },
        redirect: "follow",
      });
      if (!response.ok) return { ok: false, reason: "provider-unavailable", results: [] };
      let html = await response.text();
      html = html
        .replaceAll("\\u002F", "/")
        .replaceAll("\\u0026", "&")
        .replaceAll("\\/", "/")
        .replaceAll("&amp;", "&");

      const matches = html.match(/https:\/\/media\.tenor\.com\/[^"'<>\\\s]+?\.(?:gif|webp)(?:\?[^"'<>\\\s]*)?/gi) || [];
      const seen = new Set();
      const results = [];
      for (const rawUrl of matches) {
        let mediaUrl = String(rawUrl).replace(/[),.;]+$/, "");
        if (!/^https:\/\/media\.tenor\.com\//i.test(mediaUrl) || seen.has(mediaUrl)) continue;
        seen.add(mediaUrl);
        results.push({
          id: crypto.createHash("sha1").update(mediaUrl).digest("hex").slice(0, 16),
          url: mediaUrl,
          previewUrl: mediaUrl,
          title: query || "GIF em destaque",
        });
        if (results.length >= 36) break;
      }
      return { ok: results.length > 0, provider: "Tenor", query, results };
    } catch (_error) {
      return { ok: false, reason: "provider-unavailable", results: [] };
    }
  });

  ipcMain.on("resenhazinha:voice-active", (_event, active) => {
    setVoicePowerSave(Boolean(active));
  });

  ipcMain.handle("resenhazinha:copy", (_event, text) => {
    clipboard.writeText(String(text));
    return true;
  });

  ipcMain.handle("resenhazinha:set-window-fullscreen", (_event, enabled) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const target = Boolean(enabled);
    mainWindow.setFullScreen(target);
    return target;
  });

  ipcMain.handle("resenhazinha:window-action", (_event, action) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { maximized: false };

    if (action === "minimize") {
      mainWindow.minimize();
    } else if (action === "toggle-maximize") {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (action === "close") {
      mainWindow.close();
    }

    return { maximized: mainWindow.isMaximized(), fullscreen: mainWindow.isFullScreen() };
  });

  ipcMain.handle("resenhazinha:get-window-state", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { maximized: false, fullscreen: false };
    return { maximized: mainWindow.isMaximized(), fullscreen: mainWindow.isFullScreen() };
  });

  const sendWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("resenhazinha:window-state", {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    });
  };

  ipcMain.handle("resenhazinha:app-info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    installDirectory: path.dirname(process.execPath),
  }));

  ipcMain.handle("resenhazinha:check-update", async () => checkForPortableUpdate({ manual: true }));

  ipcMain.handle("resenhazinha:notify", (_event, payload) => {
    if (!Notification.isSupported()) return { shown: false, reason: "unsupported" };
    const title = String(payload?.title || "Resenhazinha").slice(0, 80);
    const body = String(payload?.body || "").slice(0, 240);
    const notification = new Notification({ title, body, icon: path.join(__dirname, "../public/icon.png"), silent: Boolean(payload?.silent) });
    notification.on("click", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("resenhazinha:notification-click", { messageId: String(payload?.messageId || "") });
    });
    notification.show();
    return { shown: true };
  });

  ipcMain.handle("resenhazinha:load-profile", async () => {
    const profile = await readProfile();
    return {
      avatar: await avatarDataUrl(profile.avatarPath),
      banner: await bannerDataUrl(profile.bannerPath),
      bio: typeof profile.bio === "string" ? profile.bio.slice(0, 190) : "",
      background: await backgroundPayload(profile.backgroundPath),
      backgroundBlur: normalizeBackgroundBlur(profile.backgroundBlur),
      backgroundZoom: normalizeBackgroundZoom(profile.backgroundZoom),
      fontScale: normalizeFontScale(profile.fontScale),
      theme: normalizeTheme(profile.theme),
      presence: normalizePresence(profile.presence),
    };
  });

  ipcMain.handle("resenhazinha:save-profile-text", async (_event, payload) => {
    const profile = await readProfile();
    const bio = typeof payload?.bio === "string" ? payload.bio.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, 190) : "";
    const backgroundBlur = normalizeBackgroundBlur(payload?.backgroundBlur ?? profile.backgroundBlur);
    const backgroundZoom = normalizeBackgroundZoom(payload?.backgroundZoom ?? profile.backgroundZoom);
    const fontScale = normalizeFontScale(payload?.fontScale ?? profile.fontScale);
    const theme = normalizeTheme(payload?.theme ?? profile.theme);
    const presence = normalizePresence(payload?.presence ?? profile.presence);
    await writeProfile({ ...profile, bio, backgroundBlur, backgroundZoom, fontScale, theme, presence });
    return { saved: true, bio, backgroundBlur, backgroundZoom, fontScale, theme, presence };
  });

  ipcMain.handle("resenhazinha:cache-member-profile", async (_event, payload) => {
    try { return await cacheMemberProfile(payload); }
    catch (_error) { return { saved: false, reason: "write-failed" }; }
  });

  ipcMain.handle("resenhazinha:load-member-profiles", async () => {
    try { return await loadMemberProfiles(); }
    catch (_error) { return []; }
  });

  ipcMain.handle("resenhazinha:delete-member-profile", async (_event, clientId) => {
    try { return await deleteMemberProfile(clientId); }
    catch (_error) { return { deleted: false }; }
  });

  ipcMain.handle("resenhazinha:load-server-state", async () => readServerState());

  ipcMain.handle("resenhazinha:save-server-state", async (_event, payload) => {
    try {
      return await writeServerState(payload);
    } catch (_error) {
      return { saved: false, reason: "write-failed" };
    }
  });

  ipcMain.handle("resenhazinha:delete-server-state", async () => {
    try {
      return await deleteServerStateV306();
    } catch (_error) {
      return { deleted: false };
    }
  });

  ipcMain.handle("resenhazinha:save-chat-attachment", async (_event, payload) => {
    try {
      return await saveChatAttachment(payload);
    } catch (_error) {
      return { saved: false, reason: "write-failed" };
    }
  });

  ipcMain.handle("resenhazinha:read-chat-attachment", async (_event, attachmentId) => {
    try {
      return await readChatAttachment(attachmentId);
    } catch (_error) {
      return { found: false };
    }
  });

  ipcMain.handle("resenhazinha:delete-chat-attachment", async (_event, attachmentId) => {
    try {
      return await deleteChatAttachment(attachmentId);
    } catch (_error) {
      return { deleted: false };
    }
  });

  ipcMain.handle("resenhazinha:choose-avatar", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Escolher foto ou GIF",
      properties: ["openFile"],
      filters: [
        { name: "Imagens e GIFs", extensions: ["gif", "png", "jpg", "jpeg", "webp"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    const sourcePath = result.filePaths[0];
    const stats = await fs.stat(sourcePath);
    if (stats.size > MAX_AVATAR_BYTES) {
      return { error: "too-large", maxBytes: MAX_AVATAR_BYTES };
    }

    const extension = path.extname(sourcePath).toLowerCase();
    const userDataPath = app.getPath("userData");
    const previousProfile = await readProfile();
    await fs.mkdir(userDataPath, { recursive: true });
    const avatarPath = path.join(userDataPath, `profile-avatar-${Date.now()}${extension}`);
    await fs.copyFile(sourcePath, avatarPath);
    await writeProfile({ ...previousProfile, avatarPath });
    if (previousProfile.avatarPath && path.dirname(previousProfile.avatarPath) === userDataPath) {
      await fs.unlink(previousProfile.avatarPath).catch(() => undefined);
    }
    return { avatar: await avatarDataUrl(avatarPath) };
  });

  ipcMain.handle("resenhazinha:choose-profile-banner", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Escolher banner do perfil",
      properties: ["openFile"],
      filters: [
        { name: "Imagens e GIFs", extensions: ["gif", "png", "jpg", "jpeg", "webp"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    const sourcePath = result.filePaths[0];
    const stats = await fs.stat(sourcePath);
    if (stats.size > MAX_PROFILE_BANNER_BYTES) {
      return { error: "too-large", maxBytes: MAX_PROFILE_BANNER_BYTES };
    }

    const extension = path.extname(sourcePath).toLowerCase();
    const userDataPath = app.getPath("userData");
    const previousProfile = await readProfile();
    await fs.mkdir(userDataPath, { recursive: true });
    const bannerPath = path.join(userDataPath, `profile-banner-${Date.now()}${extension}`);
    await fs.copyFile(sourcePath, bannerPath);
    await writeProfile({ ...previousProfile, bannerPath });
    if (previousProfile.bannerPath && path.dirname(previousProfile.bannerPath) === userDataPath) {
      await fs.unlink(previousProfile.bannerPath).catch(() => undefined);
    }
    return { banner: await bannerDataUrl(bannerPath) };
  });

  ipcMain.handle("resenhazinha:choose-app-background", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Escolher fundo do Resenhazinha",
      properties: ["openFile"],
      filters: [
        { name: "GIFs e imagens", extensions: ["gif", "png", "jpg", "jpeg", "webp"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    const sourcePath = result.filePaths[0];
    const stats = await fs.stat(sourcePath);
    if (stats.size > MAX_APP_BACKGROUND_BYTES) {
      return { error: "too-large", maxBytes: MAX_APP_BACKGROUND_BYTES };
    }

    const extension = path.extname(sourcePath).toLowerCase();
    const userDataPath = app.getPath("userData");
    const previousProfile = await readProfile();
    await fs.mkdir(userDataPath, { recursive: true });
    const backgroundPath = path.join(userDataPath, `app-background-${Date.now()}${extension}`);
    await fs.copyFile(sourcePath, backgroundPath);
    const backgroundBlur = normalizeBackgroundBlur(previousProfile.backgroundBlur);
    await writeProfile({ ...previousProfile, backgroundPath, backgroundBlur });
    if (previousProfile.backgroundPath && path.dirname(previousProfile.backgroundPath) === userDataPath) {
      await fs.unlink(previousProfile.backgroundPath).catch(() => undefined);
    }
    return { background: await backgroundPayload(backgroundPath), backgroundBlur };
  });

  ipcMain.handle("resenhazinha:choose-server-icon", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Escolher foto do servidor",
      properties: ["openFile"],
      filters: [{ name: "Imagens", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      const image = nativeImage.createFromPath(result.filePaths[0]);
      if (image.isEmpty()) return { error: "invalid-image" };
      const originalSize = image.getSize();
      const maxSide = Math.max(originalSize.width, originalSize.height, 1);
      const scale = Math.min(1, 192 / maxSide);
      const targetWidth = Math.max(1, Math.round(originalSize.width * scale));
      const targetHeight = Math.max(1, Math.round(originalSize.height * scale));
      let resized = image.resize({ width: targetWidth, height: targetHeight, quality: "best" });
      let buffer = resized.toPNG();
      if (buffer.length > 240_000) {
        const smallerScale = Math.min(1, 128 / maxSide);
        resized = image.resize({ width: Math.max(1, Math.round(originalSize.width * smallerScale)), height: Math.max(1, Math.round(originalSize.height * smallerScale)), quality: "good" });
        buffer = resized.toPNG();
      }
      if (buffer.length > 280_000) return { error: "too-large" };
      return { icon: `data:image/png;base64,${buffer.toString("base64")}` };
    } catch (_error) {
      return { error: "invalid-image" };
    }
  });

  ipcMain.handle("resenhazinha:remove-app-background", async () => {
    const userDataPath = app.getPath("userData");
    const profile = await readProfile();
    await fs.mkdir(userDataPath, { recursive: true });
    await writeProfile({ ...profile, backgroundPath: null });
    if (profile.backgroundPath && path.dirname(profile.backgroundPath) === userDataPath) {
      await fs.unlink(profile.backgroundPath).catch(() => undefined);
    }
    return { removed: true };
  });

  ipcMain.handle("resenhazinha:remove-profile-banner", async () => {
    const userDataPath = app.getPath("userData");
    const profile = await readProfile();
    await fs.mkdir(userDataPath, { recursive: true });
    await writeProfile({ ...profile, bannerPath: null });
    if (profile.bannerPath && path.dirname(profile.bannerPath) === userDataPath) {
      await fs.unlink(profile.bannerPath).catch(() => undefined);
    }
    return { removed: true };
  });

  ipcMain.handle("resenhazinha:remove-avatar", async () => {
    const userDataPath = app.getPath("userData");
    const profile = await readProfile();
    await fs.mkdir(userDataPath, { recursive: true });
    await writeProfile({ ...profile, avatarPath: null });
    if (profile.avatarPath && path.dirname(profile.avatarPath) === userDataPath) {
      await fs.unlink(profile.avatarPath).catch(() => undefined);
    }
    return { removed: true };
  });

  createWindow();
  setTimeout(() => { void checkForPortableUpdate(); }, 4500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopFilteredAudioCapture);
