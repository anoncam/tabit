# yt-dlp Audio Download Service

A simple Flask-based microservice that uses yt-dlp to download audio from various platforms.

## Features

- Downloads audio from YouTube, SoundCloud, Spotify, Bandcamp, and more
- Converts to MP3 format automatically
- Includes health check endpoint
- Optional API key authentication
- Dockerized for easy deployment

## Deployment Options

### Option 1: Google Cloud Run (Recommended)

```bash
# Build and push to Google Container Registry
cd ytdlp-service
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/ytdlp-service

# Deploy to Cloud Run
gcloud run deploy ytdlp-service \
  --image gcr.io/YOUR_PROJECT_ID/ytdlp-service \
  --platform managed \
  --region us-central1 \
  --memory 512Mi \
  --timeout 120 \
  --set-env-vars API_KEY=your-secret-api-key \
  --allow-unauthenticated
```

### Option 2: Fly.io

```bash
# Install flyctl if needed
curl -L https://fly.io/install.sh | sh

# Deploy to Fly.io
cd ytdlp-service
fly launch
fly secrets set API_KEY=your-secret-api-key
fly deploy
```

### Option 3: Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Deploy to Railway
cd ytdlp-service
railway login
railway init
railway up
railway variables set API_KEY=your-secret-api-key
```

### Option 4: Local Docker

```bash
cd ytdlp-service
docker build -t ytdlp-service .
docker run -p 8080:8080 -e API_KEY=your-secret-key ytdlp-service
```

## Environment Variables

- `API_KEY` (optional): If set, requires Bearer token authentication

## Cloudflare Worker Configuration

After deploying the yt-dlp service, configure your Cloudflare Worker:

```bash
# Set environment variables in wrangler.toml or via dashboard
YTDLP_SERVICE_URL=https://your-ytdlp-service.run.app
YTDLP_API_KEY=your-secret-api-key  # if you set one
```

Or using wrangler CLI:
```bash
cd worker
wrangler secret put YTDLP_SERVICE_URL
wrangler secret put YTDLP_API_KEY
```

## API Endpoints

### Health Check
```bash
GET /health
```

### Download Audio
```bash
POST /download
Content-Type: application/json
Authorization: Bearer your-api-key  # if API_KEY is set

{
  "url": "https://www.youtube.com/watch?v=..."
}
```

Returns: MP3 audio file

## Testing

```bash
# Test health endpoint
curl http://localhost:8080/health

# Test download (with API key)
curl -X POST http://localhost:8080/download \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' \
  --output test.mp3
```

## Cost Estimates

- **Google Cloud Run**: ~$0 for low usage (free tier covers most use cases)
- **Fly.io**: ~$0-5/month with free tier
- **Railway**: ~$0-5/month with free tier

All options support auto-scaling and have generous free tiers suitable for personal projects.
