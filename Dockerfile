FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM node:20-alpine
WORKDIR /app

# Build tools for native modules (better-sqlite3, sharp)
RUN apk add --no-cache python3 make g++

# Backend dependencies
COPY backend/package.json ./backend/
RUN cd backend && npm install --production

# Remove build tools to keep image smaller
RUN apk del python3 make g++

# Backend source
COPY backend/ ./backend/

# Frontend build output
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

# Data directory for SQLite
RUN mkdir -p /app/data

# ffmpeg for video poster/metadata extraction at upload time
# Health check utility
RUN apk add --no-cache wget ffmpeg poppler-utils

EXPOSE 8000

CMD ["node", "backend/server.js"]
