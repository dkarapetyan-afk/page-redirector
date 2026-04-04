#!/bin/bash

# Ensure we are in the correct directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Your API credentials (DO NOT COMMIT THESE TO SOURCE CONTROL)
ISSUER=${1:-""}
SECRET=${2:-""}

if [ -z "$ISSUER" ] || [ -z "$SECRET" ]; then
    echo "Usage: ./upload.sh <ISSUER> <SECRET>"
    echo "Get these from: https://addons.mozilla.org/en-US/developers/addon/api/key/"
    exit 1
fi

EXTENSION_ID="redirector@antigravity.test"
ZIP_FILE="redirector.zip"
VENV_PYTHON="./.venv/bin/python"

if [ ! -f "$VENV_PYTHON" ]; then
    echo "Virtual environment not found. Please create one with 'uv venv' and install 'pyjwt'."
    exit 1
fi

echo " Building WASM module for web target..."
(cd rs-vm && wasm-pack build --target web --out-dir pkg-web) || exit 1

echo " repackaging $ZIP_FILE..."
if [ -f "$ZIP_FILE" ]; then
  rm "$ZIP_FILE"
fi
zip -9 -r "$ZIP_FILE" ./* -x ".*" -x "*.sh" -x "*.py" -x "web-ext-*" -x "node_modules/*" -x "rs-vm/pkg-node/*" -x "rs-vm/src/*" -x "rs-vm/target/*" -x "rs-vm/Cargo.*" -x ".venv/*" -x "$ZIP_FILE" -x "test-*" -x "perf-*"

echo " Generating JWT token..."
TOKEN=$($VENV_PYTHON get_jwt.py "$ISSUER" "$SECRET")

if [ -z "$TOKEN" ]; then
    echo "Failed to generate token."
    exit 1
fi

echo " Uploading $ZIP_FILE for validation..."
UPLOAD_RESPONSE=$(curl "https://addons.mozilla.org/api/v5/addons/upload/" \
    -s -g -X POST \
    -H "Authorization: JWT $TOKEN" \
    -F "upload=@$ZIP_FILE" \
    -F "channel=unlisted")

# Extract the UUID using rudimentary grep/sed (to avoid requiring jq)
UPLOAD_UUID=$(echo "$UPLOAD_RESPONSE" | grep -o '"uuid":"[^"]*' | sed 's/"uuid":"//')

if [ -z "$UPLOAD_UUID" ]; then
    echo "Failed to upload or parse UUID."
    echo "Response: $UPLOAD_RESPONSE"
    exit 1
fi

echo " Upload successful. Validation ID: $UPLOAD_UUID"
echo " Waiting 5 seconds for AMO validation servers to process..."
sleep 5

# Generate a fresh token for the next request
TOKEN=$($VENV_PYTHON get_jwt.py "$ISSUER" "$SECRET")

echo " Creating new version for extension ID: $EXTENSION_ID..."
VERSION_RESPONSE=$(curl "https://addons.mozilla.org/api/v5/addons/addon/$EXTENSION_ID/versions/" \
    -s -g -X POST \
    -H "Authorization: JWT $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"upload\": \"$UPLOAD_UUID\"}")

echo " "
echo "==== AMO Response ===="
echo "$VERSION_RESPONSE"
echo "======================"

if echo "$VERSION_RESPONSE" | grep -q '"id"'; then
  echo " Successfully created new version!"
else
  echo " Failed to create new version. Check the response above."
  echo " The validation might still be processing. You can try again manually."
fi
