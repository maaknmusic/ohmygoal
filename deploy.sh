#!/usr/bin/env bash
# Deploys the Firestore security rules and the Premium payment functions to Firebase.
#
# Easiest place to run it: Google Cloud Shell (https://shell.cloud.google.com), signed in
# with the Google account that owns the Firebase project:
#   git clone https://github.com/maaknmusic/ohmygoal && cd ohmygoal && bash deploy.sh
#
# Options:
#   --rules-only      only publish firestore.rules (works on the free Spark plan)
#   --reset-secrets   ask for the Razorpay keys again (e.g. when switching from test to live keys)
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=ohmygoal-c8a4a
FB="npx --yes firebase-tools@15.32.1"
SECRETS=(RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET)
RULES_ONLY=false
RESET=false
for arg in "$@"; do
    case "$arg" in
        --rules-only) RULES_ONLY=true ;;
        --reset-secrets) RESET=true ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

if ! $FB projects:list >/dev/null 2>&1; then
    echo "==> Sign in to Firebase (follow the link, then paste the code back here)"
    $FB login --no-localhost
fi

if $RULES_ONLY; then
    $FB deploy --only firestore:rules --project "$PROJECT" --non-interactive
    echo "✔ Security rules published."
    exit 0
fi

echo "==> Installing function dependencies"
npm ci --prefix functions --no-audit --no-fund

echo "==> Razorpay keys (stored in Google Secret Manager, never in GitHub)"
for name in "${SECRETS[@]}"; do
    if $RESET || ! $FB functions:secrets:get "$name" --project "$PROJECT" >/dev/null 2>&1; then
        case "$name" in
            RAZORPAY_KEY_ID) hint="Key Id from Razorpay → Settings → API Keys (starts with rzp_test_ or rzp_live_)" ;;
            RAZORPAY_KEY_SECRET) hint="Key Secret shown next to the Key Id" ;;
            RAZORPAY_WEBHOOK_SECRET) hint="any long random text; use the SAME text when you add the webhook in Razorpay" ;;
        esac
        echo "Enter $name ($hint):"
        $FB functions:secrets:set "$name" --project "$PROJECT"
    else
        echo "✔ $name already set"
    fi
done

echo "==> Deploying security rules and payment functions"
$FB deploy --only firestore:rules,functions --project "$PROJECT" --non-interactive --force

cat <<EOF

✔ Done.
Webhook URL for Razorpay (Settings → Webhooks → Add, event "order.paid"):
  https://asia-south1-$PROJECT.cloudfunctions.net/razorpayWebhook
EOF
