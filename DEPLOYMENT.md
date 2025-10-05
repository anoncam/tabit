# TabIt Deployment Guide

This guide covers deploying TabIt with the yt-dlp Worker for URL downloads.

## Architecture

```
User Browser
    ↓
TabIt Frontend (Cloudflare Pages)
    ↓ (optional URL download)
Cloudflare Worker
    ↓
Cloudflare Container (yt-dlp)
    ↓
R2 Storage (cache)
```

## Prerequisites

1. Cloudflare account
2. Docker installed locally
3. wrangler CLI: `npm install -g wrangler`

## Step 1: Deploy Frontend (Cloudflare Pages)

```bash
# Build and deploy
npm run build
npm run deploy

# Or connect to GitHub for auto-deployment
# The .github/workflows/deploy.yml will handle this
```

## Step 2: Create R2 Bucket

```bash
# Create R2 bucket for audio caching
wrangler r2 bucket create tabit-audio-cache

# Update worker/wrangler.toml if needed
```

## Step 3: Deploy yt-dlp Container to Cloudflare (Beta)

**Note:** Cloudflare Containers are currently in beta. Request access at https://dash.cloudflare.com

### Option A: Use Cloudflare Container Registry

```bash
# Build the Docker image
cd ytdlp-service
docker build -t ytdlp-service .

# Tag for Cloudflare registry
docker tag ytdlp-service:latest YOUR_ACCOUNT.cloudflare.net/ytdlp-service:latest

# Push to Cloudflare registry
docker push YOUR_ACCOUNT.cloudflare.net/ytdlp-service:latest
```

### Option B: Use External Service (Fallback)

If Cloudflare Containers aren't available yet, deploy to another platform:

**Google Cloud Run:**
```bash
cd ytdlp-service
gcloud builds submit --tag gcr.io/YOUR_PROJECT/ytdlp-service
gcloud run deploy ytdlp-service \
  --image gcr.io/YOUR_PROJECT/ytdlp-service \
  --platform managed \
  --region us-central1 \
  --memory 512Mi \
  --timeout 120 \
  --allow-unauthenticated
```

**Fly.io:**
```bash
cd ytdlp-service
fly launch
fly deploy
```

## Step 4: Configure Worker

### Update wrangler.toml

Edit `worker/wrangler.toml`:

```toml
# For Cloudflare Container binding
[[container_bindings]]
name = "YTDLP_CONTAINER"
image = "your-account.cloudflare.net/ytdlp-service:latest"

# Or for external service, add secret:
# YTDLP_SERVICE_URL via wrangler secret put
```

### Set Secrets (if using external service)

```bash
cd worker

# Set the yt-dlp service URL
wrangler secret put YTDLP_SERVICE_URL
# Enter: https://your-ytdlp-service.run.app (or your Fly.io URL)

# Optional: Set API key if you configured one
wrangler secret put YTDLP_API_KEY
```

## Step 5: Deploy Worker

```bash
cd worker

# Deploy to production
wrangler deploy

# Or deploy to dev environment
wrangler deploy --env dev
```

## Step 6: Configure Frontend

Set the Worker URL in your frontend:

### Option A: Environment Variable

Create `.env.production`:
```
VITE_WORKER_URL=https://tabit-worker.YOUR_SUBDOMAIN.workers.dev
```

### Option B: Direct in Code

Edit `src/App.jsx`:
```javascript
const WORKER_URL = 'https://tabit-worker.YOUR_SUBDOMAIN.workers.dev';
```

Then rebuild and redeploy:
```bash
npm run build
npm run deploy
```

## Verification

### Test the Worker

```bash
# Health check
curl https://tabit-worker.YOUR_SUBDOMAIN.workers.dev/api/health

# Test download
curl -X POST https://tabit-worker.YOUR_SUBDOMAIN.workers.dev/api/download-audio \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' \
  --output test.mp3
```

### Test the Full Stack

1. Go to https://tabit.pages.dev
2. Enter a YouTube URL
3. Click "Transcribe to Guitar Tab"
4. Check browser console for debug logs
5. Verify tab is generated

## Monitoring

### View Worker Logs

```bash
wrangler tail
```

### View R2 Storage

```bash
wrangler r2 object list tabit-audio-cache
```

### Check Metrics

View metrics in Cloudflare Dashboard:
- Workers & Pages → tabit-worker → Metrics
- R2 → tabit-audio-cache → Metrics

## Cost Estimates

**Free Tier Usage:**
- Cloudflare Workers: 100,000 requests/day
- R2 Storage: 10 GB storage, Class A: 1M/month, Class B: 10M/month
- Cloudflare Container: TBD (currently beta)

**Typical Monthly Cost for Personal Use:**
- ~$0 if within free tier limits
- Additional R2 storage: $0.015/GB/month if over 10GB
- Container costs TBD

## Troubleshooting

### Worker not downloading
- Check `wrangler tail` for error logs
- Verify YTDLP_CONTAINER or YTDLP_SERVICE_URL is set
- Test yt-dlp service directly

### R2 caching not working
- Verify R2 bucket binding in wrangler.toml
- Check bucket exists: `wrangler r2 bucket list`
- Ensure bucket_name matches exactly

### Container not starting
- Cloudflare Containers are in beta - ensure you have access
- Verify Docker image is properly tagged and pushed
- Check container logs in Cloudflare dashboard

## Security Notes

1. **API Keys**: If you set YTDLP_API_KEY, store it as a Wrangler secret
2. **CORS**: Worker allows all origins (*) - restrict in production if needed
3. **Rate Limiting**: Consider adding rate limiting for production use
4. **URL Validation**: Worker validates source URLs before processing

## Updates

### Update yt-dlp Container

```bash
cd ytdlp-service
docker build -t ytdlp-service .
docker tag ytdlp-service:latest YOUR_ACCOUNT.cloudflare.net/ytdlp-service:latest
docker push YOUR_ACCOUNT.cloudflare.net/ytdlp-service:latest
```

### Update Worker

```bash
cd worker
wrangler deploy
```

### Update Frontend

```bash
npm run build
npm run deploy
```
