import "./v4.2.2.css";

const EMOJI_RECENTS_KEY = "resenhazinha:emoji-recents-v422";
const FULLSCREEN_CLASS = "is-discord-fullscreen-v422";
const BODY_FULLSCREEN_CLASS = "has-discord-fullscreen-v422";

const emojiCategories = [
  { id: "recent", label: "Recentes", icon: "◷", emojis: [] },
  { id: "people", label: "Pessoas", icon: "☺", emojis: "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 👋 🤚 🖐️ ✋ 🖖 👌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🫶 🫰 🫵 🫡".split(" ") },
  { id: "nature", label: "Natureza", icon: "🌿", emojis: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🌸 🌹 🌺 🌻 🌼 🌷 🌱 🌿 🍀 🌵 🌴 🌲 🌈 ☀️ 🌙 ⚡ ❄️".split(" ") },
  { id: "food", label: "Comida", icon: "🍔", emojis: "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥝 🍅 🥑 🍆 🥦 🥕 🌽 🌶️ 🍄 🥜 🍞 🥐 🥖 🧀 🍳 🥓 🍔 🍟 🍕 🌭 🌮 🌯 🍜 🍝 🍣 🍤 🍚 🍙 🍘 🍡 🍦 🍩 🍪 🎂 🍰 🍫 🍿 ☕ 🧃 🥤".split(" ") },
  { id: "activities", label: "Atividades", icon: "🎮", emojis: "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 🥅 ⛳ 🏹 🎣 🤿 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🏇 🧘 🎮 🕹️ 🎲 ♟️ 🎯 🎳 🎸 🎹 🎤 🎧 🎬 🎨".split(" ") },
  { id: "travel", label: "Viagens", icon: "🚲", emojis: "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🚲 🛴 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚤 🛥️ 🚢 ⚓ 🗺️ 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🏖️ 🏝️ ⛰️ 🌋 🏕️".split(" ") },
  { id: "objects", label: "Objetos", icon: "💡", emojis: "⌚ 📱 💻 ⌨️ 🖥️ 🖱️ 🖨️ 📷 📹 🎥 📞 ☎️ 📺 📻 🎙️ ⏰ ⌛ 💡 🔦 🕯️ 💸 💵 💳 💎 ⚒️ 🔧 🔨 🪛 🔩 ⚙️ 🛡️ 🚪 🪑 🛏️ 🎁 🎈 🎉 🧸 📌 📍 ✂️ 🔒 🔑".split(" ") },
  { id: "hearts", label: "Símbolos", icon: "♥", emojis: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ❤️‍🔥 ❤️‍🩹 💋 💯 ✨ ⭐ 🌟 💫 🔥 ✅ ❌ ❗ ❓ ‼️ ⁉️ ⭕ 🚫 💢 ♻️ 🔱 ⚜️ 🔰 ⚠️ ☢️ ☣️ ⬆️ ➡️ ⬇️ ⬅️ ↩️ ↪️ 🔄 🔃 ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ 🔀 🔁 🔂 ➕ ➖ ➗ ✖️ ♾️ ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤".split(" ") },
  { id: "flags", label: "Bandeiras", icon: "⚑", emojis: "🇧🇷 🇺🇸 🇦🇷 🇨🇱 🇺🇾 🇵🇾 🇲🇽 🇨🇦 🇵🇹 🇪🇸 🇫🇷 🇩🇪 🇮🇹 🇬🇧 🇮🇪 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇸🇪 🇳🇴 🇫🇮 🇩🇰 🇵🇱 🇺🇦 🇷🇺 🇯🇵 🇰🇷 🇨🇳 🇮🇳 🇦🇺 🇳🇿 🇿🇦 🏳️ 🏴 🏁 🚩".split(" ") },
];

const searchTerms = {
  people: "pessoas pessoa carinhas rosto feliz sorrindo rindo triste chorando bravo raiva amor gesto mão mao joinha",
  nature: "natureza animais animal cachorro gato planta flor sol lua clima",
  food: "comida bebida pizza hamburguer café cafe fruta doce",
  activities: "atividades esporte jogo games musica música cinema arte",
  travel: "viagem viagens carro trem avião aviao barco bicicleta mapa",
  objects: "objetos objeto celular computador câmera camera dinheiro ferramenta presente chave",
  hearts: "símbolos simbolos amor coração coracao fogo estrela aviso seta check",
  flags: "bandeiras bandeira países paises brasil estados unidos japão japao portugal",
};

let fullscreenState = null;

function loadRecentEmojis() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMOJI_RECENTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 32) : [];
  } catch (_error) {
    return [];
  }
}

function rememberEmoji(emoji) {
  const next = [emoji, ...loadRecentEmojis().filter((item) => item !== emoji)].slice(0, 32);
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

function emojiName(emoji) {
  const names = {
    "😀": ":grinning:", "😃": ":smiley:", "😄": ":smile:", "😁": ":grin:", "😂": ":joy:", "🤣": ":rofl:",
    "🥺": ":pleading_face:", "😭": ":sob:", "😡": ":rage:", "😍": ":heart_eyes:", "🥰": ":smiling_face_with_3_hearts:",
    "😘": ":kissing_heart:", "😎": ":sunglasses:", "🤔": ":thinking:", "👍": ":thumbsup:", "👎": ":thumbsdown:",
    "👏": ":clap:", "🙏": ":pray:", "💪": ":muscle:", "❤️": ":heart:", "🔥": ":fire:", "✨": ":sparkles:",
    "💯": ":100:", "🎮": ":video_game:", "⚽": ":soccer:", "🍕": ":pizza:", "🇧🇷": ":flag_br:", "😴": ":sleeping:",
  };
  return names[emoji] || `:${emoji.codePointAt(0)?.toString(16) || "emoji"}:`;
}

function showPickerNotice(picker, message) {
  const notice = picker.querySelector(".emoji-picker-notice-v422");
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = false;
  window.clearTimeout(Number(notice.dataset.timer || 0));
  const timer = window.setTimeout(() => { notice.hidden = true; }, 1800);
  notice.dataset.timer = String(timer);
}

function replaceEmojiPicker() {
  const form = document.querySelector("#chat-form");
  const send = document.querySelector("#send-chat-button");
  if (!form || !send || form.dataset.emojiV422 === "ready") return;
  form.dataset.emojiV422 = "ready";

  document.querySelector("#emoji-picker-v42")?.remove();

  let oldButton = document.querySelector("#chat-emoji-button-v42");
  if (!oldButton) {
    oldButton = document.createElement("button");
    oldButton.type = "button";
    oldButton.id = "chat-emoji-button-v42";
    form.insertBefore(oldButton, send);
  }

  const button = oldButton.cloneNode(true);
  button.id = "chat-emoji-button-v42";
  button.className = "chat-emoji-button-v42 chat-emoji-button-v422";
  button.type = "button";
  button.title = "Emoji";
  button.setAttribute("aria-label", "Abrir emojis");
  button.innerHTML = '<span aria-hidden="true">☺</span>';
  oldButton.replaceWith(button);

  const picker = document.createElement("div");
  picker.id = "emoji-picker-v422";
  picker.className = "emoji-picker-v422";
  picker.hidden = true;
  picker.innerHTML = `
    <div class="emoji-picker-top-tabs-v422">
      <button type="button" data-mode="gifs">GIFs</button>
      <button type="button" data-mode="stickers">Figurinha</button>
      <button type="button" data-mode="emoji" class="is-active">Emoji</button>
    </div>
    <div class="emoji-picker-toolbar-v422">
      <label class="emoji-picker-search-v422">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg>
        <input type="search" placeholder="Buscar emoji" autocomplete="off" aria-label="Buscar emoji" />
      </label>
      <button type="button" class="emoji-picker-add-v422">Adicionar emoji</button>
    </div>
    <div class="emoji-picker-body-v422">
      <aside class="emoji-picker-rail-v422" aria-label="Categorias"></aside>
      <section class="emoji-picker-content-v422">
        <div class="emoji-picker-category-title-v422"></div>
        <div class="emoji-picker-grid-v422"></div>
        <div class="emoji-picker-empty-v422" hidden>Nenhum emoji encontrado.</div>
      </section>
    </div>
    <div class="emoji-picker-preview-v422">
      <div class="emoji-picker-preview-emoji-v422">😀</div>
      <div><strong class="emoji-picker-preview-name-v422">:grinning:</strong><span>Emoji</span></div>
    </div>
    <div class="emoji-picker-notice-v422" hidden></div>`;
  document.body.append(picker);

  const rail = picker.querySelector(".emoji-picker-rail-v422");
  const grid = picker.querySelector(".emoji-picker-grid-v422");
  const title = picker.querySelector(".emoji-picker-category-title-v422");
  const empty = picker.querySelector(".emoji-picker-empty-v422");
  const search = picker.querySelector(".emoji-picker-search-v422 input");
  const previewEmoji = picker.querySelector(".emoji-picker-preview-emoji-v422");
  const previewName = picker.querySelector(".emoji-picker-preview-name-v422");
  let activeCategory = loadRecentEmojis().length ? "recent" : "people";

  function categories() {
    return emojiCategories.map((category) => category.id === "recent" ? { ...category, emojis: loadRecentEmojis() } : category);
  }

  function setPreview(emoji) {
    if (!emoji) return;
    previewEmoji.textContent = emoji;
    previewName.textContent = emojiName(emoji);
  }

  function renderRail() {
    rail.replaceChildren();
    for (const category of categories()) {
      if (category.id === "recent" && !category.emojis.length) continue;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "emoji-picker-rail-item-v422";
      item.dataset.category = category.id;
      item.title = category.label;
      item.setAttribute("aria-label", category.label);
      item.textContent = category.icon;
      item.classList.toggle("is-active", activeCategory === category.id);
      item.addEventListener("click", () => {
        activeCategory = category.id;
        search.value = "";
        renderRail();
        renderGrid();
      });
      rail.append(item);
    }
  }

  function renderGrid() {
    const query = search.value.trim().toLocaleLowerCase("pt-BR");
    const data = categories();
    let emojis = [];
    let label = "Resultados";

    if (query) {
      const seen = new Set();
      for (const category of data) {
        const haystack = `${category.label} ${searchTerms[category.id] || ""}`.toLocaleLowerCase("pt-BR");
        if (!haystack.includes(query) && !category.emojis.some((emoji) => emoji.includes(query))) continue;
        for (const emoji of category.emojis) {
          if (!seen.has(emoji)) { seen.add(emoji); emojis.push(emoji); }
        }
      }
    } else {
      const category = data.find((item) => item.id === activeCategory) || data.find((item) => item.id === "people");
      label = category?.label || "Pessoas";
      emojis = category?.emojis || [];
    }

    title.innerHTML = `<span>☺</span>${label}<span class="emoji-picker-chevron-v422">⌄</span>`;
    grid.replaceChildren();
    for (const emoji of emojis) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "emoji-picker-item-v422";
      item.textContent = emoji;
      item.setAttribute("aria-label", emojiName(emoji));
      item.addEventListener("mouseenter", () => setPreview(emoji));
      item.addEventListener("focus", () => setPreview(emoji));
      item.addEventListener("click", () => {
        insertEmoji(emoji);
        setPreview(emoji);
        renderRail();
      });
      grid.append(item);
    }
    empty.hidden = emojis.length > 0;
    if (emojis[0]) setPreview(emojis[0]);
  }

  function positionPicker() {
    const rect = button.getBoundingClientRect();
    const width = Math.min(560, window.innerWidth - 20);
    picker.style.width = `${width}px`;
    picker.style.visibility = "hidden";
    picker.hidden = false;
    const height = Math.min(560, window.innerHeight - 20);
    picker.style.height = `${height}px`;
    let left = rect.right - width;
    let top = rect.top - height - 10;
    left = Math.max(10, Math.min(window.innerWidth - width - 10, left));
    if (top < 10) top = Math.min(window.innerHeight - height - 10, rect.bottom + 10);
    picker.style.left = `${Math.round(left)}px`;
    picker.style.top = `${Math.max(10, Math.round(top))}px`;
    picker.style.visibility = "visible";
  }

  function openPicker() {
    activeCategory = loadRecentEmojis().length ? "recent" : "people";
    search.value = "";
    renderRail();
    renderGrid();
    positionPicker();
    button.classList.add("is-active");
  }

  function closePicker() {
    picker.hidden = true;
    button.classList.remove("is-active");
  }

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (picker.hidden) openPicker(); else closePicker();
  });

  picker.addEventListener("pointerdown", (event) => event.stopPropagation());
  search.addEventListener("input", renderGrid);
  picker.querySelector(".emoji-picker-add-v422").addEventListener("click", () => {
    showPickerNotice(picker, "Emojis personalizados ainda não estão disponíveis.");
  });
  picker.querySelectorAll(".emoji-picker-top-tabs-v422 button[data-mode]").forEach((tab) => {
    if (tab.dataset.mode === "emoji") return;
    tab.addEventListener("click", () => showPickerNotice(picker, tab.dataset.mode === "gifs" ? "GIFs ainda não estão disponíveis." : "Figurinhas ainda não estão disponíveis."));
  });
  document.addEventListener("pointerdown", () => { if (!picker.hidden) closePicker(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !picker.hidden) closePicker(); });
  window.addEventListener("resize", () => { if (!picker.hidden) positionPicker(); });
}

function updateFullscreenButton(card, isActive) {
  const button = card?.querySelector(".screen-card-fullscreen-v42");
  if (!button) return;
  button.title = isActive ? "Sair da tela cheia" : "Tela cheia";
  button.setAttribute("aria-label", isActive ? "Sair da tela cheia" : "Abrir transmissão em tela cheia");
  button.innerHTML = isActive
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/></svg><span>Sair da tela cheia</span>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg><span>Tela cheia</span>';
}

function exitDiscordFullscreen() {
  if (!fullscreenState) return;
  const { card, placeholder, exitButton } = fullscreenState;
  exitButton?.remove();
  card.classList.remove(FULLSCREEN_CLASS);
  document.body.classList.remove(BODY_FULLSCREEN_CLASS);
  document.documentElement.classList.remove(BODY_FULLSCREEN_CLASS);
  updateFullscreenButton(card, false);
  if (placeholder?.parentNode) placeholder.replaceWith(card);
  fullscreenState = null;
}

function enterDiscordFullscreen(card) {
  if (!card || fullscreenState?.card === card) return;
  if (fullscreenState) exitDiscordFullscreen();

  const parent = card.parentNode;
  if (!parent) return;
  const placeholder = document.createComment("resenhazinha-fullscreen-v422");
  parent.insertBefore(placeholder, card);
  document.body.appendChild(card);

  const exitButton = document.createElement("button");
  exitButton.type = "button";
  exitButton.className = "screen-fullscreen-exit-v422";
  exitButton.setAttribute("aria-label", "Sair da tela cheia");
  exitButton.title = "Sair da tela cheia";
  exitButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/></svg>';
  card.append(exitButton);

  fullscreenState = { card, placeholder, exitButton };
  card.classList.add(FULLSCREEN_CLASS);
  document.body.classList.add(BODY_FULLSCREEN_CLASS);
  document.documentElement.classList.add(BODY_FULLSCREEN_CLASS);
  updateFullscreenButton(card, true);

  exitButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    exitDiscordFullscreen();
  });
}

function toggleDiscordFullscreen(card) {
  if (fullscreenState?.card === card) exitDiscordFullscreen();
  else enterDiscordFullscreen(card);
}

function enhanceScreenCards() {
  document.querySelectorAll(".screen-stream-card").forEach((card) => {
    const button = card.querySelector(".screen-card-fullscreen-v42");
    if (button) button.dataset.fullscreenV422 = "ready";
  });
}

function handleFullscreenClick(event) {
  const button = event.target.closest?.(".screen-card-fullscreen-v42");
  if (!button) return;
  const card = button.closest(".screen-stream-card");
  if (!card) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  toggleDiscordFullscreen(card);
}

function handleFullscreenDoubleClick(event) {
  const video = event.target.closest?.(".screen-stream-card video");
  if (!video) return;
  const card = video.closest(".screen-stream-card");
  if (!card) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  toggleDiscordFullscreen(card);
}

function bootV422() {
  replaceEmojiPicker();
  enhanceScreenCards();

  document.addEventListener("click", handleFullscreenClick, true);
  document.addEventListener("dblclick", handleFullscreenDoubleClick, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fullscreenState) {
      event.preventDefault();
      exitDiscordFullscreen();
    }
  }, true);

  const observer = new MutationObserver(() => {
    replaceEmojiPicker();
    enhanceScreenCards();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootV422, { once: true });
else bootV422();
