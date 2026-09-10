from pathlib import Path
import re

main_path = Path("src/main.js")
index_path = Path("index.html")

main = main_path.read_text(encoding="utf-8")
index = index_path.read_text(encoding="utf-8")

# v4.2.0: não tenta recolocar o convidado automaticamente quando a conexão
# com o host cai. Isso evita o comportamento de sair/voltar sozinho da call.
reconnect_pattern = re.compile(
    r"function scheduleHostReconnect\(\) \{.*?\n\}",
    re.DOTALL,
)
replacement = '''function scheduleHostReconnect() {
  // v4.2.0: sem reconexão automática. O usuário escolhe quando reconectar.
}'''
main, reconnect_count = reconnect_pattern.subn(replacement, main, count=1)
if reconnect_count == 0 and "sem reconexão automática" not in main:
    raise SystemExit("Não encontrei scheduleHostReconnect() para aplicar a v4.2.0")

# Também evita que o PeerJS faça um reconnect silencioso do socket de sinalização.
main = main.replace(
    'state.peer.on("disconnected", () => { setConnectionState("Reconectando…", "warning"); if (!state.peer.destroyed) state.peer.reconnect(); });',
    'state.peer.on("disconnected", () => { setConnectionState("Desconectado", "warning"); });',
)
main = main.replace(
    'toast("O anfitrião ficou offline. O servidor continua salvo e reconecta quando ele voltar.", "error");',
    'toast("O anfitrião ficou offline. O servidor continua salvo; entre novamente quando quiser.", "error");',
)
main = main.replace(
    'toast("O chat está reconectando. Tente de novo em um instante.");',
    'toast("O servidor está offline. Entre novamente quando quiser.");',
)

# O mixer antigo chegava a 200%, o que podia estourar bastante vozes já altas.
# Mantemos boost acima de 100%, mas limitamos a 160% para ficar mais utilizável.
for slider_id in ("member-volume-range", "voice-context-volume-range"):
    pattern = re.compile(rf'(<input[^>]*id="{re.escape(slider_id)}"[^>]*\bmax=")[^"]+("[^>]*>)')
    index, _ = pattern.subn(rf'\g<1>160\2', index, count=1)

module_tag = '    <script type="module" src="/src/v4.2.0.js"></script>\n'
if "/src/v4.2.0.js" not in index:
    marker = '    <script type="module" src="/src/main.js"></script>\n'
    if marker in index:
        index = index.replace(marker, marker + module_tag, 1)
    else:
        index = index.replace("  </body>", module_tag + "  </body>", 1)

main_path.write_text(main, encoding="utf-8")
index_path.write_text(index, encoding="utf-8")

print("v4.2.0 aplicada: fullscreen, emoji picker, mixer limpo e sem reconnect automático")
