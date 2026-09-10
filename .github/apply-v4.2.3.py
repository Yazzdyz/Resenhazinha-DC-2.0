from pathlib import Path

main_path = Path("electron/main.cjs")
preload_path = Path("electron/preload.cjs")
renderer_path = Path("src/v4.2.2.js")

main = main_path.read_text(encoding="utf-8")
preload = preload_path.read_text(encoding="utf-8")
renderer = renderer_path.read_text(encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"v4.2.3: anchor {label!r} count={count}")
    return text.replace(old, new, 1)


# O app passa a abrir maximizado, como o Discord, mas ainda em modo janela normal.
main = replace_once(
    main,
    '  mainWindow.once("ready-to-show", () => mainWindow.show());',
    '''  mainWindow.once("ready-to-show", () => {
    if (!mainWindow.isMaximized()) mainWindow.maximize();
    mainWindow.show();
  });''',
    "abertura maximizada",
)

# Fullscreen REAL do BrowserWindow: no Windows isso remove moldura/título e barra de tarefas.
ipc_anchor = '''  ipcMain.handle("resenhazinha:copy", (_event, text) => {
    clipboard.writeText(String(text));
    return true;
  });
'''
ipc_replacement = ipc_anchor + '''
  ipcMain.handle("resenhazinha:set-window-fullscreen", (_event, enabled) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const target = Boolean(enabled);
    mainWindow.setFullScreen(target);
    return target;
  });
'''
main = replace_once(main, ipc_anchor, ipc_replacement, "IPC de fullscreen real")

# Expõe o comando do Electron ao renderer sem liberar Node.
preload_anchor = '  copyText: (text) => ipcRenderer.invoke("resenhazinha:copy", text),\n'
preload = replace_once(
    preload,
    preload_anchor,
    preload_anchor + '  setWindowFullscreen: (enabled) => ipcRenderer.invoke("resenhazinha:set-window-fullscreen", Boolean(enabled)),\n',
    "bridge de fullscreen",
)

# Mantém o layout imersivo v4.2.2, mas agora ele também liga/desliga o fullscreen da janela.
exit_old = '''function exitDiscordFullscreen() {
  if (!fullscreenState) return;
  const { card, placeholder, exitButton } = fullscreenState;
'''
exit_new = '''async function exitDiscordFullscreen() {
  if (!fullscreenState) return;
  const { card, placeholder, exitButton } = fullscreenState;
  try { await window.resenhazinhaDesktop?.setWindowFullscreen?.(false); } catch (_error) {}
'''
renderer = replace_once(renderer, exit_old, exit_new, "saída fullscreen renderer")

enter_old = '''function enterDiscordFullscreen(card) {
  if (!card || fullscreenState?.card === card) return;
  if (fullscreenState) exitDiscordFullscreen();

  const parent = card.parentNode;
'''
enter_new = '''async function enterDiscordFullscreen(card) {
  if (!card || fullscreenState?.card === card) return;
  if (fullscreenState) await exitDiscordFullscreen();

  const parent = card.parentNode;
'''
renderer = replace_once(renderer, enter_old, enter_new, "entrada fullscreen renderer")

renderer = replace_once(
    renderer,
    '''  updateFullscreenButton(card, true);

  exitButton.addEventListener("click", (event) => {''',
    '''  updateFullscreenButton(card, true);
  try { await window.resenhazinhaDesktop?.setWindowFullscreen?.(true); } catch (_error) {}

  exitButton.addEventListener("click", (event) => {''',
    "ativação fullscreen real",
)

renderer = replace_once(
    renderer,
    '''function toggleDiscordFullscreen(card) {
  if (fullscreenState?.card === card) exitDiscordFullscreen();
  else enterDiscordFullscreen(card);
}''',
    '''async function toggleDiscordFullscreen(card) {
  if (fullscreenState?.card === card) await exitDiscordFullscreen();
  else await enterDiscordFullscreen(card);
}''',
    "toggle fullscreen assíncrono",
)

main_path.write_text(main, encoding="utf-8")
preload_path.write_text(preload, encoding="utf-8")
renderer_path.write_text(renderer, encoding="utf-8")

print("v4.2.3 aplicada: app abre maximizado e stream usa fullscreen real do Electron")
