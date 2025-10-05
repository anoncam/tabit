# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TabIt is an AI-powered guitar tablature transcription app that runs 100% client-side in the browser. It uses audio processing and pitch detection to convert music files into guitar tablature with zero API costs and complete privacy.

**Tech Stack:**
- Frontend: React 18 + Vite + Tailwind CSS
- Audio Processing: TensorFlow.js (loaded via CDN) + custom autocorrelation pitch detection
- Backend (optional): Cloudflare Workers for URL-based audio downloads
- Deployment: Cloudflare Pages

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (runs on http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Deploy to Cloudflare Pages (requires wrangler setup)
npm run deploy
```

## Architecture

### Client-Side Audio Processing (`src/App.jsx`)

The app implements a complete audio-to-tab pipeline in the browser:

1. **Audio Loading**: Accepts file uploads or URLs (if Worker is configured)
2. **Pitch Detection** (`detectPitches`): Uses autocorrelation-based pitch estimation on audio buffers
   - Splits audio into overlapping windows (2048 samples, 512 hop size)
   - Estimates fundamental frequency for guitar range (80-1200 Hz)
   - Converts frequencies to MIDI note numbers
3. **Note Merging** (`mergeNotes`): Combines consecutive notes with same pitch
4. **Tab Conversion** (`convertNotesToGuitarTab`): Maps MIDI notes to guitar fret positions
   - Supports multiple tunings (Standard, Drop D, Half/Full Step Down, Drop C)
   - Difficulty-based fret constraints (Beginner: 0-5, Intermediate: 0-12, Advanced: full)
   - Optimizes string selection for playability (prefers middle strings D/G/B)
5. **Metadata Analysis** (`analyzeAudioMetadata`): Estimates BPM, key, and song structure

### Cloudflare Worker (Optional) (`worker/src/index.js`)

Optional backend for downloading audio from URLs. Supports:
- YouTube, SoundCloud, Spotify, Bandcamp, Deezer, direct audio URLs
- R2 bucket caching (if `AUDIO_BUCKET` binding configured)
- CORS-enabled API at `/api/download-audio`

**Environment Variables:**
- `VITE_WORKER_URL`: Worker endpoint (set in `.env` for frontend)
- `RAPIDAPI_KEY`: Optional API key for some music platforms
- `YTDL_SERVICE_URL`: Optional custom YouTube download service

### Key Files

- `src/App.jsx` (747 lines): Main application with all audio processing logic
- `worker/src/index.js`: Cloudflare Worker for audio downloads
- `index.html`: Loads TensorFlow.js from CDN
- `vite.config.js`: Build config with vendor code splitting
- `wrangler.toml`: Cloudflare Pages deployment config

## Configuration

### Tuning System

Tunings are defined as MIDI note arrays in `convertNotesToGuitarTab`:
```javascript
standard: [40, 45, 50, 55, 59, 64]  // E A D G B E
dropd: [38, 45, 50, 55, 59, 64]     // D A D G B E
// etc.
```

### Difficulty Levels

Max fret positions by difficulty (in `midiToFret`):
- Beginner: 5 frets
- Intermediate: 12 frets
- Advanced: 17 frets

## Deployment

The app auto-deploys to Cloudflare Pages via GitHub Actions (`.github/workflows/deploy.yml`) on pushes to `main`.

**Manual deployment:**
```bash
npm run build
npm run deploy  # or: wrangler pages deploy dist --project-name tabit
```

**Worker deployment (optional):**
```bash
cd worker
wrangler deploy
```

## Important Notes

- TensorFlow.js is loaded via CDN script tag in `index.html`, not npm package
- The Worker URL is optional - app defaults to file upload only if not configured
- Audio processing happens entirely in browser using Web Audio API
- String selection algorithm (`midiToFret`) prefers middle strings (D/G/B at indices 2-4) for better playability
