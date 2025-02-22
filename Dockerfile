FROM node:18-slim
RUN apt-get update && apt-get upgrade -y 
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm update
RUN npm ci --production
RUN npm cache clean --force
ENV NODE_ENV="production"
COPY . .
CMD [ "npm", "start" ]
