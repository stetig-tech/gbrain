#!/bin/sh
# Git credential-helper protocol: only a GitHub HTTPS read can receive this token.
[ "$1" = get ] || exit 0
protocol=
host=
while IFS='=' read -r key value; do
  [ -n "$key" ] || break
  case "$key" in protocol) protocol=$value ;; host) host=$value ;; esac
done
[ "$protocol" = https ] && [ "$host" = github.com ] && [ -n "$GBRAIN_GIT_TOKEN" ] || exit 0
printf 'username=x-access-token\npassword=%s\n' "$GBRAIN_GIT_TOKEN"
