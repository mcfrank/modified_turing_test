# SymSys Modified Turing Test

## Overview

This is a modified Turing Test experiment for the SymSys 1 course. It is a web application that allows students to chat with and evaluate various agents including Eliza, Gemini, and simulated peers.

## Features

- Chat with Eliza, Gemini, and simulated peers
- Evaluate the interaction
- View the results

## Running the application

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in `.envrc` to your Gemini API key
3. Run the app:
   `npm run dev`

For the google sheets logging, you need to set the appropriate sheet ID environment variables, including GOOGLE_SHEETS_ID and GOOGLE_SERVICE_ACCOUNT_BASE64.