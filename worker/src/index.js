// worker/src/index.js - Multi-platform music source support
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
      if (url.pathname === '/api/download-audio' && request.method === 'POST') {
        return await handleAudioDownload(request, env, ctx, corsHeaders);
      }

      if (url.pathname === '/api/health' && request.method === 'GET') {
        return handleHealth(corsHeaders);
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

    // Detect source type and validate
    const source = detectMusicSource(url);
    if (!source) {
      return errorResponse('Unsupported music source. Supported: YouTube, SoundCloud, Spotify, Bandcamp, Tidal, Apple Music', 400, corsHeaders);
    }

    // Generate cache key
    const cacheKey = `audio:${source.type}:${source.id}`;

    // Check cache first
    if (env.AUDIO_BUCKET) {
      try {
        const cached = await env.AUDIO_BUCKET.get(cacheKey);
        if (cached) {
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
        console.log('Cache miss:', e);
      }
    }

    // Download audio based on source type
    const audioBlob = await downloadFromSource(source, env);

    // Cache for future requests
    if (env.AUDIO_BUCKET) {
      ctx.waitUntil(
        env.AUDIO_BUCKET.put(cacheKey, audioBlob, {
          httpMetadata: {
            contentType: 'audio/mpeg'
          },
          customMetadata: {
            sourceType: source.type,
            sourceId: source.id,
            cached: new Date().toISOString()
          }
        })
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
    return errorResponse(`Failed to download: ${error.message}`, 500, corsHeaders);
  }
}

function detectMusicSource(url) {
  // YouTube
  const youtubePatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/
  ];
  for (const pattern of youtubePatterns) {
    const match = url.match(pattern);
    if (match) return { type: 'youtube', id: match[1], url };
  }

  // SoundCloud
  if (url.includes('soundcloud.com/')) {
    return { type: 'soundcloud', id: encodeURIComponent(url), url };
  }

  // Spotify
  const spotifyMatch = url.match(/spotify\.com\/(track|album|playlist)\/([^?]+)/);
  if (spotifyMatch) {
    return { type: 'spotify', id: spotifyMatch[2], subtype: spotifyMatch[1], url };
  }

  // Bandcamp
  if (url.includes('bandcamp.com/track/') || url.includes('bandcamp.com/album/')) {
    return { type: 'bandcamp', id: encodeURIComponent(url), url };
  }

  // Apple Music
  const appleMusicMatch = url.match(/music\.apple\.com\/[a-z]{2}\/(album|song)\/[^/]+\/(\d+)/);
  if (appleMusicMatch) {
    return { type: 'applemusic', id: appleMusicMatch[2], subtype: appleMusicMatch[1], url };
  }

  // Tidal
  const tidalMatch = url.match(/tidal\.com\/(browse\/)?(track|album|playlist)\/(\d+)/);
  if (tidalMatch) {
    return { type: 'tidal', id: tidalMatch[3], subtype: tidalMatch[2], url };
  }

  // Deezer
  const deezerMatch = url.match(/deezer\.com\/[a-z]{2}\/(track|album|playlist)\/(\d+)/);
  if (deezerMatch) {
    return { type: 'deezer', id: deezerMatch[2], subtype: deezerMatch[1], url };
  }

  // Direct audio file URLs
  if (url.match(/\.(mp3|wav|flac|m4a|ogg|aac)(\?.*)?$/i)) {
    return { type: 'direct', id: encodeURIComponent(url), url };
  }

  return null;
}

async function downloadFromSource(source, env) {
  switch (source.type) {
    case 'youtube':
      return await downloadYouTube(source.id, env);
    
    case 'soundcloud':
      return await downloadSoundCloud(source.url, env);
    
    case 'spotify':
      return await downloadSpotify(source.id, source.subtype, env);
    
    case 'bandcamp':
      return await downloadBandcamp(source.url, env);
    
    case 'applemusic':
      return await downloadAppleMusic(source.id, env);
    
    case 'tidal':
      return await downloadTidal(source.id, env);
    
    case 'deezer':
      return await downloadDeezer(source.id, env);
    
    case 'direct':
      return await downloadDirect(source.url, env);
    
    default:
      throw new Error(`Unsupported source type: ${source.type}`);
  }
}

// YouTube download
async function downloadYouTube(videoId, env) {
  // Try RapidAPI first
  if (env.RAPIDAPI_KEY) {
    try {
      const response = await fetch(
        `https://youtube-mp3-download1.p.rapidapi.com/dl?id=${videoId}`,
        {
          headers: {
            'X-RapidAPI-Key': env.RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'youtube-mp3-download1.p.rapidapi.com'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.link) {
          const audioResponse = await fetch(data.link);
          if (audioResponse.ok) {
            return await audioResponse.blob();
          }
        }
      }
    } catch (error) {
      console.error('RapidAPI failed:', error);
    }
  }

  // Try custom ytdl service
  if (env.YTDL_SERVICE_URL) {
    try {
      const response = await fetch(`${env.YTDL_SERVICE_URL}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, format: 'mp3' })
      });
      
      if (response.ok) {
        return await response.blob();
      }
    } catch (error) {
      console.error('ytdl service failed:', error);
    }
  }

  throw new Error('YouTube download failed. Please upload the file directly.');
}

// SoundCloud download
async function downloadSoundCloud(url, env) {
  if (env.RAPIDAPI_KEY) {
    try {
      const response = await fetch(
        `https://soundcloud-downloader9.p.rapidapi.com/download?url=${encodeURIComponent(url)}`,
        {
          headers: {
            'X-RapidAPI-Key': env.RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'soundcloud-downloader9.p.rapidapi.com'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.download) {
          const audioResponse = await fetch(data.download);
          if (audioResponse.ok) {
            return await audioResponse.blob();
          }
        }
      }
    } catch (error) {
      console.error('SoundCloud download failed:', error);
    }
  }

  throw new Error('SoundCloud download requires API key. Please upload the file directly.');
}

// Spotify download
async function downloadSpotify(trackId, subtype, env) {
  if (env.RAPIDAPI_KEY) {
    try {
      const response = await fetch(
        `https://spotify-downloader9.p.rapidapi.com/download?id=${trackId}`,
        {
          headers: {
            'X-RapidAPI-Key': env.RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'spotify-downloader9.p.rapidapi.com'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.download) {
          const audioResponse = await fetch(data.download);
          if (audioResponse.ok) {
            return await audioResponse.blob();
          }
        }
      }
    } catch (error) {
      console.error('Spotify download failed:', error);
    }
  }

  throw new Error('Spotify download requires API key. Please upload the file directly.');
}

// Bandcamp download
async function downloadBandcamp(url, env) {
  // Bandcamp allows streaming, we can extract the audio URL
  try {
    const pageResponse = await fetch(url);
    const html = await pageResponse.text();
    
    // Extract MP3 URL from page
    const mp3Match = html.match(/"mp3-128":"([^"]+)"/);
    if (mp3Match) {
      const audioUrl = mp3Match[1].replace(/\\\//g, '/');
      const audioResponse = await fetch(audioUrl);
      if (audioResponse.ok) {
        return await audioResponse.blob();
      }
    }
  } catch (error) {
    console.error('Bandcamp download failed:', error);
  }

  throw new Error('Bandcamp download failed. Please upload the file directly.');
}

// Apple Music download
async function downloadAppleMusic(trackId, env) {
  throw new Error('Apple Music download not supported. Apple Music uses DRM. Please upload the file directly.');
}

// Tidal download
async function downloadTidal(trackId, env) {
  throw new Error('Tidal download not supported. Tidal uses DRM. Please upload the file directly.');
}

// Deezer download
async function downloadDeezer(trackId, env) {
  if (env.RAPIDAPI_KEY) {
    try {
      const response = await fetch(
        `https://deezer-downloader.p.rapidapi.com/download?id=${trackId}`,
        {
          headers: {
            'X-RapidAPI-Key': env.RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'deezer-downloader.p.rapidapi.com'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.download) {
          const audioResponse = await fetch(data.download);
          if (audioResponse.ok) {
            return await audioResponse.blob();
          }
        }
      }
    } catch (error) {
      console.error('Deezer download failed:', error);
    }
  }

  throw new Error('Deezer download requires API key. Please upload the file directly.');
}

// Direct file download
async function downloadDirect(url, env) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const contentType = response.headers.get('Content-Type');
      if (contentType && contentType.startsWith('audio/')) {
        return await response.blob();
      }
    }
  } catch (error) {
    console.error('Direct download failed:', error);
  }

  throw new Error('Failed to download audio file. Please check the URL.');
}

function handleHealth(corsHeaders) {
  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0',
    features: [
      'multi-platform-download',
      'client-side-transcription'
    ],
    supported_sources: [
      'YouTube',
      'SoundCloud', 
      'Spotify',
      'Bandcamp',
      'Deezer',
      'Direct MP3/WAV/FLAC URLs',
      'Apple Music (DRM limited)',
      'Tidal (DRM limited)'
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