#!/usr/bin/env python3
"""
yt-dlp Audio Download Service
Simple Flask API to download audio using yt-dlp
"""

from flask import Flask, request, jsonify, send_file
import yt_dlp
import os
import tempfile
import logging
from pathlib import Path

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Optional API key authentication
API_KEY = os.environ.get('API_KEY')

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'yt-dlp-audio-service',
        'version': '1.0'
    })

@app.route('/download', methods=['POST'])
def download():
    """Download audio from URL using yt-dlp"""

    # Check API key if configured
    if API_KEY:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer ') or auth_header[7:] != API_KEY:
            return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        url = data.get('url')

        if not url:
            return jsonify({'error': 'No URL provided'}), 400

        logger.info(f'Downloading audio from: {url}')

        # Create temporary directory for download
        with tempfile.TemporaryDirectory() as temp_dir:
            output_template = os.path.join(temp_dir, 'audio.%(ext)s')

            # yt-dlp options
            ydl_opts = {
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
                'outtmpl': output_template,
                'quiet': True,
                'no_warnings': True,
                'extract_flat': False,
            }

            # Download the audio
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)

                # Find the downloaded file
                audio_file = os.path.join(temp_dir, 'audio.mp3')

                if not os.path.exists(audio_file):
                    # Try to find any audio file in temp dir
                    files = list(Path(temp_dir).glob('audio.*'))
                    if files:
                        audio_file = str(files[0])
                    else:
                        raise Exception('Downloaded file not found')

                logger.info(f'Download complete: {audio_file}')

                # Return the audio file
                return send_file(
                    audio_file,
                    mimetype='audio/mpeg',
                    as_attachment=True,
                    download_name='audio.mp3'
                )

    except yt_dlp.utils.DownloadError as e:
        logger.error(f'yt-dlp download error: {str(e)}')
        return jsonify({
            'error': 'Download failed',
            'details': str(e)
        }), 400

    except Exception as e:
        logger.error(f'Unexpected error: {str(e)}')
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500

if __name__ == '__main__':
    # For development only - use gunicorn in production
    app.run(host='0.0.0.0', port=8080, debug=False)
