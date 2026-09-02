FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN npm install -g pnpm@11.22.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN DIRECT_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    pnpm prisma generate

RUN pnpm build


FROM node:22-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 5050

CMD ["node", "dist/src/server.js"]