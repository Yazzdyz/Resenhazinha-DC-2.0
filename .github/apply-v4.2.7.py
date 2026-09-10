from pathlib import Path

path = Path("electron/main.cjs")
text = path.read_text(encoding="utf-8")

bad = '''  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);
  mainWindow.on("enter-full-screen", sendWindowState);
  mainWindow.on("leave-full-screen", sendWindowState);
'''

if bad not in text:
    raise SystemExit("v4.2.7: listeners inválidos da v4.2.6 não encontrados")

text = text.replace(bad, "", 1)

if 'mainWindow.on("maximize", sendWindowState);' in text:
    raise SystemExit("v4.2.7: ainda existe listener prematuro em mainWindow")

path.write_text(text, encoding="utf-8")
print("v4.2.7 aplicada: remove listeners de janela registrados antes de createWindow()")
