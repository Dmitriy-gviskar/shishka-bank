#!/bin/bash
# Cron wrapper. Configure explicit DB identity and encrypted, verified destinations.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/backup.mjs" "${SHISHKA_BACKUP_CONFIG:-/root/shishka-backup.json}"
