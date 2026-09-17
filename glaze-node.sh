#!/bin/sh
# glaze-managed-node-bootstrap

set -eu

minimum_node_major=24
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

case "$(uname -m)" in
  arm64)
    runtime_arch="arm64"
    ;;
  x86_64)
    runtime_arch="x64"
    ;;
  *)
    runtime_arch=""
    ;;
esac

node_binary=""
node_version_key=""
if [ -n "$runtime_arch" ]; then
  # Glaze's managed Node runtime lives in Application Support. The relative candidate covers
  # projects still in the hidden legacy layout; the glob covers projects in the visible Glaze
  # folder (GLAZE-860), where no stable relative path exists. Any flavor's runtime works, and
  # the newest acceptable Node wins.
  for runtime_root in "$script_dir/../../../node/runtime" "$HOME/Library/Application Support"/app.glaze.macos.main*/node/runtime; do
  for candidate in "$runtime_root"/node-v*-darwin-"$runtime_arch"/bin/node; do
    [ -x "$candidate" ] || continue
    candidate_info=$(
      "$candidate" -p 'const [major, minor, patch] = process.versions.node.split(".").map(Number); major + " " + (major * 1000000000000 + minor * 1000000 + patch)' 2>/dev/null || true
    )
    candidate_major=${candidate_info%% *}
    candidate_version_key=${candidate_info#* }
    case "$candidate_major:$candidate_version_key" in
      "":* | *[!0-9:]* | *:"")
        continue
        ;;
    esac
    if [ "$candidate_major" -ge "$minimum_node_major" ]; then
      if [ -z "$node_version_key" ] || [ "$candidate_version_key" -gt "$node_version_key" ]; then
        node_binary="$candidate"
        node_version_key="$candidate_version_key"
      fi
    fi
  done
  # The first root that yields an acceptable Node wins — later roots are fallbacks for projects
  # that no longer sit inside Application Support, not upgrades over a runtime already found.
  if [ -n "$node_binary" ]; then
    break
  fi
  done
fi

if [ -z "$node_binary" ]; then
  candidate=$(command -v node 2>/dev/null || true)
  if [ -n "$candidate" ]; then
    candidate_major=$(
      "$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true
    )
    case "$candidate_major" in
      "" | *[!0-9]*)
        ;;
      *)
        if [ "$candidate_major" -ge "$minimum_node_major" ]; then
          node_binary="$candidate"
        fi
        ;;
    esac
  fi
fi

if [ -z "$node_binary" ]; then
  echo "Glaze requires Node 24 or newer, but its managed runtime could not be found." >&2
  echo "Open or restart Glaze once, then retry this command." >&2
  exit 1
fi

node_bin_dir=$(dirname -- "$node_binary")
PATH="$node_bin_dir:$PATH"
export PATH

if [ "${1-}" = "--npm" ]; then
  shift
  exec "$node_bin_dir/npm" "$@"
fi

exec "$node_binary" "$script_dir/glaze.ts" "$@"
