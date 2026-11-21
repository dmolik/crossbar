#!/usr/bin/env bash
#
# Upload a package to Microsoft Edge Add-ons and submit it for
# certification, with the v1.1 Add-ons API:
# https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api
#
#   EDGE_PRODUCT_ID=… EDGE_CLIENT_ID=… EDGE_API_KEY=… \
#       ./tools/publish-edge.sh <zip with manifest.json at its root> [notes]
#
# The product must already exist: the first submission is made by hand in
# Partner Center. EDGE_API_BASE overrides the API origin, for testing.

set -euo pipefail

ZIP="$1"
NOTES="${2:-}"
API="${EDGE_API_BASE:-https://api.addons.microsoftedge.microsoft.com}/v1/products/$EDGE_PRODUCT_ID/submissions"
AUTH=(-H "Authorization: ApiKey $EDGE_API_KEY" -H "X-ClientID: $EDGE_CLIENT_ID")

# POST, and print the operation ID from the Location header.
start() {
    curl -sS --fail-with-body -D - -o /dev/stderr "${AUTH[@]}" "$@" |
        tr -d '\r' | sed -n 's/^[Ll]ocation: *//p' | sed 's#.*/##'
}

# Poll an operation until it is no longer in progress.
wait_for() {
    local url="$1" body status
    for _ in $(seq 60); do
        body=$(curl -sS --fail-with-body "${AUTH[@]}" "$url")
        status=$(jq -r .status <<< "$body")
        if [ "$status" != InProgress ]; then
            echo "$body"
            [ "$status" = Succeeded ]
            return
        fi
        sleep 10
    done
    echo "timed out waiting for $url" >&2
    return 1
}

echo "*** Edge: uploading $ZIP"
op=$(start -X POST -H "Content-Type: application/zip" --data-binary "@$ZIP" "$API/draft/package")
[ -n "$op" ] || { echo "no operation ID in the response" >&2; exit 1; }
wait_for "$API/draft/package/operations/$op"

echo "*** Edge: submitting for certification"
op=$(start -X POST -H "Content-Type: application/json" \
    -d "$(jq -n --arg notes "$NOTES" '{ notes: $notes }')" "$API")
[ -n "$op" ] || { echo "no operation ID in the response" >&2; exit 1; }
wait_for "$API/operations/$op"
