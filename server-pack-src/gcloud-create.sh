#!/bin/bash
# Magic Garden Shop Alarm - creates the website's engine server on Google Cloud. Run it in Cloud Shell:
#   curl -fsSL https://raw.githubusercontent.com/raidar23/shop-alarm/main/server-pack-src/gcloud-create.sh | bash
# It:  1. turns on the Compute Engine and Budgets services
#      2. adds a small budget alert, so Google emails you if anything ever costs money
#      3. opens the web ports (80 and 443) for the server
#      4. creates a free-tier e2-micro server (Debian 12, us-west1, 30 GB standard disk) that sets itself up
#         with gcloud-setup.sh from this repository
# Running it again is safe: it skips whatever is already there.
set -u
ZONE=us-west1-b
NAME=shop-alarm
PROJECT=$(gcloud config get-value project 2>/dev/null)
echo "Project: $PROJECT"

echo "1/4 Turning on Compute Engine and Budgets (can take a minute)..."
gcloud services enable compute.googleapis.com billingbudgets.googleapis.com || { echo "Couldn't turn on the services."; exit 1; }

echo "2/4 Budget alert..."
BA=$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)' | sed 's#billingAccounts/##')
if [ -n "$BA" ]; then
  CUR=$(gcloud billing accounts describe "$BA" --format='value(currencyCode)' 2>/dev/null)
  case "$CUR" in JPY) AMT=150 ;; KRW) AMT=1500 ;; *) AMT=1 ;; esac
  if gcloud billing budgets list --billing-account="$BA" --format='value(displayName)' 2>/dev/null | grep -qx 'Shop Alarm safety'; then
    echo "   (already there)"
  else
    gcloud billing budgets create --billing-account="$BA" --display-name='Shop Alarm safety' --budget-amount="${AMT}${CUR}" \
      --threshold-rule=percent=0.01 --threshold-rule=percent=0.5 --threshold-rule=percent=1.0 \
      && echo "   Google will email you if this costs anything (at 1%, 50% and 100% of $AMT $CUR)." \
      || echo "   (couldn't add the budget alert; add one at console.cloud.google.com/billing/budgets)"
  fi
else
  echo "   (no billing account linked to this project yet)"
fi

echo "3/4 Web ports..."
gcloud compute firewall-rules describe shop-alarm-web >/dev/null 2>&1 \
  || gcloud compute firewall-rules create shop-alarm-web --network=default --allow=tcp:80,tcp:443 --target-tags=shop-alarm --quiet

echo "4/4 The server..."
if ! gcloud compute instances describe "$NAME" --zone="$ZONE" >/dev/null 2>&1; then
  gcloud compute instances create "$NAME" --zone="$ZONE" --machine-type=e2-micro \
    --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB --boot-disk-type=pd-standard \
    --tags=shop-alarm --quiet \
    --metadata=startup-script='#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/raidar23/shop-alarm/main/server-pack-src/gcloud-setup.sh | bash' \
    || { echo "Couldn't create the server."; exit 1; }
fi
IP=$(gcloud compute instances describe "$NAME" --zone="$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
echo
echo "Done. The server is setting itself up (about 5-10 minutes)."
echo "Its address: https://${IP//./-}.sslip.io/"
echo "SHOP-ALARM-ADDRESS=https://${IP//./-}.sslip.io/"
