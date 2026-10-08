#!/usr/bin/env bash
# Run only by the owner in the authenticated VPS console; never pass a key as an argument.
set +x
set +a
set -euo pipefail
export LC_ALL=C
if (( $# != 0 )) || (( EUID != 0 )) || [[ ! -t 0 || ! -t 1 ]]; then
  printf '%s\n' 'Use the interactive owner/root VPS console without arguments.' >&2
  exit 1
fi
secret_dir=/etc/shape-is-money/secrets
target=$secret_dir/openai-api-key
for directory in /etc /etc/shape-is-money "$secret_dir"; do
  if [[ -L "$directory" || ! -d "$directory" ]]; then
    printf '%s\n' 'Secret directory unavailable or symlinked; no changes made.' >&2
    exit 1
  fi
done
for directory in /etc/shape-is-money "$secret_dir"; do
  if [[ $(stat -c '%a:%u' -- "$directory") != '700:0' ]]; then
    printf '%s\n' 'Private root-owned 0700 directories required; no changes made.' >&2
    exit 1
  fi
done
if [[ -e "$target" || -L "$target" ]]; then
  printf '%s\n' 'Destination already exists; refusing replacement.' >&2
  exit 1
fi
umask 077
tmpfile=''
unset key
key=''
tty_state=$(stty -g </dev/tty)
cleanup() {
  unset key
  stty "$tty_state" </dev/tty 2>/dev/null || true
  if [[ -n "$tmpfile" && "$tmpfile" == "$secret_dir"/.openai-key.* && -f "$tmpfile" && ! -L "$tmpfile" ]]; then
    rm -- "$tmpfile"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
printf '%s\n' 'Destino exclusivo: /etc/shape-is-money/secrets/openai-api-key' 'A entrada fica oculta. Cole somente a nova chave Shape e pressione Enter. Ctrl+C cancela.'
if ! IFS= read -r -s -p 'Nova chave OpenAI (oculta): ' key </dev/tty; then
  printf '\n%s\n' 'Entrada cancelada; nenhum arquivo instalado.' >&2
  exit 1
fi
printf '\n'
# Broad sanity checks only: no exact project-key length or fragile format assumption.
if (( ${#key} < 20 || ${#key} > 4096 )) || [[ "$key" != sk-* || "$key" == *[![:graph:]]* ]]; then
  printf '%s\n' 'Formato inválido; nenhum arquivo instalado.' >&2
  exit 1
fi
tmpfile=$(mktemp "$secret_dir/.openai-key.XXXXXXXX")
# printf is a Bash builtin: the credential never becomes an external process argument.
builtin printf '%s' "$key" >"$tmpfile"
unset key
chown 0:1000 -- "$tmpfile"
chmod 0440 -- "$tmpfile"
# Atomic no-replace install; ln fails even if another writer creates the destination now.
if ! ln -- "$tmpfile" "$target"; then
  printf '%s\n' 'Destino indisponível; instalação recusada.' >&2
  exit 1
fi
printf '%s\n' 'Arquivo instalado. IA continua desativada; montagem e teste são passos separados.'
stat -c 'Arquivo: %n | modo=%a uid=%u gid=%g' -- "$target"
