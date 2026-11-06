#!/usr/bin/env bash
# Landscape, immersive-ish theme, keep screen on, back button → JS event.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AND="$ROOT/android"
test -d "$AND"

MANIFEST="$AND/app/src/main/AndroidManifest.xml"
# Force landscape on the main activity
if grep -q 'android:screenOrientation' "$MANIFEST"; then
  sed -i 's/android:screenOrientation="[^"]*"/android:screenOrientation="sensorLandscape"/' "$MANIFEST"
else
  sed -i 's/<activity /<activity android:screenOrientation="sensorLandscape" /' "$MANIFEST"
fi

# styles — full screen / black background
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
</resources>
XML

# Splash uses og.png if present
if [ -f "$ROOT/og.png" ] || [ -f "$ROOT/www/og.png" ]; then
  SRC="$ROOT/og.png"
  [ -f "$ROOT/www/og.png" ] && SRC="$ROOT/www/og.png"
  mkdir -p "$AND/app/src/main/res/drawable"
  cp "$SRC" "$AND/app/src/main/res/drawable/splash.png"
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
