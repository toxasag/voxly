#!/bin/sh
set -eu
export NEXT_PUBLIC_API_URL=http://127.0.0.1:4100
exec npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3100
