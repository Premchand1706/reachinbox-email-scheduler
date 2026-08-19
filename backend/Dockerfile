FROM node:20-alpine

WORKDIR /app

# Install dependency catalogs
COPY package*.json ./
RUN npm ci

# Copy codebase
COPY . .

# Generate Prisma Engine Client
RUN npx prisma generate

# Build TypeScript to Javascript
RUN npm run build

EXPOSE 4000

CMD ["npm", "start"]
