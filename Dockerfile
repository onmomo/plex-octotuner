FROM node:22-alpine AS build

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable

COPY app.vue nuxt.config.ts ./
COPY server ./server
RUN yarn build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=34400

COPY --from=build /app/.output /app/.output

EXPOSE 34400/tcp
EXPOSE 1900/udp
EXPOSE 65001/udp

USER node

CMD ["node", ".output/server/index.mjs"]
