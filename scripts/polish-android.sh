#!/usr/bin/env bash
# Landscape, immersive-ish theme, keep screen on, back button → JS event.
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

# styles — full screen / black background. Capacitor's generated manifest
# references AppTheme.NoActionBarLaunch, so retain that resource when
# replacing its generated styles.
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

# Android's resource compiler rejects some source PNG encodings. Normalize the
# optional Open Graph image into a small, baseline-compatible PNG before use.
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

# MainActivity tweaks: keep screen on + back button to JS
MAIN=$(find "$AND/app/src/main/java" -name 'MainActivity.java' | head -1)
if [ -n "$MAIN" ] && [ -f "$MAIN" ]; then
  if ! grep -q 'keepScreenOn' "$MAIN"; then
    # Insert after onCreate setContent / bridge load — simple append of methods before last }
    python3 - << PY
from pathlib import Path
p = Path("$MAIN")
t = p.read_text()
if "FLAG_KEEP_SCREEN_ON" not in t:
    if "import android.view.WindowManager" not in t:
        t = t.replace("import ", "import android.view.WindowManager;\nimport android.webkit.WebView;\nimport ", 1)
    # after super.onCreate
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
    if "onBackPressed" not in t:
        t = t.rstrip()
        if t.endswith("}"):
            t = t[:-1] + """
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
"""
    p.write_text(t)
    print("Patched MainActivity:", p)
PY
  fi
fi

echo "Android polish applied"
