#!/bin/sh
# Creates the dedicated test database alongside the development one, so the
# Jest integration suite can truncate tables freely without touching dev data.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE "${POSTGRES_DB}_test";
EOSQL
