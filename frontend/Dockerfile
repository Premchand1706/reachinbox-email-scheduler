FROM node:20-alpine

WORKDIR /app

# Install dependency catalogs
COPY package*.json ./
RUN npm ci

# Copy codebase
COPY . .

# Build Next.js optimized production files
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
