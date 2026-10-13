#!/bin/sh
# Workers Builds build step. Same changes as the build command in docs/cloudflare.md,
# without the shell operators that are easy to corrupt when pasting into the dashboard.
set -eu
cd "$(dirname "$0")/.."

if [ ! -f wrangler.toml ]; then
  echo "error: wrangler.toml is not in the cloned repository." >&2
  echo "The Workers Builds production branch must be the branch that contains this project." >&2
  exit 1
fi

cp wrangler.toml wrangler.build.toml
sed -i 's/database_id = "[^"]*"/database_id = "cb32937c-110c-4621-a236-0f7f6a8b7b2f"/' wrangler.build.toml
sed -i '/binding = "CACHE"/{n;s/id = "[^"]*"/id = "c22c95c3c6ae40a88fbcd4d52c8a5471"/;}' wrangler.build.toml
echo "wrangler.build.toml written"
