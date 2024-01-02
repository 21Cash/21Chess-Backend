FROM node:alpine

WORKDIR /

COPY package*.json ./
RUN npm install

COPY ./*.js ./

EXPOSE 3000

CMD ["node", "server.js"]
