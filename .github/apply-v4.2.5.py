from pathlib import Path

main_path = Path("electron/main.cjs")
main = main_path.read_text(encoding="utf-8")

if 'titleBarOverlay:' not in main:
    anchor = '    autoHideMenuBar: true,\n'
    if anchor not in main:
        raise SystemExit("v4.2.5: não encontrei autoHideMenuBar em electron/main.cjs")
    replacement = anchor + '''    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#050506",
      symbolColor: "#b5bac1",
      height: 32,
    },
'''
    main = main.replace(anchor, replacement, 1)

main_path.write_text(main, encoding="utf-8")

index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
module = '    <script type="module" src="/src/v4.2.5.js"></script>\n'
if "/src/v4.2.5.js" not in index:
    if "  </body>" not in index:
        raise SystemExit("v4.2.5: não encontrei </body> em index.html")
    index = index.replace("  </body>", module + "  </body>", 1)
index_path.write_text(index, encoding="utf-8")

print("v4.2.5 aplicada: titlebar integrada e fullscreen em ícone com tooltip")
