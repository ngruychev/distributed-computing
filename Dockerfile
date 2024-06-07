# syntax=docker/dockerfile:1.7-labs

FROM node:20-bookworm-slim AS app-base

WORKDIR /app
COPY ./package-lock.json .
COPY ./package.json .
COPY --parents ./packages/**/package.json .
RUN npm ci
COPY ./tsconfig.json .
COPY ./packages ./packages/

USER node

FROM app-base AS app-backend

CMD [ "/usr/bin/env", "npm", "run", "start-backend" ]

FROM app-base AS app-worker

COPY wordlists/. .

CMD [ "/usr/bin/env", "npm", "run", "start-worker" ]
