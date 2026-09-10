from pathlib import Path
import re

path = Path("src/main.js")
text = path.read_text(encoding="utf-8")


def sub_once(pattern, replacement, label, flags=0):
    global text
    text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"v4.2.4: não encontrei {label} (count={count})")


# Marca conexões de mídia que caíram inesperadamente. Enquanto o usuário não
# fizer uma ação manual (sair/entrar na call ou reiniciar a tela), elas não
# serão recriadas automaticamente.
sub_once(
    r'(  voiceCalls: new Map\(\),\n)',
    r'\1  voiceReconnectBlockedPeers: new Set(),\n  screenReconnectBlockedPeers: new Set(),\n  screenInboundReconnectBlockedPeers: new Set(),\n',
    'estado de bloqueio de reconexão',
)

# Sem timer de reconexão automática com o host.
sub_once(
    r'function scheduleHostReconnect\(\) \{.*?\n\}',
    '''function scheduleHostReconnect() {
  // v4.2.4: reconexão automática desativada de propósito.
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}''',
    'scheduleHostReconnect',
    re.DOTALL,
)

# Sem PeerJS reconnect automático.
sub_once(
    r'  state\.peer\.on\("disconnected", \(\) => \{ setConnectionState\("Reconectando…", "warning"\); if \(!state\.peer\.destroyed\) state\.peer\.reconnect\(\); \}\);',
    '  state.peer.on("disconnected", () => { setConnectionState("Desconectado", "warning"); });',
    'peer.reconnect',
)

# Timeout depois de já estar dentro do servidor: somente informa, não tenta de novo.
text = text.replace(
    '''    } else if (!connection.open && state.roomEntered) {
      setConnectionState("Servidor offline", "warning");
      scheduleHostReconnect();
    }
  }, isReconnect ? 6500 : 10000);''',
    '''    } else if (!connection.open && state.roomEntered) {
      setConnectionState("Servidor offline", "warning");
    }
  }, 10000);''',
    1,
)

# Se o canal de controle com o host cair, NÃO derruba a call/tela que já está
# rodando e NÃO tenta reconectar. Assim uma oscilação de sinalização não força
# o amigo a abrir a transmissão outra vez.
sub_once(
    r'''  connection\.on\("close", \(\) => \{\n    if \(state\.hostConnection === connection\) state\.hostConnection = null;\n    if \(state\.roomEntered\) \{.*?\n    \}\n  \}\);\n  connection\.on\("error", \(\) => \{\n    if \(!state\.roomEntered\) setLobbyStatus\((.*?)\);\n    else scheduleHostReconnect\(\);\n  \}\);''',
    r'''  connection.on("close", () => {
    if (state.hostConnection === connection) state.hostConnection = null;
    if (state.roomEntered) {
      setConnectionState("Servidor offline", "warning");
      toast("A conexão com o servidor caiu. A call e as transmissões atuais não serão reiniciadas automaticamente.", "error");
    }
  });
  connection.on("error", () => {
    if (!state.roomEntered) setLobbyStatus(\1);
    else setConnectionState("Servidor offline", "warning");
  });''',
    'close/error do host',
    re.DOTALL,
)

# Voz: cria a conexão inicial normalmente, mas uma conexão que caiu enquanto os
# dois ainda estavam marcados na call não é recriada sozinha.
sub_once(
    r'function reconcileVoiceCalls\(\) \{.*?\n\}',
    '''function reconcileVoiceCalls() {
  if (!state.peer?.open || !state.localStream) return;
  const activeIds = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  state.voiceReconnectBlockedPeers.forEach((peerId) => { if (!activeIds.has(peerId)) state.voiceReconnectBlockedPeers.delete(peerId); });
  state.voiceCalls.forEach((call, peerId) => {
    if (!activeIds.has(peerId)) {
      state.voiceReconnectBlockedPeers.delete(peerId);
      call.close(); state.voiceCalls.delete(peerId); removeRemoteAudio(peerId);
    }
  });
  if (!state.inVoice) return;
  state.members.forEach((member) => {
    if (!member.inVoice || member.peerId === state.peer.id || state.voiceCalls.has(member.peerId) || state.voiceReconnectBlockedPeers.has(member.peerId)) return;
    if (state.peer.id.localeCompare(member.peerId) < 0) {
      const call = state.peer.call(member.peerId, state.localStream, { metadata: { kind: "voice" } });
      if (call) registerVoiceCall(call);
    }
  });
}''',
    'reconcileVoiceCalls',
    re.DOTALL,
)

# Bloqueia chamadas de voz entrantes que seriam apenas uma tentativa automática
# de recriar uma conexão que já caiu.
text = text.replace(
    '''  const caller = state.members.find((member) => member.peerId === call.peer); if (!state.inVoice || !state.server.voiceChannel.exists || (caller && !caller.inVoice) || state.voiceCalls.has(call.peer)) { call.close(); return; }''',
    '''  const caller = state.members.find((member) => member.peerId === call.peer); if (!state.inVoice || !state.server.voiceChannel.exists || (caller && !caller.inVoice) || state.voiceCalls.has(call.peer) || state.voiceReconnectBlockedPeers.has(call.peer)) { call.close(); return; }''',
    1,
)

sub_once(
    r'function registerVoiceCall\(call\) \{.*?\n\}',
    '''function registerVoiceCall(call) {
  state.voiceCalls.set(call.peer, call);
  call.on("stream", (stream) => attachRemoteAudio(call.peer, stream));
  const markDropped = () => {
    const member = state.members.find((item) => item.peerId === call.peer);
    if (state.inVoice && member?.inVoice) state.voiceReconnectBlockedPeers.add(call.peer);
    if (state.voiceCalls.get(call.peer) === call) state.voiceCalls.delete(call.peer);
    removeRemoteAudio(call.peer);
  };
  call.on("close", markDropped);
  call.on("error", markDropped);
}''',
    'registerVoiceCall',
    re.DOTALL,
)

# Uma entrada manual na call libera novas conexões iniciais.
text = text.replace(
    '''async function joinVoiceChannel() {
  if (!state.server.voiceChannel.exists || state.inVoice) { if (state.server.voiceChannel.exists) switchView("voice"); return; }''',
    '''async function joinVoiceChannel() {
  if (!state.server.voiceChannel.exists || state.inVoice) { if (state.server.voiceChannel.exists) switchView("voice"); return; }
  state.voiceReconnectBlockedPeers.clear();
  state.screenInboundReconnectBlockedPeers.clear();''',
    1,
)

text = text.replace(
    '''  state.inVoice = false;
  applyLocalAudioState();''',
    '''  state.inVoice = false;
  state.voiceReconnectBlockedPeers.clear();
  state.screenReconnectBlockedPeers.clear();
  state.screenInboundReconnectBlockedPeers.clear();
  applyLocalAudioState();''',
    1,
)

# Tela enviada: inicia normalmente quando o usuário clica em compartilhar, mas
# se o WebRTC daquela transmissão cair não é recriado automaticamente.
text = text.replace(
    '''function beginScreenShare(stream) {
  state.screenStream = stream;''',
    '''function beginScreenShare(stream) {
  state.screenReconnectBlockedPeers.clear();
  state.screenStream = stream;''',
    1,
)

sub_once(
    r'function reconcileScreenCalls\(\) \{.*?\n\}',
    '''function reconcileScreenCalls() {
  if (!state.screenStream || !state.peer?.open || !state.inVoice) return;
  const activeIds = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  state.screenReconnectBlockedPeers.forEach((peerId) => { if (!activeIds.has(peerId)) state.screenReconnectBlockedPeers.delete(peerId); });
  state.screenCallsOut.forEach((call, peerId) => {
    if (!activeIds.has(peerId)) {
      state.screenReconnectBlockedPeers.delete(peerId);
      call.close(); state.screenCallsOut.delete(peerId);
    }
  });
  const profile = shareProfile();
  state.members.forEach((member) => {
    if (!member.inVoice || member.peerId === state.peer.id || state.screenCallsOut.has(member.peerId) || state.screenReconnectBlockedPeers.has(member.peerId)) return;
    const call = state.peer.call(member.peerId, state.screenStream, { metadata: { kind: "screen", sharerName: state.nickname, quality: profile.quality, fps: profile.fps } });
    if (!call) return;
    state.screenCallsOut.set(member.peerId, call);
    tuneScreenCall(call);
    const markDropped = () => {
      if (state.screenStream && state.inVoice && state.members.some((item) => item.peerId === member.peerId && item.inVoice)) state.screenReconnectBlockedPeers.add(member.peerId);
      if (state.screenCallsOut.get(member.peerId) === call) state.screenCallsOut.delete(member.peerId);
    };
    call.on("close", markDropped);
    call.on("error", markDropped);
  });
}''',
    'reconcileScreenCalls',
    re.DOTALL,
)

text = text.replace(
    '''function stopScreenShare() {
  if (!state.screenStream) return;''',
    '''function stopScreenShare() {
  if (!state.screenStream) return;
  state.screenReconnectBlockedPeers.clear();''',
    1,
)

# Tela recebida: se a stream caiu inesperadamente, rejeita tentativas de
# recriação automática até o compartilhador realmente parar/iniciar de novo.
text = text.replace(
    '''  if (call.metadata?.kind === "screen") {
    const sharer = state.members.find((member) => member.peerId === call.peer); if (!state.inVoice || !state.server.voiceChannel.exists || (sharer && !sharer.inVoice)) { call.close(); return; }''',
    '''  if (call.metadata?.kind === "screen") {
    const sharer = state.members.find((member) => member.peerId === call.peer); if (!state.inVoice || !state.server.voiceChannel.exists || (sharer && !sharer.inVoice) || state.screenInboundReconnectBlockedPeers.has(call.peer)) { call.close(); return; }''',
    1,
)

text = text.replace(
    '''    call.on("close", () => { if (state.screenCallsIn.get(call.peer) === call) { state.screenCallsIn.delete(call.peer); state.activeScreens.delete(call.peer); state.activeScreen = state.activeScreens.values().next().value || null; clearScreenStage(call.peer); renderMembers(); } }); call.on("error", () => { if (state.screenCallsIn.get(call.peer) === call) clearScreenStage(call.peer); }); return;''',
    '''    const markScreenDropped = () => {
      if (state.activeScreens.has(call.peer)) state.screenInboundReconnectBlockedPeers.add(call.peer);
      if (state.screenCallsIn.get(call.peer) === call) {
        state.screenCallsIn.delete(call.peer);
        clearScreenStage(call.peer);
        renderMembers();
      }
    };
    call.on("close", markScreenDropped); call.on("error", markScreenDropped); return;''',
    1,
)

# Um screen-stopped real libera o próximo screen-started manual.
text = text.replace(
    '''  if (message.type === "screen-stopped") { state.activeScreens.delete(peerId);''',
    '''  if (message.type === "screen-stopped") { state.screenInboundReconnectBlockedPeers.delete(peerId); state.activeScreens.delete(peerId);''',
    1,
)

# Quando o roster confirma que uma transmissão realmente acabou, libera aquele
# peer para um futuro compartilhamento manual.
text = text.replace(
    '''    state.activeScreen = state.activeScreens.values().next().value || null;
    if (!state.inVoice && state.screenStream) stopScreenShare();''',
    '''    state.activeScreen = state.activeScreens.values().next().value || null;
    state.screenInboundReconnectBlockedPeers.forEach((peerId) => { if (!state.activeScreens.has(peerId)) state.screenInboundReconnectBlockedPeers.delete(peerId); });
    if (!state.inVoice && state.screenStream) stopScreenShare();''',
    1,
)

# Garante que nenhum reconnect explícito sobrou.
if 'state.peer.reconnect()' in text:
    raise SystemExit('v4.2.4: ainda existe state.peer.reconnect()')

path.write_text(text, encoding="utf-8")
print("v4.2.4 aplicada: sem reconexão automática de host, PeerJS, voz ou tela")
