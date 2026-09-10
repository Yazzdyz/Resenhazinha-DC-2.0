from pathlib import Path
import re

main_path = Path("src/main.js")
index_path = Path("index.html")

main = main_path.read_text(encoding="utf-8")
index = index_path.read_text(encoding="utf-8")

# Remove o timer de 30 segundos que derrubava a pessoa da call e depois
# preparava a entrada automática novamente. A reconexão normal da rede continua
# existindo; o que some é somente esse comportamento de "anti-AFK" da call.
grace_pattern = re.compile(
    r"function scheduleHostDisconnectGrace\(\) \{.*?\n\}",
    re.DOTALL,
)
grace_replacement = '''function scheduleHostDisconnectGrace() {
  // v4.2.0: não força saída da call depois de um tempo offline.
  cancelHostDisconnectGrace();
}'''
main, grace_count = grace_pattern.subn(grace_replacement, main, count=1)
if grace_count == 0 and "não força saída da call" not in main:
    raise SystemExit("Não encontrei scheduleHostDisconnectGrace() para aplicar a v4.2.0")

# O mixer de pessoas continua exatamente em 0–200%.
for slider_id in ("member-volume-range", "voice-context-volume-range"):
    pattern = re.compile(rf'(<input[^>]*id="{re.escape(slider_id)}"[^>]*\bmax=")[^"]+("[^>]*>)')
    index, count = pattern.subn(rf'\g<1>200\2', index, count=1)
    if count != 1:
        raise SystemExit(f"Não encontrei {slider_id} para manter o limite em 200%")

# Carrega as melhorias visuais/funcionais da v4.2.0 (fullscreen e emojis).
module_tag = '    <script type="module" src="/src/v4.2.0.js"></script>\n'
if "/src/v4.2.0.js" not in index:
    marker = '    <script type="module" src="/src/main.js"></script>\n'
    if marker in index:
        index = index.replace(marker, marker + module_tag, 1)
    else:
        index = index.replace("  </body>", module_tag + "  </body>", 1)

main_path.write_text(main, encoding="utf-8")
index_path.write_text(index, encoding="utf-8")

print("v4.2.0 aplicada: fullscreen, emoji picker, mixer 200% e sem saída temporizada da call")
