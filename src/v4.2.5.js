import "./v4.2.5.css";

const TITLEBAR_CLASS = "resenhazinha-titlebar-v425";
const BODY_TITLEBAR_CLASS = "has-custom-titlebar-v425";
const FULLSCREEN_CLASS = "is-discord-fullscreen-v422";

const ENTER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg>';
const EXIT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/></svg>';

function currentServerName() {
  const room = document.querySelector("#room-view");
  const serverName = document.querySelector("#server-name-display")?.textContent?.trim();
  return room && !room.hidden && serverName ? serverName : "Resenhazinha";
}

function syncWindowTitle() {
  const label = document.querySelector(".resenhazinha-titlebar-center-v425");
  if (!label) return;
  const name = currentServerName();
  label.textContent = name;
  label.title = name;
  document.title = name === "Resenhazinha" ? "Resenhazinha" : `${name} • Resenhazinha`;
}

function createCustomTitlebar() {
  if (!window.resenhazinhaDesktop?.isDesktop || document.querySelector(`.${TITLEBAR_CLASS}`)) return;

  const bar = document.createElement("div");
  bar.className = TITLEBAR_CLASS;
  bar.setAttribute("aria-hidden", "true");
  bar.innerHTML = `
    <div class="resenhazinha-titlebar-left-v425">
      <span class="resenhazinha-titlebar-mark-v425">R</span>
      <span class="resenhazinha-titlebar-brand-v425">Resenhazinha</span>
    </div>
    <div class="resenhazinha-titlebar-center-v425">Resenhazinha</div>
    <div class="resenhazinha-titlebar-controls-space-v425"></div>
  `;

  document.body.prepend(bar);
  document.body.classList.add(BODY_TITLEBAR_CLASS);
  syncWindowTitle();

  const name = document.querySelector("#server-name-display");
  if (name) {
    new MutationObserver(syncWindowTitle).observe(name, { childList: true, subtree: true, characterData: true });
  }

  const room = document.querySelector("#room-view");
  if (room) {
    new MutationObserver(syncWindowTitle).observe(room, { attributes: true, attributeFilter: ["hidden"] });
  }
}

function decorateFullscreenButton(button, exitMode) {
  if (!button) return;
  const label = exitMode ? "Sair da tela cheia" : "Tela cheia";
  const icon = exitMode ? EXIT_ICON : ENTER_ICON;
  const state = exitMode ? "exit" : "enter";

  if (button.dataset.fullscreenIconV425 !== state || button.querySelector("span")) {
    button.innerHTML = icon;
    button.dataset.fullscreenIconV425 = state;
  }

  button.dataset.tooltipV425 = label;
  button.setAttribute("aria-label", label);
  button.removeAttribute("title");
}

function syncFullscreenControls() {
  document.querySelectorAll(".screen-stream-card").forEach((card) => {
    decorateFullscreenButton(
      card.querySelector(".screen-card-fullscreen-v42"),
      card.classList.contains(FULLSCREEN_CLASS)
    );
  });

  document.querySelectorAll(".screen-fullscreen-exit-v422").forEach((button) => {
    decorateFullscreenButton(button, true);
  });
}

function bootV425() {
  createCustomTitlebar();
  syncFullscreenControls();

  document.addEventListener("click", (event) => {
    if (event.target.closest?.(".screen-card-fullscreen-v42, .screen-fullscreen-exit-v422")) {
      requestAnimationFrame(syncFullscreenControls);
    }
  }, true);

  const observer = new MutationObserver(() => {
    requestAnimationFrame(syncFullscreenControls);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootV425, { once: true });
} else {
  bootV425();
}
