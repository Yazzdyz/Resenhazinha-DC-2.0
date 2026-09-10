from pathlib import Path

index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")

module_tag = '    <script type="module" src="/src/v4.2.2.js"></script>\n'
if "/src/v4.2.2.js" not in index:
    anchor = '    <script type="module" src="/src/v4.2.0.js"></script>\n'
    if anchor in index:
        index = index.replace(anchor, anchor + module_tag, 1)
    else:
        fallback = '    <script type="module" src="/src/main.js"></script>\n'
        if fallback in index:
            index = index.replace(fallback, fallback + module_tag, 1)
        else:
            index = index.replace("  </body>", module_tag + "  </body>", 1)

if "/src/v4.2.2.js" not in index:
    raise SystemExit("v4.2.2: não consegui injetar o módulo no index.html")

index_path.write_text(index, encoding="utf-8")
print("v4.2.2 aplicada: fullscreen imersivo e seletor de emojis estilo Discord")
