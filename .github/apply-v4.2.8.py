from pathlib import Path
import re

path = Path("src/main.js")
text = path.read_text(encoding="utf-8")

replacement = '''function guestHasLiveMedia(peerId) {
  return Boolean(
    state.voiceCalls.has(peerId)
    || state.screenCallsOut.has(peerId)
    || state.screenCallsIn.has(peerId)
    || state.activeScreens.has(peerId)
  );
}


function removeGuest(peerId) {
  state.pendingGuestProfiles.delete(peerId);
  const member = state.hostMembers.get(peerId);
  if (!state.hostMembers.has(peerId)) return;

  // O canal de controle PeerJS e a mídia WebRTC são conexões diferentes.
  // Nunca fecha voz/tela que continuam vivas só porque o controle deu erro/close.
  if (guestHasLiveMedia(peerId)) {
    const connection = state.guestConnections.get(peerId);
    if (connection && !connection.open) state.guestConnections.delete(peerId);

    console.warn("[Resenhazinha] Controle do convidado caiu; mídia continua ativa.", peerId);

    // Se a pessoa realmente fechou o app, a mídia também vai cair.
    // Só então limpamos o membro; não existe reconnect automático aqui.
    window.setTimeout(() => {
      if (!state.hostMembers.has(peerId)) return;
      if (state.guestConnections.get(peerId)?.open) return;
      if (guestHasLiveMedia(peerId)) return;
      removeGuest(peerId);
    }, 15000);
    return;
  }

  if (member) rememberMember(member);
  state.guestConnections.delete(peerId);
  state.hostMembers.delete(peerId);
  state.members = Array.from(state.hostMembers.values());
  closeCallsForPeer(peerId);
  state.activeScreens.delete(peerId);
  state.activeScreen = state.activeScreens.values().next().value || null;
  clearScreenStage(peerId);
  broadcastRoster(false);
  scheduleServerPersistence();
  if (member) toast(`${member.name} ficou offline.`);
}'''

pattern = re.compile(r"function removeGuest\(peerId\) \{.*?\n\}", re.DOTALL)
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"v4.2.8: não encontrei removeGuest (count={count})")

if "function guestHasLiveMedia(peerId)" not in text:
    raise SystemExit("v4.2.8: proteção de mídia não foi aplicada")
if "if (guestHasLiveMedia(peerId))" not in text:
    raise SystemExit("v4.2.8: removeGuest ainda não protege mídia ativa")

path.write_text(text, encoding="utf-8")
print("v4.2.8 aplicada: queda do controle não encerra mídia WebRTC ativa")
