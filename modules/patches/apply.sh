#!/usr/bin/env bash
# Brings a module page (index.html) up to the current platform standard by applying every module patch IN ORDER.
# Each patch is idempotent: on a page that already has a feature it changes nothing.
#   bash modules/patches/apply.sh <path/to/index.html> [more pages…]     apply (edits the files)
#   bash modules/patches/apply.sh --check <path/to/index.html> […]      report only: ✅ up to date / ❌ missing features
# A patch that cannot find its anchor stops with an AssertionError: that page was built from a different template —
# copy the app code of a current model module (introduction-to-pathology) instead of patching by hand.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; NAV="$HERE/../platform-nav.js"
ORDER=(assess-gate quiz-pw retire-class-pw assess-tab-pw pw-mask quiz-list-first assess-compact att-code-only stu-header sync-cursor pw-copy quick-panel copy-groups topic-quizzes topic-order picture-import slide-bold teacher-board att-teacher-short att-code-big)
check=0; if [ "${1:-}" = "--check" ]; then check=1; shift; fi
[ $# -ge 1 ] || { echo "usage: $0 [--check] index.html [...]"; exit 2; }
for page in "$@"; do
  target="$page"
  if [ $check = 1 ]; then target="$(mktemp --suffix=.html)"; cp "$page" "$target"; fi
  for p in "${ORDER[@]}"; do python3 "$HERE/$p.py" "$target" >/dev/null; done
  python3 "$HERE/navblock.py" "$NAV" "$target" >/dev/null      # the platform block = modules/platform-nav.js
  if [ $check = 1 ]; then
    if cmp -s "$page" "$target"; then echo "✅ $page is up to date"; else echo "❌ $page is missing platform features — run: bash $0 $page"; fi
    rm -f "$target"
  else echo "applied: $page"; fi
done
