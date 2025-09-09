# Use the official Bun image as a base image
FROM oven/bun:1-debian

# Set the working directory in the container
WORKDIR /app

# Install additional packages
RUN apt-get update && apt-get install -y net-tools openssh-server && rm -rf /var/lib/apt/lists/*

# Copy package.json and bun.lock to leverage Docker cache
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the application
CMD ["bun", "run", "src/index.ts"]
