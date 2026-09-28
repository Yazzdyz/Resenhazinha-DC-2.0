(() => {
  const MOBILE_VERSION = "1.0.12";
  const REPO = "Yazzdyz/Resenhazinha-DC-2.0";

  const isAndroidApp = () => {
    if (typeof window === "undefined") return false;
    const ua = String(navigator.userAgent || "");
    return /Android/i.test(ua) && (
      /ResenhazinhaMobile/i.test(ua) ||
      window.Capacitor?.getPlatform?.() === "android" ||
      typeof window.AndroidUpdater !== "undefined"
    );
  };

  const hasNativeUpdater = () =>
    typeof window !== "undefined" &&
    typeof window.AndroidUpdater?.installApk === "function";

  const parseVersion = (value) =>
    String(value || "")
      .replace(/^mobile-v/i, "")
      .replace(/^v/i, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)
      .slice(0, 3);

  const compareVersions = (left, right) => {
    const a = parseVersion(left);
    const b = parseVersion(right);
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
  };

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]));

  const showUpdateDialog = (release) => {
    if (document.getElementById("mobile-update-dialog")) return;

    const overlay = document.createElement("div");
    overlay.id = "mobile-update-dialog";
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:22px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="width:min(430px,100%);background:#17181c;color:#fff;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:24px;box-shadow:0 20px 70px rgba(0,0,0,.5);">
          <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#9ca3af;margin-bottom:8px;">RESENHAZINHA</div>
          <h2 style="margin:0 0 8px;font-size:22px;">Nova versão disponível</h2>
          <p style="margin:0 0 20px;color:#b9bbc2;line-height:1.5;">
            A versão <strong style="color:#fff;">${escapeHtml(release.version)}</strong> está disponível.
            Você está usando a <strong style="color:#fff;">${MOBILE_VERSION}</strong>.
          </p>
          <div style="display:flex;gap:10px;">
            <button id="mobile-update-later" style="flex:1;border:0;border-radius:10px;padding:12px;background:#292b31;color:#fff;font-weight:700;">Agora não</button>
            <button id="mobile-update-now" style="flex:1;border:0;border-radius:10px;padding:12px;background:#5865f2;color:#fff;font-weight:700;">Atualizar</button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector("#mobile-update-later").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#mobile-update-now").addEventListener("click", async () => {
      const button = overlay.querySelector("#mobile-update-now");
      button.disabled = true;
      button.textContent = "Preparando...";

      for (let attempt = 0; attempt < 40 && !hasNativeUpdater(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (!hasNativeUpdater()) {
        button.disabled = false;
        button.textContent = "Atualizar";
        window.open(release.apkUrl, "_blank");
        return;
      }

      button.textContent = "Baixando...";
      window.AndroidUpdater.installApk(release.apkUrl);
    });
  };

  window.__resenhazinhaShowUpdateDialog = (version, apkUrl) => {
    showUpdateDialog({ version: String(version || ""), apkUrl: String(apkUrl || "") });
  };

  window.__resenhazinhaUpdateResult = (payload) => {
    const status = document.getElementById("update-status-label");
    const button = document.getElementById("check-update-button");
    if (status) {
      if (payload?.updateAvailable) {
        status.textContent = `Versão ${payload.latestVersion} disponível.`;
      } else if (payload?.ok) {
        status.textContent = `Você já está na versão mais recente (${payload.latestVersion || payload.currentVersion || "atual"}).`;
      } else {
        status.textContent = "Não consegui verificar agora. Tente novamente daqui a pouco.";
      }
    }
    if (button) {
      button.disabled = false;
      button.textContent = "Verificar atualização";
    }
  };

  const checkForUpdate = async () => {
    if (!isAndroidApp()) return;
    if (hasNativeUpdater()) return;

    try {
      const response = await fetch(
        `https://api.github.com/repos/${REPO}/releases?per_page=20`,
        {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
        }
      );

      if (!response.ok) return;

      const releases = await response.json();
      const release = releases
        .filter(
          (item) =>
            !item.draft &&
            !item.prerelease &&
            /^mobile-v\d+\.\d+\.\d+$/i.test(item.tag_name)
        )
        .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];

      if (!release || compareVersions(release.tag_name, MOBILE_VERSION) <= 0) return;

      const apk = release.assets?.find((asset) => /.apk$/i.test(asset.name));
      if (!apk?.browser_download_url) return;

      showUpdateDialog({
        version: release.tag_name.replace(/^mobile-/i, ""),
        apkUrl: apk.browser_download_url,
      });
    } catch (error) {
      console.debug("Atualização Android indisponível:", error);
    }
  };

  const start = () => setTimeout(checkForUpdate, 1800);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();