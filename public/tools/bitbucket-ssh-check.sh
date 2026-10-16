#!/usr/bin/env bash
# Read-only check: is this machine/user ready for Bitbucket's SSH hostname change
# (bitbucket.org -> ssh.bitbucket.org, deadline 2026-11-12)? Changes nothing.
#
# Usage:  bash bitbucket-ssh-check.sh [dir ...]     (default: ~ /var/www /opt /srv)
# Run it as EVERY user that runs git against Bitbucket — each has its own ~/.ssh.
# Exit code: 0 = ready, 1 = something to fix.
# Works with macOS bash 3.2 (no associative arrays).

set -u
NEW=ssh.bitbucket.org
ROOTS=("$@"); [ ${#ROOTS[@]} -eq 0 ] && ROOTS=("$HOME" /var/www /opt /srv)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FIX=0

if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'; else G=; R=; Y=; B=; N=; fi
ok()   { printf '  %sOK%s   %s\n' "$G" "$N" "$*"; }
fix()  { printf '  %sFIX%s  %s\n' "$R" "$N" "$*"; FIX=$((FIX+1)); }
info() { printf '  %s--%s   %s\n' "$Y" "$N" "$*"; }

# Host part of an SSH-style git URL; empty for https/file/local paths.
host_of() {
  case "$1" in
    ssh://*) local h=${1#ssh://}; h=${h#*@}; h=${h%%/*}; echo "${h%%:*}" ;;
    *://*)   echo "" ;;
    *@*:*)   local h=${1#*@}; echo "${h%%:*}" ;;
    [!/.]*:*) echo "${1%%:*}" ;;
    *)       echo "" ;;
  esac
}

echo "${B}Bitbucket SSH check${N} · user=$(id -un) · host=$(hostname) · $(date '+%Y-%m-%d %H:%M')"

# [1] Host key ---------------------------------------------------------------
echo; echo "${B}[1] Host key $NEW trong ~/.ssh/known_hosts${N}"
KH_OPT=()
if ssh-keygen -F "$NEW" >/dev/null 2>&1; then ok "đã có"
else
  fix "thiếu → chạy: ssh-keygen -F $NEW >/dev/null || curl -fsS https://bitbucket.org/site/ssh | sed 's/^bitbucket\\.org /$NEW /' >> ~/.ssh/known_hosts"
  # For test [3] only: use the official keys from a temp file so we can still tell whether key auth works.
  if curl -fsS https://bitbucket.org/site/ssh 2>/dev/null | sed "s/^bitbucket\.org /$NEW /" > "$TMP/kh" && [ -s "$TMP/kh" ]; then
    KH_OPT=(-o UserKnownHostsFile="$TMP/kh")
  fi
fi

# [2] Repo remotes -----------------------------------------------------------
echo; echo "${B}[2] Repo dùng Bitbucket (quét: ${ROOTS[*]})${N}"
for root in "${ROOTS[@]}"; do
  [ -d "$root" ] || continue
  find "$root" -maxdepth 5 \( -name node_modules -o -name Library -o -name vendor -o -name .Trash \) -prune \
    -o -name .git -type d -print -prune 2>/dev/null
done | sort -u > "$TMP/gits"

: > "$TMP/ssh_remotes"; HTTPS=0
while IFS= read -r g; do
  repo=${g%/.git}
  while read -r _ url; do
    [ -n "$url" ] || continue
    case "$url" in *bitbucket.org*) case "$url" in http*://*) HTTPS=$((HTTPS+1)); continue ;; esac ;; esac
    h=$(host_of "$url"); [ -n "$h" ] || continue
    printf '%s\t%s\t%s\n' "$h" "$repo" "$url" >> "$TMP/ssh_remotes"
  done < <(git config -f "$g/config" --get-regexp '^remote\..*\.url$' 2>/dev/null)
done < "$TMP/gits"

[ "$HTTPS" -gt 0 ] && info "$HTTPS remote HTTPS — không bị ảnh hưởng"

# Keep only SSH hosts that actually resolve to Bitbucket (aliases included).
: > "$TMP/bb_hosts"
for h in $(cut -f1 "$TMP/ssh_remotes" | sort -u); do
  real=$(ssh -G "$h" 2>/dev/null </dev/null | awk '/^hostname /{print $2; exit}')
  case "$real" in *bitbucket.org) printf '%s\t%s\n' "$h" "$real" >> "$TMP/bb_hosts" ;; esac
done

if [ ! -s "$TMP/bb_hosts" ]; then
  ok "không có repo nào dùng SSH tới Bitbucket → máy/user này không bị ảnh hưởng"
else
  while IFS=$'\t' read -r h real; do
    n=$(awk -F'\t' -v h="$h" '$1==h' "$TMP/ssh_remotes" | wc -l | tr -d ' ')
    if [ "$real" = "$NEW" ]; then
      ok "$h → $real ($n remote)"
    elif [ "$h" = "bitbucket.org" ]; then
      fix "$n remote trỏ thẳng git@bitbucket.org → đổi remote (git remote set-url) cho từng repo:"
      awk -F'\t' -v h="$h" '$1==h {print "         " $2}' "$TMP/ssh_remotes" | sort -u
    else
      fix "alias $h → HostName $real ($n remote) → sửa HostName thành $NEW trong ~/.ssh/config"
    fi
  done < "$TMP/bb_hosts"
fi

# [3] Live test against the NEW hostname (works before and after the switch) --
if [ -s "$TMP/bb_hosts" ]; then
  echo; echo "${B}[3] Thử kết nối thật tới $NEW (giả lập sau khi chuyển)${N}"
  [ ${#KH_OPT[@]} -gt 0 ] && info "đang thiếu host key → tạm dùng key chính thức để thử, không ghi vào known_hosts"
  while IFS=$'\t' read -r h _; do
    out=$(ssh -o HostName="$NEW" ${KH_OPT[@]+"${KH_OPT[@]}"} -o BatchMode=yes -o StrictHostKeyChecking=yes \
              -o ConnectTimeout=10 -l git -T "$h" 2>&1 </dev/null)
    case "$out" in
      *"authenticated via"*) ok "$h: key xác thực OK" ;;
      *"verification failed"*|*"host key is known"*) fix "$h: thiếu host key $NEW (xem mục [1])" ;;
      *"Permission denied"*) fix "$h: key bị từ chối (sai key, hoặc key có passphrase chưa ssh-add)" ;;
      *) fix "$h: không kết nối được — $(printf '%s' "$out" | tail -1) (DNS/tường lửa cổng 22?)" ;;
    esac
  done < "$TMP/bb_hosts"
fi

# [4] Scripts / cron that hardcode the old host --------------------------------
echo; echo "${B}[4] Script / crontab ghi cứng git@bitbucket.org${N}"
found=0
SELF=$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")
while IFS= read -r -d '' f; do
  [ "$f" -ef "$SELF" ] && continue
  if grep -q 'git@bitbucket\.org' "$f" 2>/dev/null; then info "xem lại: $f"; found=1; fi
done < <(for root in "${ROOTS[@]}"; do
  [ -d "$root" ] || continue
  find "$root" -maxdepth 5 \( -name node_modules -o -name .git -o -name Library -o -name vendor -o -name .Trash \) -prune \
    -o -type f \( -name '*.sh' -o -name '*.yml' -o -name '*.yaml' -o -name Makefile -o -name 'Dockerfile*' \) -print0 2>/dev/null
done)
if crontab -l 2>/dev/null | grep -q 'bitbucket\.org'; then info "crontab có nhắc bitbucket.org → crontab -l để xem"; found=1; fi
[ "$found" -eq 0 ] && ok "không thấy"

# Summary -----------------------------------------------------------------------
echo
if [ "$FIX" -eq 0 ]; then echo "${G}${B}KẾT LUẬN: SẴN SÀNG${N} cho $NEW"; exit 0
else echo "${R}${B}KẾT LUẬN: CHƯA — $FIX mục cần sửa${N}"; exit 1; fi
