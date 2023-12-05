FROM node:18-slim
RUN apt-get update && apt-get install -y \
    build-essential \
    python \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --production
RUN npm cache clean --force
ENV NODE_ENV="production"
COPY . .
CMD [ "npm", "start" ]
