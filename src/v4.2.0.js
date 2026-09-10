import "./v4.2.0.css";

const EMOJI_RECENTS_KEY = "resenhazinha:emoji-recents-v42";
const CLEAN_BOOST_MAX = 160;
const emojiSearchTerms = {
  recent: "recentes usado usados histórico historico",
  smileys: "carinhas rosto rostos cara caras feliz feliz alegria risada rir triste choro chorando bravo raiva surpresa sono doente",
  gestures: "gestos gesto mão mao mãos maos joinha positivo negativo palma palmas dedos força forca obrigado oração oracao",
  hearts: "corações coracoes coração coracao amor paixão paixao fogo estrela brilho",
  nature: "animais animal natureza cachorro gato urso panda macaco peixe flor planta sol lua clima",
  food: "comida comidas fruta frutas lanche pizza hamburguer café cafe bebida doce bolo",
  activities: "atividades atividade esporte esportes futebol basquete jogo jogos game games música musica cinema arte",
  objects: "objetos objeto celular computador câmera camera dinheiro ferramenta presente chave",
  symbols: "símbolos simbolos símbolo simbolo aviso seta setas check certo errado cores",
};

const emojiCategories = [
  { id: "recent", label: "Recentes", icon: "◷", emojis: [] },
  { id: "smileys", label: "Carinhas", icon: "☺", emojis: "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕".split(" ") },
  { id: "gestures", label: "Gestos", icon: "☝", emojis: "👋 🤚 🖐️ ✋ 🖖 👌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🫶 🫰 🫵 🫡".split(" ") },
  { id: "hearts", label: "Corações", icon: "♥", emojis: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ❤️‍🔥 ❤️‍🩹 💋 💯 ✨ ⭐ 🌟 💫 🔥".split(" ") },
  { id: "nature", label: "Animais e natureza", icon: "♣", emojis: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🌸 🌹 🌺 🌻 🌼 🌷 🌱 🌿 🍀 🌵 🌴 🌲 🌈 ☀️ 🌙 ⚡ ❄️".split(" ") },
  { id: "food", label: "Comida", icon: "♨", emojis: "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥝 🍅 🥑 🍆 🥦 🥕 🌽 🌶️ 🍄 🥜 🍞 🥐 🥖 🧀 🍳 🥓 🍔 🍟 🍕 🌭 🌮 🌯 🍜 🍝 🍣 🍤 🍚 🍙 🍘 🍡 🍦 🍩 🍪 🎂 🍰 🍫 🍿 ☕ 🧃 🥤".split(" ") },
  { id: "activities", label: "Atividades", icon: "⚽", emojis: "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 🥅 ⛳ 🏹 🎣 🤿 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🏇 🧘 🎮 🕹️ 🎲 ♟️ 🎯 🎳 🎸 🎹 🎤 🎧 🎬 🎨".split(" ") },
  { id: "objects", label: "Objetos", icon: "♦", emojis: "⌚ 📱 💻 ⌨️ 🖥️ 🖱️ 🖨️ 📷 📹 🎥 📞 ☎️ 📺 📻 🎙️ ⏰ ⌛ 💡 🔦 🕯️ 💸 💵 💳 💎 ⚒️ 🔧 🔨 🪛 🔩 ⚙️ 🔫 💣 🔪 🛡️ 🚪 🪑 🛏️ 🎁 🎈 🎉 🧸 📌 📍 ✂️ 🔒 🔑".split(" ") },
  { id: "symbols", label: "Símbolos", icon: "#", emojis: "✅ ❌ ❗ ❓ ‼️ ⁉️ ⭕ 🚫 💢 ♻️ 🔱 ⚜️ 🔰 ⚠️ ☢️ ☣️ ⬆️ ➡️ ⬇️ ⬅️ ↩️ ↪️ 🔄 🔃 ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ 🔀 🔁 🔂 ➕ ➖ ➗ ✖️ ♾️ ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤".split(" ") },
];

function loadRecentEmojis() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMOJI_RECENTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 24) : [];
  } catch (_error) {
    return [];
  }
}

function rememberEmoji(emoji) {
  const next = [emoji, ...loadRecentEmojis().filter((item) => item !== emoji)].slice(0, 24);
  localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(next));
}

function insertEmoji(emoji) {
  const input = document.querySelector("#chat-input");
  if (!input) return;
  const value = input.value || "";
  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
  const maxLength = Number(input.maxLength) > 0 ? Number(input.maxLength) : 500;
  const next = `${value.slice(0, start)}${emoji}${value.slice(end)}`.slice(0, maxLength);
  input.value = next;
  const caret = Math.min(next.length, start + emoji.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus({ preventScroll: true });
  try { input.setSelectionRange(caret, caret); } catch (_error) {}
  rememberEmoji(emoji);
}

function createEmojiPicker() {
  const form = document.querySelector("#chat-form");
  const send = document.querySelector("#send-chat-button");
  if (!form || !send || document.querySelector("#chat-emoji-button-v42")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "chat-emoji-button-v42";
  button.className = "chat-emoji-button-v42";
  button.setAttribute("aria-label", "Abrir emojis");
  button.title = "Emoji";
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01M8.2 14.2c1 1.2 2.3 1.8 3.8 1.8s2.8-.6 3.8-1.8"/></svg>';
  form.insertBefore(button, send);

  const picker = document.createElement("div");
  picker.id = "emoji-picker-v42";
  picker.className = "emoji-picker-v42";
  picker.hidden = true;
  picker.innerHTML = `
    <div class="emoji-picker-header-v42">
      <strong>Emojis</strong>
      <button type="button" class="emoji-picker-close-v42" aria-label="Fechar">×</button>
    </div>
    <div class="emoji-picker-search-wrap-v42">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>
      <input class="emoji-picker-search-v42" type="search" placeholder="Buscar emoji" autocomplete="off" aria-label="Buscar emoji" />
    </div>
    <div class="emoji-picker-tabs-v42" role="tablist"></div>
    <div class="emoji-picker-scroll-v42">
      <div class="emoji-picker-section-title-v42"></div>
      <div class="emoji-picker-grid-v42"></div>
      <div class="emoji-picker-empty-v42" hidden>Nenhum emoji por aqui.</div>
    </div>`;
  document.body.append(picker);

  const tabs = picker.querySelector(".emoji-picker-tabs-v42");
  const grid = picker.querySelector(".emoji-picker-grid-v42");
  const title = picker.querySelector(".emoji-picker-section-title-v42");
  const search = picker.querySelector(".emoji-picker-search-v42");
  const empty = picker.querySelector(".emoji-picker-empty-v42");
  let activeCategory = "smileys";

  const categoryData = () => emojiCategories.map((category) => category.id === "recent" ? { ...category, emojis: loadRecentEmojis() } : category);

  function renderTabs() {
    tabs.replaceChildren();
    categoryData().forEach((category) => {
      if (category.id === "recent" && !category.emojis.length) return;
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "emoji-picker-tab-v42";
      tab.dataset.category = category.id;
      tab.title = category.label;
      tab.setAttribute("aria-label", category.label);
      tab.textContent = category.icon;
      tab.classList.toggle("is-active", activeCategory === category.id);
      tab.addEventListener("click", () => {
        activeCategory = category.id;
        search.value = "";
        renderTabs();
        renderGrid();
      });
      tabs.append(tab);
    });
  }

  function renderGrid() {
    const query = search.value.trim().toLocaleLowerCase("pt-BR");
    const categories = categoryData();
    let emojis = [];
    let label = "Resultados";
    if (query) {
      const seen = new Set();
      categories
        .filter((category) => `${category.label} ${emojiSearchTerms[category.id] || ""}`.toLocaleLowerCase("pt-BR").includes(query) || category.emojis.includes(query))
        .forEach((category) => category.emojis.forEach((emoji) => {
          if (!seen.has(emoji)) { seen.add(emoji); emojis.push(emoji); }
        }));
    } else {
      const category = categories.find((item) => item.id === activeCategory) || categories[1];
      label = category.label;
      emojis = category.emojis;
    }
    title.textContent = label.toUpperCase();
    grid.replaceChildren();
    emojis.forEach((emoji) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "emoji-picker-item-v42";
      item.textContent = emoji;
      item.setAttribute("aria-label", `Emoji ${emoji}`);
      item.addEventListener("click", () => {
        insertEmoji(emoji);
        renderTabs();
      });
      grid.append(item);
    });
    empty.hidden = emojis.length > 0;
  }

  function positionPicker() {
    const rect = button.getBoundingClientRect();
    const width = Math.min(390, window.innerWidth - 24);
    picker.style.width = `${width}px`;
    picker.style.visibility = "hidden";
    picker.hidden = false;
    const height = picker.offsetHeight || 430;
    let left = rect.right - width;
    let top = rect.top - height - 10;
    left = Math.max(12, Math.min(window.innerWidth - width - 12, left));
    if (top < 12) top = Math.min(window.innerHeight - height - 12, rect.bottom + 10);
    picker.style.left = `${Math.round(left)}px`;
    picker.style.top = `${Math.max(12, Math.round(top))}px`;
    picker.style.visibility = "visible";
  }

  function openPicker() {
    activeCategory = loadRecentEmojis().length ? "recent" : "smileys";
    search.value = "";
    renderTabs();
    renderGrid();
    positionPicker();
    button.classList.add("is-active");
    window.setTimeout(() => search.focus({ preventScroll: true }), 0);
  }

  function closePicker() {
    picker.hidden = true;
    button.classList.remove("is-active");
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (picker.hidden) openPicker(); else closePicker();
  });
  picker.querySelector(".emoji-picker-close-v42").addEventListener("click", closePicker);
  picker.addEventListener("pointerdown", (event) => event.stopPropagation());
  search.addEventListener("input", renderGrid);
  document.addEventListener("pointerdown", () => { if (!picker.hidden) closePicker(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !picker.hidden) closePicker(); });
  window.addEventListener("resize", () => { if (!picker.hidden) positionPicker(); });
  document.addEventListener("scroll", () => { if (!picker.hidden) positionPicker(); }, true);
}

function nativeFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function exitNativeFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
}

function leavePseudoFullscreen() {
  document.querySelectorAll(".is-pseudo-fullscreen-v42").forEach((card) => card.classList.remove("is-pseudo-fullscreen-v42"));
  document.body.classList.remove("has-pseudo-fullscreen-v42");
}

async function toggleCardFullscreen(card) {
  if (!card) return;
  const native = nativeFullscreenElement();
  if (native) {
    await exitNativeFullscreen().catch(() => undefined);
    return;
  }
  if (card.classList.contains("is-pseudo-fullscreen-v42")) {
    leavePseudoFullscreen();
    return;
  }
  leavePseudoFullscreen();
  try {
    if (card.requestFullscreen) {
      await card.requestFullscreen({ navigationUI: "hide" });
      return;
    }
    if (card.webkitRequestFullscreen) {
      card.webkitRequestFullscreen();
      return;
    }
    const video = card.querySelector("video");
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
      return;
    }
  } catch (_error) {}
  card.classList.add("is-pseudo-fullscreen-v42");
  document.body.classList.add("has-pseudo-fullscreen-v42");
}

function looksLikeFullscreenButton(button) {
  const text = `${button.textContent || ""} ${button.title || ""} ${button.getAttribute("aria-label") || ""} ${button.className || ""}`.toLocaleLowerCase("pt-BR");
  return /tela\s*cheia|fullscreen|full-screen|expandir/.test(text);
}

function enhanceScreenCard(card) {
  if (!(card instanceof HTMLElement) || card.dataset.fullscreenV42 === "ready") return;
  card.dataset.fullscreenV42 = "ready";
  let button = [...card.querySelectorAll("button")].find(looksLikeFullscreenButton);
  if (!button) {
    const bottom = card.querySelector(".screen-stream-bottom") || card;
    button = document.createElement("button");
    button.type = "button";
    bottom.append(button);
  }
  button.classList.add("screen-card-fullscreen-v42");
  button.title = "Tela cheia";
  button.setAttribute("aria-label", "Abrir transmissão em tela cheia");
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg><span>Tela cheia</span>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void toggleCardFullscreen(card);
  }, true);
  const video = card.querySelector("video");
  video?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    void toggleCardFullscreen(card);
  });
}

function enhanceScreenCards() {
  document.querySelectorAll(".screen-stream-card").forEach(enhanceScreenCard);
}

function tuneMixerRanges() {
  ["member-volume-range", "voice-context-volume-range"].forEach((id) => {
    const range = document.getElementById(id);
    if (!range) return;
    range.max = String(CLEAN_BOOST_MAX);
    range.title = `Boost máximo de ${CLEAN_BOOST_MAX}% para evitar distorção excessiva`;
    range.setAttribute("aria-valuemax", String(CLEAN_BOOST_MAX));
    if (Number(range.value) > CLEAN_BOOST_MAX) {
      range.value = String(CLEAN_BOOST_MAX);
      range.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function bootV42() {
  createEmojiPicker();
  tuneMixerRanges();
  enhanceScreenCards();
  const observer = new MutationObserver(() => {
    createEmojiPicker();
    tuneMixerRanges();
    enhanceScreenCards();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("fullscreenchange", enhanceScreenCards);
  document.addEventListener("webkitfullscreenchange", enhanceScreenCards);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("has-pseudo-fullscreen-v42")) leavePseudoFullscreen();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootV42, { once: true });
else bootV42();
