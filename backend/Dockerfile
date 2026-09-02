FROM node:20-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build
CMD ["sh", "-c", "npm run prisma:deploy && if [ \"$SEED_DATABASE\" = \"true\" ]; then npm run prisma:seed; fi && npm run start:prod"]
