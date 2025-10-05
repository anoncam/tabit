FROM python:3.11-slim

# Install yt-dlp and ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    pip install --no-cache-dir yt-dlp flask gunicorn && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY app.py .

# Expose port
EXPOSE 8080

# Run with gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "120", "--workers", "2", "app:app"]
