#!/bin/bash
# One-command setup for running OpenTakeoff locally on a Mac:
#
#   curl -fsSL https://raw.githubusercontent.com/guluzz/opentakeoff/local-projects/scripts/setup-mac.sh | bash
#
# Clones the repo (or updates an existing ~/opentakeoff), builds the web app,
# and installs an OpenTakeoff.app launcher into /Applications.
set -e

BRANCH="${OPENTAKEOFF_BRANCH:-local-projects}"
REPO_URL="${OPENTAKEOFF_REPO:-https://github.com/guluzz/opentakeoff.git}"
REPO_DIR="${OPENTAKEOFF_DIR:-$HOME/opentakeoff}"
APP="/Applications/OpenTakeoff.app"

# --- prerequisites -----------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  echo "git not found — install the Xcode Command Line Tools first:"
  echo "  xcode-select --install"
  exit 1
fi

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [ -d "$HOME/.nvm/versions/node" ]; then
  NVM_NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node not found — install it first (e.g. 'brew install node'), then re-run."
  exit 1
fi

# --- clone or update ---------------------------------------------------------
if [ -d "$REPO_DIR/.git" ]; then
  echo "Updating existing checkout at $REPO_DIR ..."
  git -C "$REPO_DIR" fetch origin
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" pull --ff-only origin "$BRANCH"
else
  echo "Cloning into $REPO_DIR ..."
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
fi

# --- build -------------------------------------------------------------------
cd "$REPO_DIR/web"
npm install
npm run build

# --- launcher app ------------------------------------------------------------
echo "Installing $APP ..."
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/MacOS/OpenTakeoff" <<EOF
#!/bin/bash
exec "$REPO_DIR/scripts/launch.sh"
EOF
chmod +x "$APP/Contents/MacOS/OpenTakeoff"
chmod +x "$REPO_DIR/scripts/launch.sh"

cp "$REPO_DIR/scripts/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>OpenTakeoff</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>local.opentakeoff.launcher</string>
  <key>CFBundleName</key>
  <string>OpenTakeoff</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSUIElement</key>
  <string>1</string>
</dict>
</plist>
EOF

# Nudge Finder/LaunchServices to pick up the new bundle + icon
touch "$APP"

echo
echo "Done. Open OpenTakeoff from /Applications (or Spotlight)."
echo "It serves the app at http://localhost:5175 and opens it in Chrome."
