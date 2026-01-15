# --- Stage 1: Build the React Frontend ---
FROM node:20-alpine as frontend-build
WORKDIR /app/frontend
# Allow build-time debug flag for the frontend
ARG VITE_DEBUG_MODE
ENV VITE_DEBUG_MODE=$VITE_DEBUG_MODE
# Copy frontend package files
COPY frontend/package*.json ./
RUN npm install
# Copy frontend source and build
COPY frontend/ ./
RUN npm run build
# (Note: Check where your build outputs go. Usually 'dist' or 'build')

# --- Stage 2: Setup the Node Backend ---
FROM node:20-alpine
WORKDIR /app
# Copy backend package files
COPY backend/package*.json ./
RUN npm install --production

# Copy backend source code
COPY backend/ ./

# --- Stage 3: Merge and Run ---
# Copy built static files from Stage 1 to a 'public' folder in backend
COPY --from=frontend-build /app/frontend/dist ./public

# Expose the port Cloud Run expects (8080 is default)
ENV PORT=8080
EXPOSE 8080

# Start the server
CMD ["node", "server.js"]