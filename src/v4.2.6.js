import "./v4.2.6.css";

const BAR_CLASS = "resenhazinha-titlebar-v426";
const BODY_CLASS = "has-custom-titlebar-v426";

const ICONS = {
  minimize: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5h8"/></svg>',
  maximize: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx=".4"/></svg>',
  restore: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 3h5v5"/><path d="M3 4h5v5H3z"/></svg>',
  close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7"/></svg>',
};

function currentServerName() {
  const room = document.querySelector("#room-view");
  const serverName = document.querySelector("#server-name-display")?.textContent?.trim();
  return room && !room.hidden && serverName ? serverName : "Resenhazinha";
}

function syncTitle() {
  const center = document.querySelector(".resenhazinha-titlebar-center-v426");
  if (!center) return;
  const name = currentServerName();
  center.textContent = name;
  center.title = name;
  document.title = name === "Resenhazinha" ? "Resenhazinha" : `${name} • Resenhazinha`;
}

function setMaximizeIcon(maximized) {
  const button = document.querySelector('[data-window-action="toggle-maximize"]');
  if (!button) return;
  button.innerHTML = maximized ? ICONS.restore : ICONS.maximize;
  button.setAttribute("aria-label", maximized ? "Restaurar" : "Maximizar");
  button.dataset.tooltip = maximized ? "Restaurar" : "Maximizar";
}

async function refreshWindowState() {
  try {
    const state = await window.resenhazinhaDesktop?.getWindowState?.();
    setMaximizeIcon(Boolean(state?.maximized));
  } catch (_error) {}
}

function makeControl(action, label, icon, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `resenhazinha-window-control-v426 ${extraClass}`.trim();
  button.dataset.windowAction = action;
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon;
  return button;
}

function createBar() {
  if (!window.resenhazinhaDesktop?.isDesktop || document.querySelector(`.${BAR_CLASS}`)) return;

  document.querySelector(".resenhazinha-titlebar-v425")?.remove();
  document.body.classList.remove("has-custom-titlebar-v425");

  const bar = document.createElement("div");
  bar.className = BAR_CLASS;

  const left = document.createElement("div");
  left.className = "resenhazinha-titlebar-left-v426";
  left.innerHTML = '<span class="resenhazinha-titlebar-mark-v426">R</span><span>Resenhazinha</span>';

  const center = document.createElement("div");
  center.className = "resenhazinha-titlebar-center-v426";
  center.textContent = "Resenhazinha";

  const controls = document.createElement("div");
  controls.className = "resenhazinha-window-controls-v426";
  controls.append(
    makeControl("minimize", "Minimizar", ICONS.minimize),
    makeControl("toggle-maximize", "Maximizar", ICONS.maximize),
    makeControl("close", "Fechar", ICONS.close, "is-close"),
  );

  bar.append(left, center, controls);
  document.body.prepend(bar);
  document.body.classList.add(BODY_CLASS);

  controls.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-window-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const state = await window.resenhazinhaDesktop?.windowAction?.(button.dataset.windowAction);
      if (button.dataset.windowAction === "toggle-maximize") setMaximizeIcon(Boolean(state?.maximized));
    } catch (_error) {}
  });

  bar.addEventListener("dblclick", async (event) => {
    if (event.target.closest(".resenhazinha-window-controls-v426")) return;
    try {
      const state = await window.resenhazinhaDesktop?.windowAction?.("toggle-maximize");
      setMaximizeIcon(Boolean(state?.maximized));
    } catch (_error) {}
  });

  syncTitle();
  refreshWindowState();

  window.resenhazinhaDesktop?.onWindowState?.((state) => {
    setMaximizeIcon(Boolean(state?.maximized));
  });

  const serverName = document.querySelector("#server-name-display");
  if (serverName) new MutationObserver(syncTitle).observe(serverName, { childList: true, subtree: true, characterData: true });

  const room = document.querySelector("#room-view");
  if (room) new MutationObserver(syncTitle).observe(room, { attributes: true, attributeFilter: ["hidden"] });
}

function boot() {
  createBar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
