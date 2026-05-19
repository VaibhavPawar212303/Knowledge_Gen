#!/bin/bash

# --- CONFIGURATION ---
CONTAINER_NAME="playwright-api"
IMAGE_NAME="playwright-server"
PORT="7860"
REPO_PATH="/home/ubuntu/Knowledge_Gen/" # Update this to your folder path

# --- PRE-FLIGHT CHECKS ---
echo "🚀 Starting Deployment..."

# Navigate to the project folder
cd $REPO_PATH || { echo "❌ Error: Directory not found"; exit 1; }

# 1. Pull latest data from Git
echo "📥 Pulling latest code from Git..."
git pull origin main || { echo "❌ Git pull failed"; exit 1; }

# 2. Build the new Docker image
echo "🏗️ Building new Docker image..."
cd $REPO_PATH/playwright_server || { echo "❌ Error: Directory not found"; exit 1; }
sudo docker build -t $IMAGE_NAME . || { echo "❌ Docker build failed"; exit 1; }

# 3. Stop and remove the old container (if it exists)
if [ "$(sudo docker ps -aq -f name=$CONTAINER_NAME)" ]; then
    echo "🛑 Stopping existing container..."
    sudo docker stop $CONTAINER_NAME
    sudo docker rm $CONTAINER_NAME
fi

# 4. Start the new container
echo "▶️ Starting new container on port $PORT..."
# Adding --restart always ensures it starts if the AWS server reboots
sudo docker run -d  --name $CONTAINER_NAME -p $PORT:$PORT  --restart always $IMAGE_NAME

# 5. Cleanup: Remove old/dangling images to save AWS disk space
echo "🧹 Cleaning up old Docker images..."
sudo docker image prune -f

echo "✅ Deployment Successful!"
echo "----------------------------------------------"
sudo docker ps -f name=$CONTAINER_NAME