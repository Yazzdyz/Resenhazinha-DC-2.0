const { app, BrowserWindow, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");

let updatePromptOpen = false;
let updateAccepted = false;

function getMainWindow() {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || undefined;
}

function showUpdaterError(error) {
  console.error("[Resenhazinha updater]", error);
}

function setupAutoUpdater() {
  if (!app.isPackaged || process.platform !== "win32") return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("error", showUpdaterError);

  autoUpdater.on("update-available", async (info) => {
    if (updatePromptOpen || updateAccepted) return;
    updatePromptOpen = true;

    try {
      const version = String(info?.version || "nova versão");
      const choice = await dialog.showMessageBox(getMainWindow(), {
        type: "info",
        title: "Atualização do Resenhazinha",
        message: `Resenhazinha ${version} está disponível`,
        detail: "Clique em Atualizar agora. O Resenhazinha vai baixar a atualização, fechar, instalar e abrir novamente sozinho.",
        buttons: ["Atualizar agora", "Depois"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (choice.response !== 0) return;
      updateAccepted = true;
      await autoUpdater.downloadUpdate();
    } catch (error) {
      updateAccepted = false;
      showUpdaterError(error);
      await dialog.showMessageBox(getMainWindow(), {
        type: "error",
        title: "Atualização do Resenhazinha",
        message: "Não foi possível baixar a atualização.",
        detail: "O Resenhazinha continua funcionando normalmente. Tente novamente quando abrir o app de novo.",
        buttons: ["OK"],
      }).catch(() => undefined);
    } finally {
      updatePromptOpen = false;
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    const window = getMainWindow();
    if (!window) return;
    const percent = Number(progress?.percent || 0);
    window.setProgressBar(Math.max(0, Math.min(1, percent / 100)));
  });

  autoUpdater.on("update-downloaded", () => {
    const window = getMainWindow();
    if (window) window.setProgressBar(-1);

    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 600);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(showUpdaterError);
  }, 4500);
}

app.whenReady().then(setupAutoUpdater);

require("./main.cjs");
