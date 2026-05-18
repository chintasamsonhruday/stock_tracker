# Use official Node.js 20 Alpine image as base
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./
# Uncomment the next line if you use pnpm and have pnpm-lock.yaml
# COPY pnpm-lock.yaml ./

# Install dependencies
RUN npm ci
# If using pnpm, replace with:
# RUN npm install -g pnpm && pnpm install

# Copy all project files
COPY . .

ARG NEXT_PUBLIC_FINNHUB_API_KEY=""

# Build the Next.js application. The app reads MongoDB during page-data
# collection, so Docker Desktop builds reach the Compose MongoDB container
# through its published host port.
RUN MONGODB_URI="mongodb://root:example@host.docker.internal:27017/openstock?authSource=admin" \
    BETTER_AUTH_SECRET="docker_build_placeholder_change_at_runtime" \
    BETTER_AUTH_URL="http://localhost:3000" \
    NEXT_PUBLIC_FINNHUB_API_KEY="${NEXT_PUBLIC_FINNHUB_API_KEY}" \
    NEXT_PUBLIC_SOURCE_CODE_URL="https://github.com/chintasamsonhruday/stock_tracker" \
    FINNHUB_BASE_URL="https://finnhub.io/api/v1" \
    npm run build

# Expose the port Next.js runs on
EXPOSE 3000

# Start the Next.js production server
CMD ["npm", "start"]
# Or if using pnpm:
# CMD ["pnpm", "start"]
