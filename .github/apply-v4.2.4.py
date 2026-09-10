from pathlib import Path
import re

path = Path("src/main.js")
text = path.read_text(encoding="utf-8")


def replace_function(name: str, replacement: str, required: bool = True):
    global text
    pattern = re.compile(rf"function {re.escape(name)}\([^\n]*\) \{{.*?\n\}}", re.DOTALL)
    text, count = pattern.subn(replacement, text, count=1)
    if required and count != 1:
        raise SystemExit(f"v4.2.4: não encontrei {name} (count={count})")
    return count


# Estado usado somente para impedir que uma chamada que CAIU seja recriada
# automaticamente. A primeira conexão continua normal.
if "voiceReconnectBlockedPeers" not in text:
    text, count = re.subn(
        r"(  voiceCalls: new Map\(\),\n)",
        r"\1  voiceReconnectBlockedPeers: new Set(),\n  screenReconnectBlockedPeers: new Set(),\n  screenInboundReconnectBlockedPeers: new Set(),\n",
        text,
        count=1,
    )
    if count != 1:
        raise SystemExit("v4.2.4: não encontrei voiceCalls para adicionar bloqueios")


# 1) Sem reconnect automático de PeerJS / host.
# Algumas versões intermediárias da cadeia já removem parte disso, então a
# ausência de um trecho já removido NÃO é erro.
replace_function(
    "scheduleHostReconnect",
    '''function scheduleHostReconnect() {
  // v4.2.4: reconexão automática desativada.
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}''',
    required=False,
)

# Handler PeerJS: não chama peer.reconnect().
text = re.sub(
    r'state\.peer\.on\("disconnected",\s*\(\)\s*=>\s*\{[^\n]*?state\.peer\.reconnect\(\);?[^\n]*?\}\);',
    'state.peer.on("disconnected", () => { setConnectionState("Desconectado", "warning"); });',
    text,
    count=1,
)
text = text.replace("if (!state.peer.destroyed) state.peer.reconnect();", "")
text = text.replace("if (!state.peer?.destroyed) state.peer.reconnect();", "")

# Qualquer chamada explícita ao modo reconnect do host é desativada.
text = text.replace("connectToHost(true);", "")
text = text.replace("scheduleHostReconnect();", "")

# Se o canal de CONTROLE com o host fechar, não derruba a mídia que já está
# rodando. Procura especificamente o close da hostConnection e remove apenas
# o teardown de voz/tela desse bloco.
close_pattern = re.compile(
    r'  connection\.on\("close", \(\) => \{.*?\n  \}\);(?=\n  connection\.on\("error")',
    re.DOTALL,
)
for match in list(close_pattern.finditer(text)):
    block = match.group(0)
    if "state.hostConnection === connection" not in block:
        continue
    cleaned = block
    cleaned = cleaned.replace("      closeAllMediaCalls();\n", "")
    cleaned = cleaned.replace("      state.inVoice = false;\n", "")
    cleaned = re.sub(r"\s*state\.localStream\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);\s*state\.localStream = null;", "", cleaned)
    cleaned = cleaned.replace("      applyLocalAudioState(); updateControlState();\n", "")
    cleaned = re.sub(r"\s*state\.members = state\.members\.filter\([^\n]*\);", "", cleaned)
    cleaned = cleaned.replace("      renderMembers(); renderVoiceGrid();\n", "")
    cleaned = cleaned.replace("      scheduleHostReconnect();\n", "")
    cleaned = cleaned.replace("reconecta quando ele voltar.", "a call atual não será reiniciada automaticamente.")
    text = text[:match.start()] + cleaned + text[match.end():]
    break

# Erros de host também não disparam reconnect.
text = text.replace("else scheduleHostReconnect();", 'else setConnectionState("Servidor offline", "warning");')


# 2) Voz: a conexão inicial é criada normalmente. Se uma MediaConnection cair
# enquanto os dois ainda estão marcados na call, aquele peer fica bloqueado até
# uma ação manual (sair/entrar de novo).
replace_function(
    "reconcileVoiceCalls",
    '''function reconcileVoiceCalls() {
  if (!state.peer?.open || !state.localStream) return;
  const activeIds = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  state.voiceReconnectBlockedPeers.forEach((peerId) => {
    if (!activeIds.has(peerId)) state.voiceReconnectBlockedPeers.delete(peerId);
  });
  state.voiceCalls.forEach((call, peerId) => {
    if (!activeIds.has(peerId)) {
      state.voiceReconnectBlockedPeers.delete(peerId);
      call.close();
      state.voiceCalls.delete(peerId);
      removeRemoteAudio(peerId);
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
)

# Não aceita uma recriação entrante de voz para um peer bloqueado.
voice_answer = '  call.answer(state.localStream || new MediaStream()); registerVoiceCall(call);'
if voice_answer in text and "voiceReconnectBlockedPeers.has(call.peer)" not in text:
    text = text.replace(
        voice_answer,
        '  if (state.voiceReconnectBlockedPeers.has(call.peer)) { call.close(); return; }\n' + voice_answer,
        1,
    )

replace_function(
    "registerVoiceCall",
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
)

# Entrar manualmente na call libera uma conexão nova.
join_anchor = '''async function joinVoiceChannel() {
  if (!state.server.voiceChannel.exists || state.inVoice) { if (state.server.voiceChannel.exists) switchView("voice"); return; }'''
if join_anchor in text and "state.voiceReconnectBlockedPeers.clear();" not in text[text.find(join_anchor):text.find(join_anchor) + 500]:
    text = text.replace(
        join_anchor,
        join_anchor + '\n  state.voiceReconnectBlockedPeers.clear();\n  state.screenInboundReconnectBlockedPeers.clear();',
        1,
    )


# 3) Tela: mesma regra. Primeira abertura funciona; se o WebRTC da tela cair,
# não recria sozinho. O usuário precisa parar/iniciar a transmissão novamente.
share_anchor = '''function beginScreenShare(stream) {
  state.screenStream = stream;'''
if share_anchor in text:
    text = text.replace(
        share_anchor,
        '''function beginScreenShare(stream) {
  state.screenReconnectBlockedPeers.clear();
  state.screenStream = stream;''',
        1,
    )

replace_function(
    "reconcileScreenCalls",
    '''function reconcileScreenCalls() {
  if (!state.screenStream || !state.peer?.open || !state.inVoice) return;
  const activeIds = new Set(state.members.filter((member) => member.inVoice).map((member) => member.peerId));
  state.screenReconnectBlockedPeers.forEach((peerId) => {
    if (!activeIds.has(peerId)) state.screenReconnectBlockedPeers.delete(peerId);
  });
  state.screenCallsOut.forEach((call, peerId) => {
    if (!activeIds.has(peerId)) {
      state.screenReconnectBlockedPeers.delete(peerId);
      call.close();
      state.screenCallsOut.delete(peerId);
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
      if (state.screenStream && state.inVoice && state.members.some((item) => item.peerId === member.peerId && item.inVoice)) {
        state.screenReconnectBlockedPeers.add(member.peerId);
      }
      if (state.screenCallsOut.get(member.peerId) === call) state.screenCallsOut.delete(member.peerId);
    };
    call.on("close", markDropped);
    call.on("error", markDropped);
  });
}''',
)

# Bloqueia uma tentativa de reabrir automaticamente uma tela recebida que caiu.
screen_previous = '    const previousCall = state.screenCallsIn.get(call.peer);'
if screen_previous in text and "screenInboundReconnectBlockedPeers.has(call.peer)" not in text:
    text = text.replace(
        screen_previous,
        '    if (state.screenInboundReconnectBlockedPeers.has(call.peer)) { call.close(); return; }\n' + screen_previous,
        1,
    )

old_screen_close = '''    call.on("close", () => { if (state.screenCallsIn.get(call.peer) === call) { state.screenCallsIn.delete(call.peer); state.activeScreens.delete(call.peer); state.activeScreen = state.activeScreens.values().next().value || null; clearScreenStage(call.peer); renderMembers(); } }); call.on("error", () => { if (state.screenCallsIn.get(call.peer) === call) clearScreenStage(call.peer); }); return;'''
if old_screen_close in text:
    text = text.replace(
        old_screen_close,
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

# Um screen-stopped real libera o próximo compartilhamento manual.
text = text.replace(
    'if (message.type === "screen-stopped") { state.activeScreens.delete(peerId);',
    'if (message.type === "screen-stopped") { state.screenInboundReconnectBlockedPeers.delete(peerId); state.activeScreens.delete(peerId);',
    1,
)


# Garantias finais da v4.2.4.
if "state.peer.reconnect()" in text:
    raise SystemExit("v4.2.4: ainda existe state.peer.reconnect()")
if "connectToHost(true)" in text:
    raise SystemExit("v4.2.4: ainda existe connectToHost(true)")

path.write_text(text, encoding="utf-8")
print("v4.2.4 aplicada: sem reconnect automático de host, PeerJS, voz ou tela")
