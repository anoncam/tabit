# TabIt - Recent Changes

## Summary

Fixed critical tab generation bugs and completely rewrote the Worker to use yt-dlp with Cloudflare Containers and R2 caching.

## 🐛 Bug Fixes

### 1. Fixed Pitch Detection Algorithm (`src/App.jsx`)

**Problem:** Tabs were empty despite detecting notes - pitch detection was producing MIDI values outside guitar range.

**Solution:**
- Added guitar range validation (MIDI 40-88, E2-E6)
- Implemented octave correction to snap detected pitches to guitar range
- Increased energy threshold from 0.001 to 0.005 to reduce noise
- Added comprehensive debug logging

**Changes:**
```javascript
// Now validates and corrects MIDI values to guitar range
while (midi < guitarMinMidi - 12) midi += 12;
while (midi > guitarMaxMidi + 12) midi -= 12;
if (midi < guitarMinMidi) midi += 12;
if (midi > guitarMaxMidi) midi -= 12;
```

### 2. Fixed String Selection Logic (`src/App.jsx:midiToFret`)

**Problem:** Original logic rejected notes that couldn't be played on middle strings, even if playable on other strings.

**Solution:**
- Find ALL valid string options first
- Prefer middle strings (D/G/B) when available
- Fall back to other strings if middle strings can't play the note
- Ensures every playable note gets mapped

### 3. Added Debug Logging

**New Console Logs:**
- `[TabIt] Detected X notes` - Total notes found
- `[TabIt] First 10 notes:` - Sample detected notes with MIDI/frequency
- `[TabIt] MIDI range: X to Y` - Range validation
- `[TabIt] Converting X notes to tab` - Tab conversion start
- `[TabIt] Tab conversion complete: X mapped, Y unmapped` - Success rate
- Warnings for unmapped notes with reasons

## 🔄 Worker Rewrite

### New Architecture

Replaced API-based downloads with yt-dlp container + R2 caching:

```
User → Worker → (Cache Check) → R2 Bucket
                      ↓ (miss)
                Cloudflare Container (yt-dlp) → Download → Cache in R2
```

### Key Changes (`worker/src/index.js`)

1. **Cloudflare Container Integration (Beta)**
   - Primary download method using `YTDLP_CONTAINER` binding
   - Runs yt-dlp in a container managed by Cloudflare

2. **R2 Caching**
   - Caches all downloaded audio in R2 bucket
   - Cache key: hash of source URL
   - Includes metadata (source type, URL, timestamp)

3. **Fallback Options**
   - External yt-dlp service (`YTDLP_SERVICE_URL`)
   - Direct download for simple audio URLs

### New Files

**`ytdlp-service/`** - yt-dlp microservice
- `Dockerfile` - Python Flask app with yt-dlp + ffmpeg
- `app.py` - Flask API for audio downloads
- `docker-compose.yml` - Local development
- `README.md` - Deployment guide (Cloud Run, Fly.io, Railway)

**`DEPLOYMENT.md`** - Complete deployment guide
- Cloudflare Container setup
- R2 bucket creation
- Worker deployment
- Frontend configuration

## 🚀 CI/CD Updates

### GitHub Actions (`.github/workflows/deploy.yml`)

Now deploys both Worker and Pages in one workflow:

```yaml
1. Build frontend (npm run build)
2. Deploy Worker (wrangler deploy)  ← NEW
3. Deploy Pages (dist/)
```

**Required Secrets:**
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Worker Configuration (`worker/wrangler.toml`)

Updated configuration:
- R2 bucket binding: `AUDIO_BUCKET → tabit-audio-cache`
- Container binding (commented): `YTDLP_CONTAINER`
- Updated compatibility date to 2024-10-01
- Removed unused KV and D1 bindings

## 📝 Documentation Updates

### CLAUDE.md
- Added Worker architecture details
- Updated deployment section
- Added configuration matrix
- Documented download methods priority

### New Files
- `DEPLOYMENT.md` - Step-by-step deployment guide
- `ytdlp-service/README.md` - yt-dlp service deployment options
- `CHANGES.md` - This file

## 🧪 Testing

Build verified successful:
```bash
npm run build  # ✓ Success, no errors
```

**Next Steps for Testing:**
1. Deploy to staging
2. Test pitch detection with various audio files
3. Verify tab generation quality
4. Test Worker with YouTube/SoundCloud URLs
5. Verify R2 caching works
6. Monitor logs and metrics

## Configuration Checklist

### For URL Downloads to Work:

**Option 1: Cloudflare Container (Recommended)**
1. Request beta access to Cloudflare Containers
2. Build and push yt-dlp Docker image
3. Uncomment `YTDLP_CONTAINER` binding in `worker/wrangler.toml`
4. Deploy Worker

**Option 2: External Service**
1. Deploy `ytdlp-service` to Cloud Run/Fly.io/Railway
2. Set `YTDLP_SERVICE_URL` Worker secret
3. Optionally set `YTDLP_API_KEY` if configured
4. Deploy Worker

**Option 3: File Upload Only**
- No configuration needed
- URLs will show helpful error message
- Users can download and upload manually

### Frontend Configuration

Set Worker URL:
```bash
# .env.production
VITE_WORKER_URL=https://tabit-worker.YOUR_SUBDOMAIN.workers.dev
```

Or in `src/App.jsx`:
```javascript
const WORKER_URL = 'https://tabit-worker.YOUR_SUBDOMAIN.workers.dev';
```

## Breaking Changes

None - all changes are backward compatible. App works without Worker (file upload only).

## Performance Improvements

- R2 caching reduces redundant downloads
- Pitch detection optimized with higher energy threshold
- Note merging reduces redundant processing

## Known Issues

1. Cloudflare Containers are in beta - may need waitlist
2. Pitch detection still uses simple autocorrelation (could be improved with ML model)
3. Tab timing quantization could be more sophisticated

## Future Enhancements

- [ ] Use Spotify's Basic Pitch model for better accuracy
- [ ] Add chord detection
- [ ] Improve rhythm/timing analysis
- [ ] Add support for bass guitar
- [ ] Multi-track audio support
