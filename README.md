# SymSys Modified Turing Test

## Overview

This is a modified Turing Test experiment for the SymSys 1 course. It is a web application that allows students to chat with and evaluate various agents including Eliza, Gemini, and simulated peers.

## Features

- Chat with Eliza, Gemini, and simulated peers
- Evaluate the interaction
- View the results

## Deployment (Cloud Run, hs-hs-langcog-gemini)

Live at https://symsys-turing-test-246740721864.us-west2.run.app (admin dashboard at `/admin`).

The service runs in us-west2 because Hugging Face rate-limits (HTTP 429, even for `whoami`) the shared egress IPs Cloud Run uses in us-central1. If that starts happening in us-west2 too, the robust fix is a static egress IP (Direct VPC egress + Cloud NAT).

- Gemini runs on Vertex AI, billed to `hs-hs-langcog-gemini`, authenticated as the service account `turing-test-run@` (no API key).
- Sessions, ratings, and transcripts go to Firestore (default database, collections `turing_sessions` and `turing_settings`).
- The Llama 3.1 8B base/instruct pair goes through the Hugging Face router: the base model on `featherless-ai` (the only provider serving base models), the instruct model on `deepinfra` (`HF_POSTTRAINED_PROVIDER`; featherless is often at capacity for it). The token is the Secret Manager secret `turing-hf-token`.
- `/admin` requires Google Sign-In with an account listed in `ADMIN_EMAILS`.

To redeploy: `ADMIN_EMAILS=a@stanford.edu,b@stanford.edu GOOGLE_OAUTH_CLIENT_ID=... ./deploy.sh`

One-time setup (already done): service account `turing-test-run` with `roles/aiplatform.user` and `roles/datastore.user`, plus `roles/secretmanager.secretAccessor` restricted by an IAM condition to `turing-hf-token`; Artifact Registry repo `turing-test` (us-central1; Cloud Run pulls across regions); an OAuth 2.0 Web client whose authorized JavaScript origins include the service URL and `http://localhost:3000`.

## Running a class session

1. In `/admin`, start a new run (e.g. `2027-winter-lecture`) so new sessions are tagged with it, and pick the interface mode.
   - **Giveaways off** (default): bots and humans look the same. Nobody is forced to speak first, typing indicators and timing match human typing, input never locks, and Gemini-as-student uses a terse prompt.
   - **Giveaways on**: the original interface, in which bots greet first, show typing instantly, lock the input, and reply after a fixed delay, and Gemini-as-student uses the original verbose prompt. Toggling between modes in class shows how much judgments depend on surface cues.
2. Filter the dashboard by time range and run. CSV export follows the filters.
3. The model APIs only answer for live, server-issued sessions: at most 6 minutes and 60 messages each.

## Running the application locally

1. Install dependencies:
   `cd backend && npm install`
   `cd ../frontend && npm install`
2. Run `gcloud auth application-default login` (Vertex AI and Firestore use your credentials locally), then set env vars in `.envrc` (and run `direnv allow`):
   - `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT=hs-hs-langcog-gemini`, `GOOGLE_CLOUD_LOCATION=global`
   - `GEMINI_MODEL` (optional, default `gemini-3.8-flash`), `GEMINI_THINKING_LEVEL` (optional, default `low`)
   - `ADMIN_EMAILS`, `GOOGLE_OAUTH_CLIENT_ID` (for `/admin`)
   - `HF_TOKEN`
   - `HF_PROVIDER` (required, e.g. `featherless-ai`)
   - `HF_POSTTRAINED_PROVIDER` (optional, defaults to `HF_PROVIDER`; e.g. `deepinfra`)
   - `HF_BASE_MODEL` (optional, default `meta-llama/Llama-3.1-8B`)
   - `HF_POSTTRAINED_MODEL` (optional, default `meta-llama/Llama-3.1-8B-Instruct`)
   - `VITE_DEBUG_MODE=true` (optional)
3. Start the backend (from repo root):
   `direnv exec . node backend/server.js`
4. Start the frontend (in another terminal):
   `cd frontend && npm run dev`
5. For debugging, you can set `DEBUG_MODE=true` in `.envrc` to enable debug mode.

The frontend dev server proxies `/api` and `/socket.io` to the backend at `http://localhost:8080` via the Vite config.
