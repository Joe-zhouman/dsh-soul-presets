#!/bin/sh
# One-click installer for dsh-soul-presets (macOS / Linux).
# Pass the same options as scripts/install.mjs, for example:
#   ./install.sh --profile web
#   ./install.sh --check
set -eu
exec node "$(dirname "$0")/scripts/install.mjs" "$@"
