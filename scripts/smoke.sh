#!/usr/bin/env bash
# Post-deploy smoke check for Profit Analytics.
#
# Catches the two failure modes that have actually bitten us:
#   1. A deploy that didn't land — routes added in the last release are missing
#      in production, so merchants hit old behaviour (e.g. the removed paywall).
#   2. A route 500ing on boot.
#
# It cannot verify billing is real — that needs a live install. See the manual
# checklist in the repo README before shipping a billing change.
#
# Usage:  ./scripts/smoke.sh [base-url]
set -uo pipefail

BASE="${1:-https://cogs.leverageapps.co}"
FAIL=0

# An authenticated embedded route that exists returns 410 (App Bridge auth
# rejection). A route that does NOT exist returns 404. That difference is what
# lets us prove a given release actually shipped.
EXPECT_EXISTS=(
  /app
  /app/pnl        # added with the free tier — absent means the release didn't land
  /app/billing    # the plan page; absent means merchants cannot upgrade
  /app/products
  /app/orders
  /app/discounts
  /app/expenses
  /app/import
  /app/setup
)

echo "Smoke testing $BASE"
echo

# Control: a path that must NOT exist, proving 410-vs-404 actually discriminates
# here. Without this a server returning 410 for everything would look healthy.
control=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/app/__definitely-not-a-route")
if [ "$control" != "404" ]; then
  echo "FAIL  control path returned $control, expected 404"
  echo "      410-vs-404 cannot be trusted; the rest of this run is meaningless."
  exit 1
fi
printf "ok    control path 404s\n"

for path in "${EXPECT_EXISTS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$path")
  case "$code" in
    410|302|200) printf "ok    %-16s %s\n" "$path" "$code" ;;
    404)         printf "FAIL  %-16s 404 — route missing, deploy did not land\n" "$path"; FAIL=1 ;;
    *)           printf "FAIL  %-16s %s\n" "$path" "$code"; FAIL=1 ;;
  esac
done

echo
if [ "$FAIL" -ne 0 ]; then
  echo "SMOKE FAILED — do not consider this deploy live."
  exit 1
fi
echo "Smoke passed."
