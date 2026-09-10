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


# O mixer individual continua indo de 0 a 200%.
# A v4.2.0 reduzia isso para 160%; a hotfix restaura o alcance correto.
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
        raise SystemExit(f"v4.2.1: não encontrei {slider_id} para restaurar 200%")


# Protege o boost de volume sem diminuir o limite do usuário.
# Antes a cadeia era source -> gain -> destination. Em 200%, vozes já altas
# podiam ultrapassar 0 dBFS e clipar na saída. Agora usamos um limiter depois
# do ganho e suavizamos mudanças do slider para evitar estalos ao arrastar.
helper_anchor = '''async function applyOutputDevice(element) {
'''
helper_code = '''function createPlaybackLimiter(context) {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
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
    param.setTargetAtTime(next, now, 0.012);
  } catch (_error) {
    param.value = next;
  }
}

async function applyOutputDevice(element) {
'''
main = replace_once(main, helper_anchor, helper_code, "helpers do limiter")

main = replace_once(
    main,
    '''  if (node?.gain) node.gain.gain.value = effective;''',
    '''  if (node?.gain) setPlaybackGain(node.gain.gain, effective);''',
    "ganho suave de voz",
)

main = replace_once(
    main,
    '''  try { node.gain?.disconnect?.(); } catch (_error) {}
  try { node.audio.srcObject = null; } catch (_error) {}''',
    '''  try { node.gain?.disconnect?.(); } catch (_error) {}
  try { node.limiter?.disconnect?.(); } catch (_error) {}
  try { node.audio.srcObject = null; } catch (_error) {}''',
    "limpeza do limiter de voz",
)

main = replace_once(
    main,
    '''      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      source.connect(gain).connect(destination);
      audio.srcObject = destination.stream;
      state.memberAudioNodes.set(peerId, { source, gain, destination, audio, stream });''',
    '''      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      const limiter = createPlaybackLimiter(context);
      const destination = context.createMediaStreamDestination();
      source.connect(gain).connect(limiter).connect(destination);
      audio.srcObject = destination.stream;
      state.memberAudioNodes.set(peerId, { source, gain, limiter, destination, audio, stream });''',
    "cadeia protegida de voz",
)

main = replace_once(
    main,
    '''  try { node.gain?.disconnect?.(); } catch (_error) {}
  try { node.audio?.remove?.(); } catch (_error) {}''',
    '''  try { node.gain?.disconnect?.(); } catch (_error) {}
  try { node.limiter?.disconnect?.(); } catch (_error) {}
  try { node.audio?.remove?.(); } catch (_error) {}''',
    "limpeza do limiter de tela",
)

main = replace_once(
    main,
    '''  const source = context.createMediaStreamSource(entry.stream);
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  source.connect(gain).connect(destination);''',
    '''  const source = context.createMediaStreamSource(entry.stream);
  const gain = context.createGain();
  const limiter = createPlaybackLimiter(context);
  const destination = context.createMediaStreamDestination();
  source.connect(gain).connect(limiter).connect(destination);''',
    "cadeia protegida da tela",
)

main = replace_once(
    main,
    '''  const node = { source, gain, destination, audio, stream: entry.stream };''',
    '''  const node = { source, gain, limiter, destination, audio, stream: entry.stream };''',
    "armazenamento do limiter da tela",
)

main = replace_once(
    main,
    '''    node.gain.gain.value = setting.muted || !hasAudio ? 0 : setting.volume * normalizeOutputVolume(state.outputVolume);''',
    '''    setPlaybackGain(node.gain.gain, setting.muted || !hasAudio ? 0 : setting.volume * normalizeOutputVolume(state.outputVolume));''',
    "ganho suave da tela",
)

main_path.write_text(main, encoding="utf-8")
index_path.write_text(index, encoding="utf-8")
v42_path.write_text(v42, encoding="utf-8")

print("v4.2.1 aplicada: mixer 0-200% com limiter anti-clipping e ganho suavizado")
