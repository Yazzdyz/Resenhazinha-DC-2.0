import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const androidRoot = path.join(mobileRoot, "android");
const manifestPath = path.join(androidRoot, "app/src/main/AndroidManifest.xml");

let manifest = await readFile(manifestPath, "utf8");

const permissions = [
  "android.permission.INTERNET",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.CAMERA",
  "android.permission.REQUEST_INSTALL_PACKAGES",
];

for (const permission of permissions) {
  if (!manifest.includes(`android:name="${permission}"`)) {
    manifest = manifest.replace(
      /<application\b/,
      `<uses-permission android:name="${permission}" />\n\n    <application`,
    );
  }
}

manifest = manifest.replace(
  /android:configChanges="([^"]+)"/,
  (_, value) => {
    const parts = value.split("|").filter(Boolean);
    if (!parts.includes("density")) parts.push("density");
    return `android:configChanges="${parts.join("|")}"`;
  },
);

const provider = `
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="com.yazzdyz.resenhazinha.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
`;

if (!manifest.includes("com.yazzdyz.resenhazinha.fileprovider")) {
  manifest = manifest.replace(/<\/application>/, `${provider}    </application>`);
}

await writeFile(manifestPath, manifest);

const resXmlDir = path.join(androidRoot, "app/src/main/res/xml");
await mkdir(resXmlDir, { recursive: true });

await writeFile(
  path.join(resXmlDir, "file_paths.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <cache-path name="updates" path="updates/" />
</paths>
`,
);

const javaRoot = path.join(androidRoot, "app/src/main/java");
const findMainActivity = async (dir) => {
  const entries = await (await import("node:fs/promises")).readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findMainActivity(full);
      if (found) return found;
    } else if (entry.name === "MainActivity.java") {
      return full;
    }
  }
  return null;
};

const mainActivityPath = await findMainActivity(javaRoot);
if (!mainActivityPath) {
  throw new Error("MainActivity.java não encontrado.");
}

const mainActivity = await readFile(mainActivityPath, "utf8");
const packageMatch = mainActivity.match(/^package\s+([a-zA-Z0-9_.]+);/m);
if (!packageMatch) {
  throw new Error("Não foi possível descobrir o package da MainActivity.");
}

const packageName = packageMatch[1];

const nativeCode = `package ${packageName};

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends BridgeActivity {
    private AndroidUpdater androidUpdater;

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        androidUpdater = new AndroidUpdater(this);
        getBridge().getWebView().addJavascriptInterface(androidUpdater, "AndroidUpdater");
        getBridge().getWebView().postDelayed(() -> androidUpdater.checkForUpdate(), 2200);
    }

    @Override
    public void onResume() {
        super.onResume();
        if (androidUpdater != null) {
            androidUpdater.resumePendingInstall();
        }
    }

    public static class AndroidUpdater {
        private final Context context;
        private final MainActivity activity;
        private static final String REPO = "Yazzdyz/Resenhazinha-DC-2.0";
        private volatile String pendingApkUrl;
        private volatile boolean waitingForInstallPermission;
        private volatile boolean checkRunning;

        AndroidUpdater(MainActivity activity) {
            this.activity = activity;
            this.context = activity;
        }

        @JavascriptInterface
        public void checkForUpdate() {
            if (checkRunning) return;
            checkRunning = true;
            new Thread(() -> {
                try {
                    checkForUpdateInternal();
                } finally {
                    checkRunning = false;
                }
            }, "resenhazinha-updater").start();
        }

        @JavascriptInterface
        public void installApk(String apkUrl) {
            if (!isAllowedApkUrl(apkUrl)) {
                toast("Link de atualização inválido.");
                return;
            }
            pendingApkUrl = apkUrl;
            new Thread(() -> downloadAndInstall(apkUrl), "resenhazinha-downloader").start();
        }

        @JavascriptInterface
        public String getCurrentVersion() {
            return getInstalledVersion();
        }

        public void resumePendingInstall() {
            if (!waitingForInstallPermission || !isInstallPermissionGranted() || pendingApkUrl == null) return;
            waitingForInstallPermission = false;
            String apkUrl = pendingApkUrl;
            new Thread(() -> downloadAndInstall(apkUrl), "resenhazinha-resume-installer").start();
        }

        private void checkForUpdateInternal() {
            String currentVersion = getInstalledVersion();
            try {
                URL url = new URL("https://api.github.com/repos/" + REPO + "/releases?per_page=20");
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "Resenhazinha-Android");
                connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.connect();

                if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) {
                    connection.disconnect();
                    notifyUpdateResult(false, false, currentVersion, null, null);
                    return;
                }

                StringBuilder body = new StringBuilder();
                try (InputStream input = connection.getInputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        body.append(new String(buffer, 0, count, java.nio.charset.StandardCharsets.UTF_8));
                    }
                } finally {
                    connection.disconnect();
                }

                org.json.JSONArray releases = new org.json.JSONArray(body.toString());
                String latestVersion = currentVersion;
                String latestApkUrl = null;

                for (int i = 0; i < releases.length(); i++) {
                    org.json.JSONObject release = releases.getJSONObject(i);
                    if (release.optBoolean("draft") || release.optBoolean("prerelease")) continue;

                    String tag = release.optString("tag_name", "");
                    if (!tag.regionMatches(true, 0, "mobile-v", 0, 8)) continue;

                    String version = tag.substring(8);
                    String[] versionParts = version.split("[.]");
                    if (versionParts.length != 3) continue;

                    
                    if (compareVersions(version, latestVersion) <= 0) continue;

                    org.json.JSONArray assets = release.optJSONArray("assets");
                    if (assets == null) continue;

                    for (int j = 0; j < assets.length(); j++) {
                        org.json.JSONObject asset = assets.getJSONObject(j);
                        String name = asset.optString("name", "");
                        String downloadUrl = asset.optString("browser_download_url", "");
                        if (name.toLowerCase(java.util.Locale.ROOT).endsWith(".apk") && isAllowedApkUrl(downloadUrl)) {
                            latestVersion = version;
                            latestApkUrl = downloadUrl;
                            break;
                        }
                    }
                }

                boolean available = latestApkUrl != null;
                notifyUpdateResult(true, available, currentVersion, latestVersion, latestApkUrl);

                if (available) {
                    showUpdateDialogNative(latestVersion, latestApkUrl);
                }
            } catch (Exception ignored) {
                notifyUpdateResult(false, false, currentVersion, null, null);
            }
        }

        private String getInstalledVersion() {
            try {
                android.content.pm.PackageInfo info =
                    context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                return info.versionName == null ? "0.0.0" : info.versionName;
            } catch (Exception ignored) {
                return "0.0.0";
            }
        }

        private int compareVersions(String left, String right) {
            String[] a = left.split("\\\\.");
            String[] b = right.split("\\\\.");
            for (int i = 0; i < 3; i++) {
                int av = i < a.length ? parsePart(a[i]) : 0;
                int bv = i < b.length ? parsePart(b[i]) : 0;
                if (av != bv) return Integer.compare(av, bv);
            }
            return 0;
        }

        private int parsePart(String value) {
            try {
                return Integer.parseInt(value.replaceAll("[^0-9].*", ""));
            } catch (Exception ignored) {
                return 0;
            }
        }

        private void notifyUpdateResult(
            boolean ok,
            boolean updateAvailable,
            String currentVersion,
            String latestVersion,
            String apkUrl
        ) {
            String current = org.json.JSONObject.quote(currentVersion == null ? "" : currentVersion);
            String latest = org.json.JSONObject.quote(latestVersion == null ? "" : latestVersion);
            String script =
                "window.__resenhazinhaUpdateResult && window.__resenhazinhaUpdateResult({ok:" +
                ok +
                ",updateAvailable:" +
                updateAvailable +
                ",currentVersion:" +
                current +
                ",latestVersion:" +
                latest +
                "})";

            activity.getBridge().getWebView().post(
                () -> activity.getBridge().getWebView().evaluateJavascript(script, null)
            );
        }

        private void showUpdateDialogNative(String version, String apkUrl) {
            activity.runOnUiThread(() -> {
                if (activity.isFinishing() || (Build.VERSION.SDK_INT >= 17 && activity.isDestroyed())) {
                    return;
                }

                new AlertDialog.Builder(activity)
                    .setTitle("Nova versão disponível")
                    .setMessage(
                        "A versão " + version + " do Resenhazinha está disponível.\\n\\n" +
                        "Você está usando a versão " + getInstalledVersion() + "."
                    )
                    .setNegativeButton("Agora não", null)
                    .setPositiveButton("Atualizar", (dialog, which) -> installApk(apkUrl))
                    .setCancelable(true)
                    .show();
            });
        }

        private boolean isAllowedApkUrl(String apkUrl) {
            if (apkUrl == null || apkUrl.isEmpty()) return false;
            try {
                Uri uri = Uri.parse(apkUrl);
                String scheme = uri.getScheme();
                String host = uri.getHost();
                return "https".equalsIgnoreCase(scheme)
                    && host != null
                    && (
                        host.equalsIgnoreCase("github.com")
                        || host.endsWith(".githubusercontent.com")
                    );
            } catch (Exception ignored) {
                return false;
            }
        }

        private boolean isInstallPermissionGranted() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
            return context.getPackageManager().canRequestPackageInstalls();
        }

        private void downloadAndInstall(String apkUrl) {
            if (!isAllowedApkUrl(apkUrl)) {
                toast("Link de atualização inválido.");
                return;
            }

            try {
                if (!isInstallPermissionGranted()) {
                    waitingForInstallPermission = true;
                    pendingApkUrl = apkUrl;

                    Intent settings = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + context.getPackageName())
                    );
                    settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(settings);
                    toast("Permita a instalação e volte ao Resenhazinha.");
                    return;
                }

                waitingForInstallPermission = false;

                File updateDir = new File(context.getCacheDir(), "updates");
                if (!updateDir.exists() && !updateDir.mkdirs()) {
                    throw new IllegalStateException("Não foi possível criar a pasta de atualização.");
                }

                File tempFile = new File(updateDir, "resenhazinha-update.apk.part");
                File apkFile = new File(updateDir, "resenhazinha-update.apk");

                URL url = new URL(apkUrl);
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setRequestProperty("User-Agent", "Resenhazinha-Android");
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(60000);
                connection.connect();

                int responseCode = connection.getResponseCode();
                if (responseCode < 200 || responseCode >= 300) {
                    throw new IllegalStateException("Falha HTTP " + responseCode);
                }

                try (
                    InputStream input = connection.getInputStream();
                    FileOutputStream output = new FileOutputStream(tempFile)
                ) {
                    byte[] buffer = new byte[16384];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        output.write(buffer, 0, count);
                    }
                } finally {
                    connection.disconnect();
                }

                if (!tempFile.exists() || tempFile.length() < 1024) {
                    throw new IllegalStateException("APK baixado está vazio ou incompleto.");
                }

                if (apkFile.exists() && !apkFile.delete()) {
                    throw new IllegalStateException("Não foi possível substituir o APK anterior.");
                }

                if (!tempFile.renameTo(apkFile)) {
                    throw new IllegalStateException("Não foi possível finalizar o download.");
                }

                Uri apkUri = FileProvider.getUriForFile(
                    context,
                    "com.yazzdyz.resenhazinha.fileprovider",
                    apkFile
                );

                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(install);
            } catch (Exception error) {
                toast("Não foi possível baixar a atualização.");
            }
        }

        private void toast(String message) {
            android.os.Handler handler = new android.os.Handler(context.getMainLooper());
            handler.post(() -> Toast.makeText(context, message, Toast.LENGTH_LONG).show());
        }
    }
}

`;

await writeFile(mainActivityPath, nativeCode);
const mobilePackage = JSON.parse(
  await readFile(path.join(mobileRoot, "package.json"), "utf8"),
);
const mobileVersion = String(mobilePackage.version || "1.0.0").trim();
const versionParts = mobileVersion.split(".").map((part) => Number.parseInt(part, 10) || 0);
const mobileVersionCode =
  versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2];

const appGradlePath = path.join(androidRoot, "app/build.gradle");
let appGradle = await readFile(appGradlePath, "utf8");

if (!/compileSdk(?:Version)?\s+/.test(appGradle)) {
  appGradle = appGradle.replace(
    /android\s*\{/,
    "android {\n    compileSdk 36",
  );
}

const defaultConfigNeedle = /defaultConfig\s*\{/;
if (!defaultConfigNeedle.test(appGradle)) {
  throw new Error("defaultConfig não encontrado no build.gradle.");
}

appGradle = appGradle.replace(
  defaultConfigNeedle,
  `defaultConfig {
        versionCode ${mobileVersionCode}
        versionName "${mobileVersion}"`,
);

if (!appGradle.includes("signingConfigs {")) {
  appGradle = appGradle.replace(
    /android\s*\{/,
    `android {
    signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_FILE") ?: "release.keystore")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
            keyAlias System.getenv("ANDROID_KEY_ALIAS") ?: ""
            keyPassword System.getenv("ANDROID_KEY_PASSWORD") ?: ""
        }
    }`,
  );
}

if (!/signingConfig\s+signingConfigs\.release/.test(appGradle)) {
  appGradle = appGradle.replace(
    /buildTypes\s*\{/,
    `buildTypes {
        release {
            signingConfig signingConfigs.release
        }`,
  );
}

await writeFile(appGradlePath, appGradle);

