// Cloudflare Worker for TabIt - Audio Download with yt-dlp
// This worker handles audio downloads and caches them in R2

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint
      if (url.pathname === '/api/health') {
        return handleHealth(corsHeaders);
      }

      // Download audio endpoint
      if (url.pathname === '/api/download-audio' && request.method === 'POST') {
        return await handleAudioDownload(request, env, ctx, corsHeaders);
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

async function handleAudioDownload(request, env, ctx, corsHeaders) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return errorResponse('No URL provided', 400, corsHeaders);
    }

    // Validate URL
    const source = detectMusicSource(url);
    if (!source) {
      return errorResponse(
        'Unsupported URL. Supported: YouTube, SoundCloud, Spotify, Bandcamp, direct audio links',
        400,
        corsHeaders
      );
    }

    // Generate cache key
    const cacheKey = `audio:${hashString(url)}`;

    // Check R2 cache first
    if (env.AUDIO_BUCKET) {
      try {
        const cached = await env.AUDIO_BUCKET.get(cacheKey);
        if (cached) {
          console.log('Cache HIT:', cacheKey);
          return new Response(cached.body, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'audio/mpeg',
              'X-Cache-Status': 'HIT',
              'X-Source-Type': source.type
            }
          });
        }
      } catch (e) {
        console.log('Cache miss:', e.message);
      }
    }

    // Download audio using yt-dlp service
    const audioBlob = await downloadWithYtDlp(url, source, env);

    // Cache in R2 for future requests
    if (env.AUDIO_BUCKET && audioBlob) {
      ctx.waitUntil(
        env.AUDIO_BUCKET.put(cacheKey, audioBlob, {
          httpMetadata: {
            contentType: 'audio/mpeg'
          },
          customMetadata: {
            sourceType: source.type,
            sourceUrl: url,
            cached: new Date().toISOString()
          }
        }).catch(err => console.error('R2 cache error:', err))
      );
    }

    return new Response(audioBlob, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'X-Cache-Status': 'MISS',
        'X-Source-Type': source.type
      }
    });

  } catch (error) {
    console.error('Audio download error:', error);
    return errorResponse(error.message, 500, corsHeaders);
  }
}

async function downloadWithYtDlp(url, source, env) {
  // Option 1: Use Cloudflare Container binding (preferred)
  if (env.YTDLP_CONTAINER) {
    try {
      console.log('Using Cloudflare Container binding for download');
      const response = await env.YTDLP_CONTAINER.fetch('http://container/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url,
          format: 'mp3',
          quality: 'medium'
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`yt-dlp container error: ${response.status} - ${errorText}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('Cloudflare Container failed:', error);
      throw new Error(`Failed to download audio: ${error.message}. Please try uploading the file directly.`);
    }
  }

  // Option 2: Use external yt-dlp service URL (fallback)
  if (env.YTDLP_SERVICE_URL) {
    try {
      const response = await fetch(`${env.YTDLP_SERVICE_URL}/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': env.YTDLP_API_KEY ? `Bearer ${env.YTDLP_API_KEY}` : ''
        },
        body: JSON.stringify({
          url,
          format: 'mp3',
          quality: 'medium'
        }),
        signal: AbortSignal.timeout(120000) // 2 minute timeout
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`yt-dlp service error: ${response.status} - ${errorText}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('yt-dlp service failed:', error);
      throw new Error(`Failed to download audio: ${error.message}. Please try uploading the file directly.`);
    }
  }

  // Option 3: Direct download for simple URLs
  if (source.type === 'direct') {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TabIt/1.0)'
        },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.startsWith('audio/')) {
        throw new Error('URL does not point to an audio file');
      }

      return await response.blob();
    } catch (error) {
      throw new Error(`Failed to download from URL: ${error.message}`);
    }
  }

  // No download method configured
  throw new Error(
    'yt-dlp not configured. Please either:\n' +
    '1. Configure Cloudflare Container binding (YTDLP_CONTAINER), OR\n' +
    '2. Set YTDLP_SERVICE_URL to an external yt-dlp service, OR\n' +
    '3. Download the audio file manually and upload it directly'
  );
}

function detectMusicSource(url) {
  // YouTube
  if (/(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts)/.test(url)) {
    return { type: 'youtube', url };
  }

  // SoundCloud
  if (url.includes('soundcloud.com/')) {
    return { type: 'soundcloud', url };
  }

  // Spotify
  if (url.includes('spotify.com/track')) {
    return { type: 'spotify', url };
  }

  // Bandcamp
  if (url.includes('bandcamp.com/track/') || url.includes('bandcamp.com/album/')) {
    return { type: 'bandcamp', url };
  }

  // Direct audio file URLs
  if (/\.(mp3|wav|flac|m4a|ogg|aac|opus)(\?.*)?$/i.test(url)) {
    return { type: 'direct', url };
  }

  return null;
}

function handleHealth(corsHeaders) {
  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '3.0',
    features: [
      'yt-dlp-based-downloads',
      'r2-caching',
      'client-side-transcription'
    ],
    supported_sources: [
      'YouTube',
      'SoundCloud',
      'Spotify',
      'Bandcamp',
      'Direct audio URLs (MP3, WAV, FLAC, M4A, etc.)'
    ]
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function errorResponse(message, status, corsHeaders) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Simple hash function for cache keys
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
