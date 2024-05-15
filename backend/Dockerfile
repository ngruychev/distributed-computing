FROM node:18-bookworm-slim

COPY ./package-lock.json .
COPY ./package.json .
RUN npm ci
COPY . .

CMD [ "/usr/bin/env", "npm", "run", "start" ]
