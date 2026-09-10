from pathlib import Path

path = Path("src/main.js")
text = path.read_text(encoding="utf-8")

old = '''function acceptGuestConnection(connection) {
  connection.on("data", (message) => handleGuestMessage(connection.peer, message));
  connection.on("close", () => removeGuest(connection.peer)); connection.on("error", () => removeGuest(connection.peer));
'''

new = '''function guestHasLiveMedia(peerId) {
  const member = state.hostMembers.get(peerId);
  return Boolean(
    member?.inVoice
    || state.voiceCalls.has(peerId)
    || state.screenCallsOut.has(peerId)
    || state.screenCallsIn.has(peerId)
    || state.activeScreens.has(peerId)
  );
}

function handleGuestControlDisconnect(connection) {
  const peerId = connection.peer;
  const trackedConnection = state.guestConnections.get(peerId);

  // Um evento atrasado de uma conexão antiga nunca pode derrubar a sessão atual.
  if (trackedConnection && trackedConnection !== connection) return;

  if (trackedConnection === connection) state.guestConnections.delete(peerId);
  if (!state.hostMembers.has(peerId)) return;

  // A conexão de controle (chat/roster) é separada da mídia WebRTC.
  // Se voz/tela ainda estão vivas, preserva tudo e não chama closeCallsForPeer().
  if (guestHasLiveMedia(peerId)) {
    console.warn("[Resenhazinha] Canal de controle caiu; mantendo voz/tela ativa.", peerId);
    return;
  }

  removeGuest(peerId);
}

function acceptGuestConnection(connection) {
  connection.on("data", (message) => handleGuestMessage(connection.peer, message));
  connection.on("close", () => handleGuestControlDisconnect(connection));
  connection.on("error", (error) => {
    // Erro de DataConnection não significa que a mídia caiu.
    // O evento close decide o destino do canal de controle sem tocar na call ativa.
    console.warn("[Resenhazinha] Erro no canal de controle do convidado.", connection.peer, error?.type || error?.message || error);
  });
'''

if old not in text:
    raise SystemExit("v4.2.8: não encontrei acceptGuestConnection esperado")

text = text.replace(old, new, 1)

if 'connection.on("close", () => removeGuest(connection.peer))' in text:
    raise SystemExit("v4.2.8: remoção direta no close ainda existe")
if 'connection.on("error", () => removeGuest(connection.peer))' in text:
    raise SystemExit("v4.2.8: remoção direta no error ainda existe")

path.write_text(text, encoding="utf-8")
print("v4.2.8 aplicada: queda do canal de controle não encerra voz/tela ativa")
