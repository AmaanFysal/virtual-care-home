#!/bin/sh
# Fails if a tracked doc credits Claude: an ADR or doc "Deciders:", "Authors:", "Written by:" or
# "Co-authored-by:" line naming Claude, or prose like "written by Claude" / "generated with Claude".
# Deliberately narrow: other mentions of Claude (the Claude API in the Phase 2 design, CLAUDE.md)
# are fine. The files that describe this rule (CLAUDE.md, .claude/, .githooks/, .github/) are skipped.
# Used by the no-ai-attribution GitHub Action and the pre-pr skill.
#
#   sh .githooks/check-doc-attribution.sh

cd "$(git rev-parse --show-toplevel)" || exit 2

credit_line='^[[:space:]]*([-*][[:space:]]*)?(\*\*)?(deciders|authors?|written by|created by|co-authored-by)(:\*\*|\*\*:|:).*claude'
credit_prose='(written|authored|drafted|generated|created)[[:space:]]+(by|with)[[:space:]]+\[?claude'

matches=$(git ls-files -z -- '*.md' '*.txt' ':!:CLAUDE.md' ':!:.claude/**' ':!:.githooks/**' ':!:.github/**' \
  | xargs -0 grep -inE -e "$credit_line" -e "$credit_prose" 2>/dev/null)

if [ -n "$matches" ]; then
  echo "Docs credit Claude (this repo never does; see CLAUDE.md):" >&2
  printf '%s\n' "$matches" | sed 's/^/  /' >&2
  exit 1
fi
echo "No Claude attribution in docs."
