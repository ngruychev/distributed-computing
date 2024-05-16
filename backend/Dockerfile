FROM node:20-bookworm-slim

WORKDIR /app
COPY ./package-lock.json .
COPY ./package.json .
RUN npm ci
COPY . .

USER node

CMD [ "/usr/bin/env", "npm", "run", "start" ]
