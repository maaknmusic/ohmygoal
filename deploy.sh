#!/usr/bin/env bash
# Deploys the Firestore security rules, the Cloud Functions (payments, bans, admin) and the website to Firebase.
#
# Easiest place to run it: Google Cloud Shell (https://shell.cloud.google.com), signed in
# with the Google account that owns the Firebase project:
#   git clone https://github.com/maaknmusic/ohmygoal && cd ohmygoal && bash deploy.sh
#
# Options:
#   --rules-only      only publish firestore.rules (the functions must already be deployed: the rules rely on them)
#   --reset-secrets   ask for the Razorpay keys again (e.g. when switching from test to live keys)
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=ohmygoal-c8a4a
FB="npx --yes firebase-tools@15.32.1"
SECRETS=(RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET ADMIN_EMAILS CF_TURN_KEY_ID CF_TURN_API_TOKEN)
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

echo "==> Secrets (stored in Google Secret Manager, never in GitHub)"
for name in "${SECRETS[@]}"; do
    if $RESET || ! $FB functions:secrets:get "$name" --project "$PROJECT" >/dev/null 2>&1; then
        case "$name" in
            RAZORPAY_KEY_ID) hint="Key Id from Razorpay → Settings → API Keys (starts with rzp_test_ or rzp_live_)" ;;
            RAZORPAY_KEY_SECRET) hint="Key Secret shown next to the Key Id" ;;
            RAZORPAY_WEBHOOK_SECRET) hint="any long random text; use the SAME text when you add the webhook in Razorpay" ;;
            ADMIN_EMAILS) hint="Google email(s) allowed into admin.html, comma-separated" ;;
            CF_TURN_KEY_ID) hint="Cloudflare dashboard → Realtime → TURN Server → your key's Key ID. Type the word unset to skip: chats then connect directly with no relay" ;;
            CF_TURN_API_TOKEN) hint="the API Token shown with that TURN key (type unset to skip)" ;;
        esac
        echo "Enter $name ($hint):"
        $FB functions:secrets:set "$name" --project "$PROJECT"
    else
        echo "✔ $name already set"
    fi
done

# Functions first: the new rules require access passes that only the new functions can issue.
echo "==> Deploying functions (payments, bans, admin)"
$FB deploy --only functions --project "$PROJECT" --non-interactive --force
echo "==> Publishing security rules"
$FB deploy --only firestore:rules --project "$PROJECT" --non-interactive

# The website itself, on your own address (https://$SITE.web.app, the site named in firebase.json) with security headers.
# The admin page should only ever be opened from here: raw.githack.com is shared with every other GitHub project.
SITE=$(node -p "require('./firebase.json').hosting.site || '$PROJECT'")
echo "==> Publishing the website (Firebase Hosting site: $SITE)"
if ! $FB hosting:sites:get "$SITE" --project "$PROJECT" >/dev/null 2>&1; then
    echo "   Creating the hosting site $SITE (its address will be https://$SITE.web.app)"
    $FB hosting:sites:create "$SITE" --project "$PROJECT" || echo "!! Could not create the site \"$SITE\" (the name may already be taken by someone else). Change \"site\" in firebase.json to another name and run this script again."
fi
if ! $FB deploy --only hosting --project "$PROJECT" --non-interactive; then
    echo "!! Hosting deploy failed. This is usually a network hiccup: run this script again (files already uploaded are skipped)."
fi

# Google sign-in only works on addresses listed in Firebase Authentication → Settings → Authorized domains.
echo
echo "!! One-time: add $SITE.web.app, $SITE.firebaseapp.com and your own domain (ohmygoal.app) under Firebase console → Authentication → Settings → Authorized domains, or Google sign-in will fail on that address."

cat <<EOF

✔ Done.
Website:    https://$SITE.web.app
Admin page: https://$SITE.web.app/admin.html   (open it only from here)
Webhook URL for Razorpay (Settings → Webhooks → Add, event "order.paid"):
  https://asia-south1-$PROJECT.cloudfunctions.net/razorpayWebhook
EOF
