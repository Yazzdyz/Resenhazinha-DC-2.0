import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const androidRoot = path.join(mobileRoot, "android");
const manifestPath = path.join(androidRoot, "app/src/main/AndroidManifest.xml");

let manifest = await readFile(manifestPath, "utf8");

const permissions = [
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

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
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
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new AndroidUpdater(this), "AndroidUpdater");
    }

    public static class AndroidUpdater {
        private final Context context;

        AndroidUpdater(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public void installApk(String apkUrl) {
            new Thread(() -> downloadAndInstall(apkUrl)).start();
        }

        private void downloadAndInstall(String apkUrl) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                    !context.getPackageManager().canRequestPackageInstalls()) {
                    Intent settings = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + context.getPackageName())
                    );
                    settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(settings);
                    toast("Permita a instalação para continuar a atualização.");
                    return;
                }

                File updateDir = new File(context.getCacheDir(), "updates");
                if (!updateDir.exists() && !updateDir.mkdirs()) {
                    throw new IllegalStateException("Não foi possível criar a pasta de atualização.");
                }

                File apkFile = new File(updateDir, "resenhazinha-update.apk");
                URL url = new URL(apkUrl);
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.connect();

                if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) {
                    throw new IllegalStateException("Falha HTTP " + connection.getResponseCode());
                }

                try (InputStream input = connection.getInputStream();
                     FileOutputStream output = new FileOutputStream(apkFile)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        output.write(buffer, 0, count);
                    }
                } finally {
                    connection.disconnect();
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
const appGradlePath = path.join(androidRoot, "app/build.gradle");
let appGradle = await readFile(appGradlePath, "utf8");

if (!appGradle.includes("ANDROID_KEYSTORE_FILE")) {
  appGradle = appGradle.replace(
    /android\\s*\\{/,
    "android {\\n    signingConfigs {\\n        release {\\n            storeFile file(System.getenv(\"ANDROID_KEYSTORE_FILE\"))\\n            storePassword System.getenv(\"ANDROID_KEYSTORE_PASSWORD\")\\n            keyAlias System.getenv(\"ANDROID_KEY_ALIAS\")\\n            keyPassword System.getenv(\"ANDROID_KEY_PASSWORD\")\\n        }\\n    }",
  );

  appGradle = appGradle.replace(
    /buildTypes\\s*\\{/,
    "buildTypes {\\n        release {\\n            signingConfig signingConfigs.release\\n        }",
  );

  await writeFile(appGradlePath, appGradle);
}

