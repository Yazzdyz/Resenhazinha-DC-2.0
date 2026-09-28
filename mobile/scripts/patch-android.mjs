import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const manifestPath = path.resolve("android/app/src/main/AndroidManifest.xml");
let manifest = await readFile(manifestPath, "utf8");

const permissions = [
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.CAMERA",
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

await writeFile(manifestPath, manifest);
