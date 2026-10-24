#!/bin/bash
# Explicit operator step inside the publisher Sandbox: installs one commit's code next to the brain on the Drive.
# Usage: install-release.sh <full-commit-sha> <sandbox-image-ref>
set -euo pipefail
sha=$1 image=$2
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "expected a full commit SHA" >&2; exit 2; }
[[ $image == *@sha256:* ]] || { echo "expected a digest-pinned image" >&2; exit 2; }
bun_version=1.4.4
# Overridable only for the installer's own tests; sudo drops both in the Sandbox.
root=${GBRAIN_INSTALL_ROOT:-/data}
repo=${GBRAIN_INSTALL_REPO:-https://github.com/stetig-tech/gbrain.git}
tools=$root/tools
bun_dir=$tools/bun-$bun_version
release=$root/app/$sha

if [ ! -x "$bun_dir/bin/bun" ]; then
  case $(uname -m) in x86_64) bun_asset=bun-linux-x64 ;; aarch64) bun_asset=bun-linux-aarch64 ;; *) echo "unsupported arch" >&2; exit 2 ;; esac
  work=$(mktemp -d)
  curl -fsSLo "$work/$bun_asset.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/$bun_asset.zip"
  curl -fsSLo "$work/SHASUMS256.txt" "https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/SHASUMS256.txt"
  (cd "$work" && grep " $bun_asset.zip\$" SHASUMS256.txt | sha256sum -c -)
  unzip -q "$work/$bun_asset.zip" -d "$work"
  mkdir -p "$tools" "$work/stage/bin"
  mv "$work/$bun_asset/bun" "$work/stage/bin/bun"
  rm -rf "$bun_dir.partial" && mv "$work/stage" "$bun_dir.partial" && mv "$bun_dir.partial" "$bun_dir"
  rm -rf "$work"
fi
[ "$("$bun_dir/bin/bun" --version)" = "$bun_version" ] || { echo "Bun version mismatch" >&2; exit 1; }
export PATH=$bun_dir/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

manifest() { printf '{"sha":"%s","bun":"%s","lockfile_sha256":"%s","image":"%s"}\n' "$sha" "$bun_version" "$(sha256sum "$release/bun.lock" | cut -d' ' -f1)" "$image"; }
if [ -f "$release/.gbrain-release.json" ] && [ -f "$release/bun.lock" ] \
  && [ "$(git -C "$release" rev-parse HEAD 2>/dev/null)" = "$sha" ] \
  && [ -z "$(git -C "$release" status --porcelain --untracked-files=no)" ] \
  && [ "$(cat "$release/.gbrain-release.json")" = "$(manifest)" ]; then
  echo "release $sha already installed"; cat "$release/.gbrain-release.json"; exit 0
fi
# A release directory holds only code; the brain, ownership files and .gbrain live elsewhere on the Drive.
# A mismatched, corrupted or interrupted release is therefore reinstalled from scratch.
rm -rf "$release"
mkdir -p "$root/app"
git init --quiet "$release"
git -C "$release" fetch --quiet --depth 1 -- "$repo" "$sha"
git -C "$release" -c advice.detachedHead=false checkout --quiet FETCH_HEAD
[ "$(git -C "$release" rev-parse HEAD)" = "$sha" ] || { echo "HEAD mismatch" >&2; exit 1; }
(cd "$release" && bun install --frozen-lockfile --ignore-scripts)
[ -z "$(git -C "$release" status --porcelain --untracked-files=no)" ] || { echo "release tree is not clean" >&2; exit 1; }
(cd "$release" && GBRAIN_HOME=$(mktemp -d) bun --no-env-file -e '
  const { nativeLockCapability } = await import("./src/core/persistence/native-lock.ts");
  console.log(JSON.stringify(await nativeLockCapability()));
  await import("./src/deployment/worker.ts").catch(e => { if (!String(e?.message).includes("Sandbox Drive is not initialized")) throw e; });
')
install -m 0755 "$release/deploy/vercel/git-credential.sh" "$tools/git-credential.sh.partial" && mv "$tools/git-credential.sh.partial" "$tools/git-credential.sh"
manifest > "$release/.gbrain-release.json.partial"
mv "$release/.gbrain-release.json.partial" "$release/.gbrain-release.json"
cat "$release/.gbrain-release.json"
