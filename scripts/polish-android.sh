#!/usr/bin/env bash
# Landscape, immersive-ish theme, keep screen on, back button → JS event,
# REQUEST_INSTALL_PACKAGES + JavascriptInterface for in-app APK updates.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AND="$ROOT/android"
test -d "$AND"

# The build workflow later adds the signing config. Put its reference in the
# release build type (not in signingConfigs.release) before that step runs.
python3 - <<'PY'
from pathlib import Path
import re

build_file = Path("android/app/build.gradle")
if build_file.exists():
    text = build_file.read_text()

    def block_end(source, opening_brace):
        depth = 0
        for index in range(opening_brace, len(source)):
            if source[index] == "{":
                depth += 1
            elif source[index] == "}":
                depth -= 1
                if depth == 0:
                    return index
        raise SystemExit(f"Unmatched '{{' in {build_file}")

    build_types = re.search(r"\bbuildTypes\s*\{", text)
    if build_types:
        build_types_open = text.index("{", build_types.start())
        build_types_close = block_end(text, build_types_open)
        release = re.search(r"\brelease\s*\{", text[build_types_open + 1:build_types_close])
        if release:
            release_open = build_types_open + 1 + release.end() - 1
            release_close = block_end(text, release_open)
            release_body = text[release_open + 1:release_close]
            if not re.search(r"\bsigningConfig\s+signingConfigs\.release\b", release_body):
                text = text[:release_open + 1] + "\n            signingConfig signingConfigs.release" + text[release_open + 1:]
                build_file.write_text(text)
                print(f"Added release signingConfig to {build_file}")
        else:
            raise SystemExit(f"No release build type found in {build_file}")
    else:
        raise SystemExit(f"No buildTypes block found in {build_file}")
PY

# build-release.yml uses Pillow to normalize the launcher icons and splash image.
if ! python3 -c 'from PIL import Image' >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y python3-pil
fi

MANIFEST="$AND/app/src/main/AndroidManifest.xml"
# Force landscape on the main activity
if grep -q 'android:screenOrientation' "$MANIFEST"; then
  sed -i 's/android:screenOrientation="[^"]*"/android:screenOrientation="sensorLandscape"/' "$MANIFEST"
else
  sed -i 's/<activity /<activity android:screenOrientation="sensorLandscape" /' "$MANIFEST"
fi

# Permission to install packages (Android 8+)
if ! grep -q 'REQUEST_INSTALL_PACKAGES' "$MANIFEST"; then
  sed -i 's|<application |<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n    <application |' "$MANIFEST"
  echo "Added REQUEST_INSTALL_PACKAGES"
fi

# FileProvider for APK install
if ! grep -q 'androidx.core.content.FileProvider' "$MANIFEST"; then
  python3 - <<'PY'
from pathlib import Path
p = Path("android/app/src/main/AndroidManifest.xml")
t = p.read_text()
provider = '''
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
'''
if "</application>" in t and "fileprovider" not in t.lower():
    t = t.replace("</application>", provider + "\n    </application>", 1)
    p.write_text(t)
    print("Added FileProvider to manifest")
PY
fi

# file_paths.xml
XMLDIR="$AND/app/src/main/res/xml"
mkdir -p "$XMLDIR"
cat > "$XMLDIR/file_paths.xml" << 'XML'
<?xml version="1.0" encoding="utf-8"?>
<paths>
    <cache-path name="apk_cache" path="." />
    <external-cache-path name="apk_ext_cache" path="." />
    <files-path name="apk_files" path="." />
</paths>
XML

# styles — full screen / black background.
STYLES="$AND/app/src/main/res/values/styles.xml"
mkdir -p "$(dirname "$STYLES")"
cat > "$STYLES" << 'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.NoActionBar">
        <item name="android:background">#0A0C10</item>
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
    </style>
    <style name="AppTheme.NoActionBar" parent="AppTheme">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">#0A0C10</item>
    </style>
    <style name="AppTheme.NoActionBarLaunch" parent="AppTheme.NoActionBar" />
</resources>
XML

# Android's resource compiler rejects some source PNG encodings.
if [ -f "$ROOT/og.png" ] || [ -f "$ROOT/www/og.png" ]; then
  SRC="$ROOT/og.png"
  [ -f "$ROOT/www/og.png" ] && SRC="$ROOT/www/og.png"
  mkdir -p "$AND/app/src/main/res/drawable"
  python3 - "$SRC" "$AND/app/src/main/res/drawable/splash.png" <<'PY'
from PIL import Image, ImageOps
import sys

with Image.open(sys.argv[1]) as source:
    image = ImageOps.exif_transpose(source).convert("RGBA")
    image.thumbnail((512, 512), Image.Resampling.LANCZOS)
    image.save(sys.argv[2], format="PNG", optimize=True)
print(f"Normalized splash image to {sys.argv[2]}")
PY
fi

# MainActivity tweaks: keep screen on + back button to JS + APK install bridge
MAIN=$(find "$AND/app/src/main/java" -name 'MainActivity.java' | head -1)
if [ -n "$MAIN" ] && [ -f "$MAIN" ]; then
  python3 - << PY
from pathlib import Path
p = Path("$MAIN")
t = p.read_text()

# imports
for imp in [
    "import android.view.WindowManager;",
    "import android.webkit.WebView;",
    "import android.webkit.JavascriptInterface;",
    "import android.util.Base64;",
    "import android.content.Intent;",
    "import android.net.Uri;",
    "import android.os.Build;",
    "import androidx.core.content.FileProvider;",
    "import java.io.File;",
    "import java.io.FileOutputStream;",
]:
    if imp not in t:
        # insert after package line's first import block
        if "import " in t:
            t = t.replace("import ", imp + "\nimport ", 1)
        else:
            t = imp + "\n" + t

# keep screen on
if "FLAG_KEEP_SCREEN_ON" not in t:
    needle = "super.onCreate(savedInstanceState);"
    inject = """super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(
            android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
            | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );"""
    if needle in t:
        t = t.replace(needle, inject, 1)

# bridge registration after load / onCreate — append helper methods before final }
if "__riftInstallApk" not in t and "installApkBase64" not in t:
    bridge = r'''
    private void attachRiftBridge() {
        try {
            WebView web = (WebView) this.bridge.getWebView();
            if (web == null) return;
            web.getSettings().setJavaScriptEnabled(true);
            web.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public boolean installApkBase64(String b64, String fileName) {
                    try {
                        if (b64 == null || b64.length() == 0) return false;
                        byte[] data = Base64.decode(b64, Base64.DEFAULT);
                        File dir = getCacheDir();
                        String name = (fileName == null || fileName.length() == 0) ? "rift-update.apk" : fileName;
                        if (!name.endsWith(".apk")) name = name + ".apk";
                        File out = new File(dir, name);
                        FileOutputStream fos = new FileOutputStream(out);
                        fos.write(data);
                        fos.close();
                        Uri uri;
                        if (Build.VERSION.SDK_INT >= 24) {
                            uri = FileProvider.getUriForFile(
                                MainActivity.this,
                                getPackageName() + ".fileprovider",
                                out
                            );
                        } else {
                            uri = Uri.fromFile(out);
                        }
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(uri, "application/vnd.android.package-archive");
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(intent);
                        return true;
                    } catch (Exception e) {
                        e.printStackTrace();
                        return false;
                    }
                }
            }, "Android");
            // Also expose a pure-JS callable that the web layer looks for
            web.evaluateJavascript(
                "(function(){try{window.__riftInstallApk=function(b64,name){try{return !!(window.Android&&window.Android.installApkBase64(b64,name||'rift-update.apk'));}catch(e){return false;}}; }catch(e){}})();",
                null
            );
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        attachRiftBridge();
    }
'''
    # onBackPressed if missing
    if "onBackPressed" not in t:
        bridge += r'''
    @Override
    public void onBackPressed() {
        WebView web = (WebView) this.bridge.getWebView();
        if (web != null) {
            web.evaluateJavascript(
                "(function(){try{if(window.__riftNativeBack){window.__riftNativeBack();return;}var p=document.getElementById('panel');if(p){p.classList.add('on');}}catch(e){}})();",
                null
            );
            return;
        }
        super.onBackPressed();
    }
'''
    t = t.rstrip()
    if t.endswith("}"):
        t = t[:-1] + bridge + "\n}\n"
    p.write_text(t)
    print("Patched MainActivity with APK install bridge:", p)
else:
    # already has bridge? still ensure onBackPressed
    if "onBackPressed" not in t:
        t = t.rstrip()
        if t.endswith("}"):
            t = t[:-1] + r'''
    @Override
    public void onBackPressed() {
        WebView web = (WebView) this.bridge.getWebView();
        if (web != null) {
            web.evaluateJavascript(
                "(function(){try{if(window.__riftNativeBack){window.__riftNativeBack();return;}var p=document.getElementById('panel');if(p){p.classList.add('on');}}catch(e){}})();",
                null
            );
            return;
        }
        super.onBackPressed();
    }
}
'''
            p.write_text(t)
            print("Patched MainActivity onBackPressed:", p)

  # also call attach after onCreate if present
  if "attachRiftBridge" in p.read_text() and "attachRiftBridge();" not in p.read_text().split("onCreate")[1][:800] if "onCreate" in p.read_text() else True:
    tt = p.read_text()
    if "attachRiftBridge();" not in tt:
      # inject at end of onCreate is hard; onStart handles it
      pass
fi

echo "Android polish applied"
