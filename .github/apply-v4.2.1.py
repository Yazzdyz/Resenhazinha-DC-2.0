from pathlib import Path
import re

main_path = Path("src/main.js")
index_path = Path("index.html")
v42_path = Path("src/v4.2.0.js")

main = main_path.read_text(encoding="utf-8")
index = index_path.read_text(encoding="utf-8")
v42 = v42_path.read_text(encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"v4.2.1: anchor {label!r} count={count}")
    return text.replace(old, new, 1)


# A interface continua exatamente em 0–200%.
v42 = replace_once(
    v42,
    'const CLEAN_BOOST_MAX = 160;',
    'const CLEAN_BOOST_MAX = 200;',
    'limite visual 200%',
)

for slider_id in ("member-volume-range", "voice-context-volume-range"):
    pattern = re.compile(rf'(<input[^>]*id="{re.escape(slider_id)}"[^>]*\bmax=")[^"]+("[^>]*>)')
    index, count = pattern.subn(rf'\g<1>200\2', index, count=1)
    if count != 1:
        raise SystemExit(f"v4.2.1: não encontrei {slider_id} para manter 200%")


# O problema do boost antigo era a reprodução em paralelo:
# - o <audio> tocava a voz normal em até 100%;
# - acima disso, o AudioContext tocava outra cópia da mesma voz por cima.
# As duas rotas podem ter latências levemente diferentes e deixam a voz
# metálica/estranha. Agora, quando WebAudio está disponível, existe UMA rota:
# stream -> gain -> limiter -> saída. O <audio> fica apenas como fallback.
helper_anchor = '''async function applyOutputDevice(element, deviceId = state.speakerDeviceId) {
'''
helper_code = '''function createPlaybackLimiter(context) {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 2;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.10;
  return limiter;
}

function setPlaybackGain(param, value) {
  if (!param) return;
  const next = Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
  const context = state.playbackAudioContext;
  const now = context?.currentTime;
  if (!Number.isFinite(now)) { param.value = next; return; }
  try {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(next, now, 0.015);
  } catch (_error) {
    param.value = next;
  }
}

async function applyOutputDevice(element, deviceId = state.speakerDeviceId) {
'''
main = replace_once(main, helper_anchor, helper_code, "helpers do áudio protegido")

old_gain_block = '''  const node = state.memberAudioNodes.get(peerId);
  const audio = document.getElementById(`audio-${safeId(peerId)}`) || node?.audio;

  // A trilha principal toca diretamente no <audio>. Isso evita o caminho
  // AudioContext -> MediaStreamDestination que podia criar peer 1/1 e ainda
  // assim ficar completamente silencioso em alguns PCs.
  if (audio) audio.volume = Math.min(1, Math.max(0, effective));

  // Acima de 100% adicionamos somente o ganho extra pelo AudioContext.
  // Em 100% ou menos a voz não depende do WebAudio para ser ouvida.
  if (node?.gain) node.gain.gain.value = Math.max(0, effective - 1);'''
new_gain_block = '''  const node = state.memberAudioNodes.get(peerId);
  const audio = document.getElementById(`audio-${safeId(peerId)}`) || node?.audio;

  if (node?.gain) {
    // Uma única rota de reprodução evita a soma de duas cópias da voz com
    // pequenas diferenças de latência, que era o que deixava 200% estranho.
    if (audio) audio.volume = 0;
    setPlaybackGain(node.gain.gain, effective);
  } else if (audio) {
    // Fallback para máquinas sem WebAudio: reprodução direta, limitada pelo
    // próprio HTMLMediaElement a 100%.
    audio.volume = Math.min(1, Math.max(0, effective));
  }'''
main = replace_once(main, old_gain_block, new_gain_block, "rota única do mixer")

main = replace_once(
    main,
    '''  try { node.source?.disconnect?.(); } catch (_error) {}
  try { node.gain?.disconnect?.(); } catch (_error) {}
  try { node.audio.srcObject = null; } catch (_error) {}''',
    '''  try { node.source?.disconnect?.(); } catch (_error) {}
  try { node.gain?.disconnect?.(); } catch (_error) {}
  try { node.limiter?.disconnect?.(); } catch (_error) {}
  try { node.audio.srcObject = null; } catch (_error) {}''',
    "limpeza do limiter",
)

main = replace_once(
    main,
    '''  const node = { audio, stream, source: null, gain: null, context: null };''',
    '''  const node = { audio, stream, source: null, gain: null, limiter: null, context: null };''',
    "estado do limiter",
)

old_context_chain = '''      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(context.destination);
      node.source = source;
      node.gain = gain;
      node.context = context;'''
new_context_chain = '''      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      const limiter = createPlaybackLimiter(context);
      gain.gain.value = 0;
      source.connect(gain).connect(limiter).connect(context.destination);
      node.source = source;
      node.gain = gain;
      node.limiter = limiter;
      node.context = context;'''
main = replace_once(main, old_context_chain, new_context_chain, "cadeia única com limiter")

main_path.write_text(main, encoding="utf-8")
index_path.write_text(index, encoding="utf-8")
v42_path.write_text(v42, encoding="utf-8")

print("v4.2.1 aplicada: mixer 0-200%, rota única de áudio, limiter anti-clipping e ganho suavizado")
