# ---- RM Markets web (React + Vite) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_URL=""
ARG VITE_WS_URL=""
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_CDN_URL=""
ENV VITE_API_URL=$VITE_API_URL VITE_WS_URL=$VITE_WS_URL VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID VITE_CDN_URL=$VITE_CDN_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4173
COPY --from=build /app/dist ./dist
COPY server.mjs ./
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
