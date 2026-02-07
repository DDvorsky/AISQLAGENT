#!/bin/sh
set -e

MOUNT_POINT="/project"

# Try to read projectPath from init.json if no CIFS_PATH env var is set
if [ -z "$CIFS_PATH" ] && [ -f "$CONFIG_PATH" ]; then
  # Extract projectPath from init.json - handles both \\ and // UNC formats
  RAW_PATH=$(node -e "
    try {
      const c = require('$CONFIG_PATH');
      if (c.projectPath) console.log(c.projectPath);
    } catch(e) {}
  " 2>/dev/null || true)

  # Detect UNC path (starts with \\ or //)
  case "$RAW_PATH" in
    \\\\* | //*)
      # Convert backslashes to forward slashes for mount
      CIFS_PATH=$(echo "$RAW_PATH" | sed 's|\\|/|g')
      echo "Detected UNC project path: $CIFS_PATH"
      ;;
  esac
fi

# Mount CIFS share if path is available
if [ -n "$CIFS_PATH" ]; then
  echo "Mounting CIFS share: $CIFS_PATH -> $MOUNT_POINT"

  mkdir -p "$MOUNT_POINT"

  # Build mount options
  MOUNT_OPTS="file_mode=0777,dir_mode=0777,iocharset=utf8"
  if [ -n "$CIFS_USER" ]; then
    MOUNT_OPTS="$MOUNT_OPTS,username=$CIFS_USER"
  else
    MOUNT_OPTS="$MOUNT_OPTS,guest"
  fi
  if [ -n "$CIFS_PASS" ]; then
    MOUNT_OPTS="$MOUNT_OPTS,password=$CIFS_PASS"
  fi
  if [ -n "$CIFS_DOMAIN" ]; then
    MOUNT_OPTS="$MOUNT_OPTS,domain=$CIFS_DOMAIN"
  fi

  if mount -t cifs "$CIFS_PATH" "$MOUNT_POINT" -o "$MOUNT_OPTS" 2>&1; then
    echo "CIFS share mounted successfully"
  else
    echo "WARNING: Failed to mount CIFS share - continuing without project path"
  fi
fi

# Drop to nodejs user and start the app
exec su-exec nodejs node dist/index.js
