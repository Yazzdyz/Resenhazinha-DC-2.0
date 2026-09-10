from pathlib import Path

main_path = Path("electron/main.cjs")
preload_path = Path("electron/preload.cjs")
index_path = Path("index.html")

main = main_path.read_text(encoding="utf-8")
preload = preload_path.read_text(encoding="utf-8")
index = index_path.read_text(encoding="utf-8")

old_titlebar = '''    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#050506",
      symbolColor: "#b5bac1",
      height: 32,
    },
'''
if old_titlebar in main:
    main = main.replace(old_titlebar, '    frame: false,\n', 1)
elif "    frame: false,\n" not in main:
    raise SystemExit("v4.2.6: não encontrei titleBarOverlay da v4.2.5")

ipc_anchor = '''  ipcMain.handle("resenhazinha:set-window-fullscreen", (_event, enabled) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const target = Boolean(enabled);
    mainWindow.setFullScreen(target);
    return target;
  });
'''
ipc_block = ipc_anchor + '''
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
  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);
  mainWindow.on("enter-full-screen", sendWindowState);
  mainWindow.on("leave-full-screen", sendWindowState);
'''
if 'resenhazinha:window-action' not in main:
    if ipc_anchor not in main:
        raise SystemExit("v4.2.6: não encontrei IPC de fullscreen da v4.2.3")
    main = main.replace(ipc_anchor, ipc_block, 1)

preload_anchor = '  setWindowFullscreen: (enabled) => ipcRenderer.invoke("resenhazinha:set-window-fullscreen", Boolean(enabled)),\n'
preload_extra = preload_anchor + '''  windowAction: (action) => ipcRenderer.invoke("resenhazinha:window-action", action),
  getWindowState: () => ipcRenderer.invoke("resenhazinha:get-window-state"),
  onWindowState: (callback) => {
    ipcRenderer.removeAllListeners("resenhazinha:window-state");
    ipcRenderer.on("resenhazinha:window-state", (_event, state) => callback(state));
  },
'''
if 'windowAction: (action)' not in preload:
    if preload_anchor not in preload:
        raise SystemExit("v4.2.6: não encontrei bridge de fullscreen da v4.2.3")
    preload = preload.replace(preload_anchor, preload_extra, 1)

module = '    <script type="module" src="/src/v4.2.6.js"></script>\n'
if "/src/v4.2.6.js" not in index:
    if "  </body>" not in index:
        raise SystemExit("v4.2.6: não encontrei </body>")
    index = index.replace("  </body>", module + "  </body>", 1)

main_path.write_text(main, encoding="utf-8")
preload_path.write_text(preload, encoding="utf-8")
index_path.write_text(index, encoding="utf-8")
print("v4.2.6 aplicada: titlebar compacta frameless com controles próprios")
