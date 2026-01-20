# SymSys Modified Turing Test

## Overview

This is a modified Turing Test experiment for the SymSys 1 course. It is a web application that allows students to chat with and evaluate various agents including Eliza, Gemini, and simulated peers.

## Features

- Chat with Eliza, Gemini, and simulated peers
- Evaluate the interaction
- View the results

## Rebuild + Redeploy (Cloud Run)

These steps rebuild the Docker image and redeploy to Cloud Run.

You need the gcloud-cli installed and authenticated, as well as a Gemini API key and a Google Service Account JSON file.

1. Authenticate and set project:
   `gcloud auth login`
   `gcloud config set project gen-lang-client-0788134412`

2. Set up the Docker repository:
   `gcloud auth configure-docker us-west2-docker.pkg.dev`

3. Build the image and deploy to Cloud Run:

```
gcloud builds submit --tag us-west2-docker.pkg.dev/gen-lang-client-0788134412/symtest/symtest:latest .`
gcloud run deploy symtest --image us-west2-docker.pkg.dev/gen-lang-client-0788134412/symtest/symtest:latest --platform managed --region us-west2 --allow-unauthenticated --port 8080
```

## Running the application locally

1. Install dependencies:
   `cd backend && npm install`
   `cd ../frontend && npm install`
2. Set env vars in `.envrc` (and run `direnv allow`):
   - `GEMINI_API_KEY`
   - `GOOGLE_SHEETS_ID`
   - `GOOGLE_SHEETS_RANGE` (optional, default `Sheet1!A1`)
   - `GOOGLE_SERVICE_ACCOUNT_BASE64` (or `GOOGLE_SERVICE_ACCOUNT_JSON`)
   - `VITE_DEBUG_MODE=true` (optional)
3. Start the backend (from repo root):
   `direnv exec . node backend/server.js`
4. Start the frontend (in another terminal):
   `cd frontend && npm run dev`
5. For debugging, you can set `DEBUG_MODE=true` in `.envrc` to enable debug mode.

The frontend dev server proxies `/api` and `/socket.io` to the backend at `http://localhost:8080` via the Vite config.
