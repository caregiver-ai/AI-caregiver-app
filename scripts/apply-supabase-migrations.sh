#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is required." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to apply migrations." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  checksum_file() {
    sha256sum "$1" | awk '{ print $1 }'
  }
else
  checksum_file() {
    shasum -a 256 "$1" | awk '{ print $1 }'
  }
fi

shopt -s nullglob
migration_files=(supabase/migrations/*.sql)

if [[ ${#migration_files[@]} -eq 0 ]]; then
  echo "No migration files found."
  exit 0
fi

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists internal;

create table if not exists internal.schema_migrations (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
SQL

for file in "${migration_files[@]}"; do
  name="$(basename "$file")"
  checksum="$(checksum_file "$file")"
  applied_checksum="$(
    psql "$SUPABASE_DB_URL" \
      -At \
      -v ON_ERROR_STOP=1 \
      -c "select checksum from internal.schema_migrations where name = '$name';"
  )"

  if [[ -n "$applied_checksum" ]]; then
    if [[ "$applied_checksum" != "$checksum" ]]; then
      echo "Migration $name has already been applied with a different checksum." >&2
      exit 1
    fi

    echo "Skipping $name (already applied)"
    continue
  fi

  echo "Applying $name"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$file"
  psql "$SUPABASE_DB_URL" \
    -v ON_ERROR_STOP=1 \
    -c "insert into internal.schema_migrations (name, checksum) values ('$name', '$checksum');"
done
