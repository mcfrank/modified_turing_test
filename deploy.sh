#!/usr/bin/env bash
# Build the image with Cloud Build and deploy it to Cloud Run in hs-hs-langcog-gemini.
# One-time setup (service account, secret, Artifact Registry repo) is in the README.
set -euo pipefail

PROJECT=hs-hs-langcog-gemini
REGION=${REGION:-us-west2}
SERVICE=symsys-turing-test
IMAGE=us-central1-docker.pkg.dev/$PROJECT/turing-test/turing-test:$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo -dirty)

# Comma-separated Google accounts allowed into /admin.
ADMIN_EMAILS=${ADMIN_EMAILS:-mcfrank@stanford.edu,ngoodman@stanford.edu,bkrejci@stanford.edu}
# OAuth 2.0 Web client ID for admin sign-in (APIs & Services > Credentials).
GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID:-}

gcloud builds submit --project "$PROJECT" --tag "$IMAGE" .

# max-instances=1: the human-matching queue and live sessions are held in memory.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --service-account "turing-test-run@$PROJECT.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --max-instances 1 --concurrency 1000 --timeout 3600 --session-affinity \
  --cpu 1 --memory 1Gi --cpu-boost \
  --set-secrets HF_TOKEN=turing-hf-token:latest \
  --set-env-vars "^|^GOOGLE_GENAI_USE_VERTEXAI=true|GOOGLE_CLOUD_PROJECT=$PROJECT|GOOGLE_CLOUD_LOCATION=global|GEMINI_MODEL=gemini-3.5-flash|HF_PROVIDER=featherless-ai|HF_POSTTRAINED_PROVIDER=deepinfra|HF_BASE_MODEL=meta-llama/Llama-3.1-8B|HF_POSTTRAINED_MODEL=meta-llama/Llama-3.1-8B-Instruct|HF_BASE_MAX_TOKENS=60|DEBUG_MODE=false|ADMIN_EMAILS=$ADMIN_EMAILS|GOOGLE_OAUTH_CLIENT_ID=$GOOGLE_OAUTH_CLIENT_ID"
