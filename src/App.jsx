// src/App.jsx - CORRECTED VERSION
import React, { useState, useRef, useEffect } from 'react';
import { Upload, Music, Download, Settings, Play, Pause, Loader } from 'lucide-react';

// CHANGE THIS to your actual Worker URL after deploying
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

export default function GuitarTabApp() {
  const [activeTab, setActiveTab] = useState('upload');
  const [file, setFile] = useState(null);
  const [musicUrl, setMusicUrl] = useState('');
  const [playingStyle, setPlayingStyle] = useState('electric');
  const [tuning, setTuning] = useState('standard');
  const [difficulty, setDifficulty] = useState('intermediate');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [transcriptionResult, setTranscriptionResult] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [tfLoaded, setTfLoaded] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    loadTensorFlow();
  }, []);

  const loadTensorFlow = async () => {
    try {
      setProgressMessage('Loading audio processing engine...');
      // TensorFlow.js is loaded via CDN in index.html
      if (typeof window.tf !== 'undefined') {
        await window.tf.ready();
        setTfLoaded(true);
        setProgressMessage('Ready to transcribe!');
      } else {
        console.warn('TensorFlow.js not loaded, using simplified processing');
        setTfLoaded(true);
        setProgressMessage('Ready to transcribe!');
      }
    } catch (error) {
      console.error('Error loading TensorFlow:', error);
      setTfLoaded(true);
      setProgressMessage('Ready to transcribe!');
    }
  };

  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (uploadedFile) {
      setFile(uploadedFile);
      if (audioRef.current) {
        audioRef.current.src = URL.createObjectURL(uploadedFile);
      }
    }
  };

  const handleTranscribe = async () => {
    setIsProcessing(true);
    setProgress(0);
    setProgressMessage('Starting transcription...');

    try {
      if (musicUrl) {
        // Check if Worker URL is configured
        if (!WORKER_URL) {
          alert(
            '⚠️ Worker Not Configured\n\n' +
            'URL downloads require the Cloudflare Worker to be deployed.\n\n' +
            'Please either:\n' +
            '1. Download the audio file manually and upload it using the file picker above, OR\n' +
            '2. Deploy the Worker following the instructions in README.md'
          );
          setIsProcessing(false);
          return;
        }

        setProgressMessage('Downloading audio from URL...');
        setProgress(10);

        const downloadResponse = await fetch(`${WORKER_URL}/api/download-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: musicUrl })
        });

        if (!downloadResponse.ok) {
          const errorData = await downloadResponse.json().catch(() => ({}));
          throw new Error(
            errorData.error ||
            'Failed to download audio from URL. Please try uploading the file directly.'
          );
        }

        const audioBlob = await downloadResponse.blob();
        const audioFile = new File([audioBlob], 'downloaded-audio.mp3', { type: 'audio/mpeg' });
        await processAudioFile(audioFile);
      } else if (file) {
        await processAudioFile(file);
      } else {
        throw new Error('No audio source provided');
      }

      setActiveTab('result');
    } catch (error) {
      console.error('Error:', error);
      alert(`Transcription failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
      setProgress(0);
      setProgressMessage('');
    }
  };

  const processAudioFile = async (audioFile) => {
    setProgress(20);
    setProgressMessage('Loading audio...');

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    setProgress(40);
    setProgressMessage('Analyzing audio frequencies...');

    const notes = await detectPitches(audioBuffer, audioContext.sampleRate);

    setProgress(70);
    setProgressMessage('Generating guitar tablature...');

    const tablature = convertNotesToGuitarTab(notes, {
      style: playingStyle,
      tuning: tuning,
      difficulty: difficulty
    });

    setProgress(90);
    setProgressMessage('Finalizing...');

    const metadata = analyzeAudioMetadata(audioBuffer, notes);

    setProgress(100);

    const result = {
      id: crypto.randomUUID(),
      tablature: tablature,
      metadata: metadata,
      notes: notes,
      audioFile: audioFile
    };

    setTranscriptionResult(result);

    if (audioRef.current) {
      audioRef.current.src = URL.createObjectURL(audioFile);
    }
  };

  const detectPitches = async (audioBuffer, sampleRate) => {
    // Pitch detection with guitar range validation
    const audioData = audioBuffer.getChannelData(0);
    const notes = [];

    const windowSize = 2048;
    const hopSize = 512;

    // Guitar frequency range: E2 (82.41 Hz) to E6 (1318.51 Hz)
    const minFreq = 82;  // E2 - lowest guitar note
    const maxFreq = 1320; // E6 - high E
    const guitarMinMidi = 40; // E2
    const guitarMaxMidi = 88; // E6

    for (let i = 0; i < audioData.length - windowSize; i += hopSize) {
      const window = audioData.slice(i, i + windowSize);

      const energy = window.reduce((sum, val) => sum + val * val, 0) / window.length;

      // Higher energy threshold to reduce noise
      if (energy < 0.005) continue;

      const pitch = estimatePitch(window, sampleRate, minFreq, maxFreq);

      if (pitch) {
        let rawMidi = frequencyToMidi(pitch);

        // Octave correction - bring into guitar range
        let midi = rawMidi;
        while (midi < guitarMinMidi - 12) midi += 12; // Too low, go up octaves
        while (midi > guitarMaxMidi + 12) midi -= 12; // Too high, go down octaves

        // Snap to nearest guitar-range octave
        if (midi < guitarMinMidi) midi += 12;
        if (midi > guitarMaxMidi) midi -= 12;

        // Final validation - only keep if in guitar range
        if (midi >= guitarMinMidi && midi <= guitarMaxMidi) {
          const time = i / sampleRate;

          if (notes.length === 0 ||
              Math.abs(notes[notes.length - 1].midi - midi) > 0.5 ||
              time - notes[notes.length - 1].startTime > 0.25) {
            notes.push({
              midi: Math.round(midi),
              frequency: pitch,
              startTime: time,
              duration: hopSize / sampleRate,
              velocity: Math.min(1, energy * 10)
            });
          }
        }
      }
    }

    const mergedNotes = mergeNotes(notes);
    console.log(`[TabIt] Detected ${mergedNotes.length} notes (before merge: ${notes.length})`);
    if (mergedNotes.length > 0) {
      const sampleNotes = mergedNotes.slice(0, 10).map(n =>
        `MIDI ${n.midi} (${n.frequency.toFixed(1)}Hz) at ${n.startTime.toFixed(2)}s`
      );
      console.log('[TabIt] First 10 notes:', sampleNotes);

      // Show MIDI range
      const midiValues = mergedNotes.map(n => n.midi);
      const minDetected = Math.min(...midiValues);
      const maxDetected = Math.max(...midiValues);
      console.log(`[TabIt] MIDI range: ${minDetected} to ${maxDetected} (guitar range: ${guitarMinMidi}-${guitarMaxMidi})`);
    }

    return mergedNotes;
  };

  const estimatePitch = (buffer, sampleRate, minFreq, maxFreq) => {
    const minPeriod = Math.floor(sampleRate / maxFreq);
    const maxPeriod = Math.floor(sampleRate / minFreq);
    
    let bestPeriod = -1;
    let bestCorrelation = 0;
    
    for (let period = minPeriod; period < maxPeriod; period++) {
      let correlation = 0;
      for (let i = 0; i < buffer.length - period; i++) {
        correlation += buffer[i] * buffer[i + period];
      }
      
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = period;
      }
    }
    
    if (bestPeriod === -1 || bestCorrelation < 0.01) return null;
    
    return sampleRate / bestPeriod;
  };

  const frequencyToMidi = (frequency) => {
    return 12 * Math.log2(frequency / 440) + 69;
  };

  const mergeNotes = (notes) => {
    if (notes.length === 0) return notes;
    
    const merged = [];
    let current = { ...notes[0] };
    
    for (let i = 1; i < notes.length; i++) {
      const note = notes[i];
      
      if (Math.abs(note.midi - current.midi) < 1 && 
          note.startTime - (current.startTime + current.duration) < 0.1) {
        current.duration = note.startTime + note.duration - current.startTime;
      } else {
        merged.push(current);
        current = { ...note };
      }
    }
    merged.push(current);
    
    return merged;
  };

  const convertNotesToGuitarTab = (notes, options) => {
    const { style, tuning, difficulty } = options;

    const tunings = {
      standard: [40, 45, 50, 55, 59, 64],
      dropd: [38, 45, 50, 55, 59, 64],
      halfdrop: [39, 44, 49, 54, 58, 63],
      fulldrop: [38, 43, 48, 53, 57, 62],
      dropc: [36, 43, 48, 53, 57, 62]
    };

    const stringNames = ['E', 'A', 'D', 'G', 'B', 'e'];
    const selectedTuning = tunings[tuning] || tunings.standard;

    console.log(`[TabIt] Converting ${notes.length} notes to tab (tuning: ${tuning}, difficulty: ${difficulty})`);
    
    let tab = `TabIt - Guitar Tablature\n`;
    tab += `================================\n`;
    tab += `Tuning: ${stringNames.join(' ')}\n`;
    tab += `Style: ${style.charAt(0).toUpperCase() + style.slice(1)}\n`;
    tab += `Difficulty: ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}\n`;
    tab += `Notes Detected: ${notes.length}\n`;
    tab += `================================\n\n`;

    const beatsPerMeasure = 4;
    const secondsPerBeat = 0.5;
    const measureDuration = beatsPerMeasure * secondsPerBeat;
    
    const maxTime = Math.max(...notes.map(n => n.startTime), measureDuration * 4);
    const numMeasures = Math.ceil(maxTime / measureDuration);

    let totalMappedNotes = 0;
    let totalUnmappedNotes = 0;

    for (let measure = 0; measure < Math.min(numMeasures, 20); measure++) {
      if (measure % 4 === 0 && measure > 0) {
        tab += `\n`;
      }
      
      tab += `[Measure ${measure + 1}]\n`;

      const measureStart = measure * measureDuration;
      const measureEnd = (measure + 1) * measureDuration;
      const measureNotes = notes.filter(n => 
        n.startTime >= measureStart && n.startTime < measureEnd
      );

      const positions = Array(beatsPerMeasure * 4).fill(null).map(() => 
        Array(6).fill('-')
      );

      measureNotes.forEach((note, idx) => {
        const position = Math.floor(((note.startTime - measureStart) / measureDuration) * (beatsPerMeasure * 4));
        const fretInfo = midiToFret(note.midi, selectedTuning, difficulty);

        if (fretInfo && position < positions.length && position >= 0) {
          const fretStr = fretInfo.fret < 10 ? fretInfo.fret.toString() : `(${fretInfo.fret})`;
          positions[position][fretInfo.string] = fretStr;
          totalMappedNotes++;

          // Log first few mapped notes for debugging
          if (measure === 0 && idx < 3) {
            console.log(`[TabIt] Measure 1, Note ${idx+1}: MIDI ${note.midi} -> String ${fretInfo.string}, Fret ${fretInfo.fret}, Position ${position}`);
          }
        } else {
          totalUnmappedNotes++;

          // Log why note wasn't mapped
          if (measure === 0 && idx < 3) {
            if (!fretInfo) {
              console.warn(`[TabIt] Measure 1, Note ${idx+1}: MIDI ${note.midi} - NO FRET INFO (out of range)`);
            } else if (position < 0 || position >= positions.length) {
              console.warn(`[TabIt] Measure 1, Note ${idx+1}: MIDI ${note.midi} - INVALID POSITION ${position}`);
            }
          }
        }
      });

      for (let string = 0; string < 6; string++) {
        tab += `${stringNames[string]}|`;
        for (let pos = 0; pos < positions.length; pos++) {
          const val = positions[pos][string];
          tab += val;
          if ((pos + 1) % 4 === 0 && pos < positions.length - 1) {
            tab += '-';
          }
        }
        tab += '|\n';
      }
      tab += '\n';
    }

    console.log(`[TabIt] Tab conversion complete: ${totalMappedNotes} notes mapped, ${totalUnmappedNotes} notes unmapped`);
    if (totalUnmappedNotes > 0) {
      console.warn(`[TabIt] ${totalUnmappedNotes} notes could not be mapped - may be out of guitar range or fret limit`);
    }

    return tab;
  };

  const midiToFret = (midiNote, tuning, difficulty) => {
    const maxFret = difficulty === 'beginner' ? 5 : (difficulty === 'intermediate' ? 12 : 17);

    // Find all valid string options
    const validStrings = [];
    for (let string = 5; string >= 0; string--) {
      const fret = midiNote - tuning[string];
      if (fret >= 0 && fret <= maxFret) {
        validStrings.push({ string, fret });
      }
    }

    // If no valid strings, note is out of range
    if (validStrings.length === 0) return null;

    // Prefer middle strings (D/G/B at indices 2-4) for better playability
    const preferredString = validStrings.find(s => s.string >= 2 && s.string <= 4);

    // Use preferred string if available, otherwise use first valid option
    return preferredString || validStrings[0];
  };

  const analyzeAudioMetadata = (audioBuffer, notes) => {
    const intervals = [];
    for (let i = 1; i < Math.min(notes.length, 100); i++) {
      intervals.push(notes[i].startTime - notes[i-1].startTime);
    }
    
    if (intervals.length > 0) {
      intervals.sort((a, b) => a - b);
      const medianInterval = intervals[Math.floor(intervals.length / 2)];
      const estimatedBPM = Math.round(60 / medianInterval);
      
      return {
        bpm: Math.max(60, Math.min(200, estimatedBPM)),
        key: detectKey(notes),
        timeSignature: '4/4',
        duration: audioBuffer.duration,
        noteCount: notes.length
      };
    }

    return {
      bpm: 120,
      key: 'C',
      timeSignature: '4/4',
      duration: audioBuffer.duration,
      noteCount: notes.length
    };
  };

  const detectKey = (notes) => {
    const pitchClasses = new Array(12).fill(0);
    notes.forEach(note => {
      const pc = Math.round(note.midi) % 12;
      pitchClasses[pc]++;
    });
    
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const maxIdx = pitchClasses.indexOf(Math.max(...pitchClasses));
    return noteNames[maxIdx];
  };

  const togglePlayback = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleExport = async (format) => {
    if (!transcriptionResult) return;

    let content, filename, mimeType;

    switch (format) {
      case 'pdf':
        content = generatePDFContent(transcriptionResult);
        filename = 'tabit-guitar-tab.txt';
        mimeType = 'text/plain';
        break;
      case 'tab':
        content = transcriptionResult.tablature;
        filename = 'tabit-guitar-tab.txt';
        mimeType = 'text/plain';
        break;
      case 'lyrics':
        content = generateLyricsWithChords(transcriptionResult);
        filename = 'tabit-tab-with-chords.txt';
        mimeType = 'text/plain';
        break;
      default:
        return;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const generatePDFContent = (result) => {
    return `TabIt - Guitar Tab Export\n\n${result.tablature}\n\nMetadata:\nBPM: ${result.metadata.bpm}\nKey: ${result.metadata.key}\nTime Signature: ${result.metadata.timeSignature}\nDuration: ${result.metadata.duration.toFixed(2)}s\n\nGenerated by TabIt - https://github.com/anoncam/tabit`;
  };

  const generateLyricsWithChords = (result) => {
    return `TabIt - Guitar Tab with Chords\n\n${result.tablature}\n\n[Add lyrics here]\n\nChord progression:\n[Add chords here]\n\nGenerated by TabIt - https://github.com/anoncam/tabit`;
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => setIsPlaying(false);
    
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('ended', handleEnded);
    
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <audio ref={audioRef} />
      
      <header className="border-b border-purple-500/30 bg-slate-900/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <Music className="w-8 h-8 text-purple-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">TabIt</h1>
              <p className="text-purple-200 text-sm mt-1">
                AI-Powered Guitar Tab Transcription • 100% Client-Side • Free Forever
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {!tfLoaded && (
          <div className="mb-6 bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-4">
            <p className="text-yellow-200">
              <Loader className="inline w-4 h-4 animate-spin mr-2" />
              {progressMessage || 'Loading audio processing engine...'}
            </p>
          </div>
        )}

        <div className="flex gap-2 mb-8 flex-wrap">
          <button
            onClick={() => setActiveTab('upload')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'upload'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'bg-slate-800/50 text-purple-200 hover:bg-slate-800'
            }`}
          >
            Upload Audio
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'settings'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'bg-slate-800/50 text-purple-200 hover:bg-slate-800'
            }`}
          >
            Settings
          </button>
          {transcriptionResult && (
            <button
              onClick={() => setActiveTab('result')}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                activeTab === 'result'
                  ? 'bg-purple-600 text-white shadow-lg'
                  : 'bg-slate-800/50 text-purple-200 hover:bg-slate-800'
              }`}
            >
              Results
            </button>
          )}
        </div>

        {activeTab === 'upload' && (
          <div className="space-y-6">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-8 border border-purple-500/30">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <Upload className="w-6 h-6" />
                Upload Audio File
              </h2>
              <div className="border-2 border-dashed border-purple-500/50 rounded-lg p-12 text-center hover:border-purple-500 transition-colors cursor-pointer">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <Upload className="w-16 h-16 mx-auto mb-4 text-purple-400" />
                  <p className="text-white font-semibold mb-2">
                    {file ? file.name : 'Click to upload or drag and drop'}
                  </p>
                  <p className="text-purple-200 text-sm">MP3, WAV, FLAC, M4A, or any audio format</p>
                  <p className="text-purple-300 text-xs mt-2">Max 50MB • Processes locally in your browser</p>
                </label>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-8 border border-purple-500/30">
              <h2 className="text-2xl font-bold text-white mb-4">Or Enter Music URL</h2>
              <input
                type="text"
                value={musicUrl}
                onChange={(e) => setMusicUrl(e.target.value)}
                placeholder="https://youtube.com/... or soundcloud.com/... or spotify.com/..."
                className="w-full px-4 py-3 bg-slate-900 border border-purple-500/30 rounded-lg text-white placeholder-purple-300/50 focus:outline-none focus:border-purple-500"
                disabled={!WORKER_URL}
              />
              {!WORKER_URL && (
                <p className="text-yellow-300 text-sm mt-2">
                  ⚠️ URL downloads disabled. Deploy the Worker to enable this feature.
                </p>
              )}
              {WORKER_URL && (
                <div className="mt-3 text-purple-300 text-xs">
                  <p className="font-semibold mb-1">✅ Supported sources:</p>
                  <p>YouTube • SoundCloud • Spotify • Bandcamp • Deezer • Direct MP3/WAV links</p>
                </div>
              )}
            </div>

            {isProcessing && (
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-8 border border-purple-500/30">
                <div className="flex items-center gap-3 mb-4">
                  <Loader className="w-6 h-6 text-purple-400 animate-spin" />
                  <h3 className="text-xl font-bold text-white">{progressMessage}</h3>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-4 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-purple-200 mt-2 text-sm">
                  🔒 Processing locally in your browser - your audio never leaves your device
                </p>
              </div>
            )}

            <button
              onClick={handleTranscribe}
              disabled={(!file && !musicUrl) || isProcessing || !tfLoaded}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-4 rounded-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
            >
              {isProcessing ? 'Processing...' : !tfLoaded ? 'Loading...' : '🎸 Transcribe to Guitar Tab'}
            </button>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-8 border border-purple-500/30">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                <Settings className="w-6 h-6" />
                Transcription Settings
              </h2>

              <div className="mb-6">
                <label className="block text-white font-semibold mb-3">Playing Style</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setPlayingStyle('electric')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      playingStyle === 'electric'
                        ? 'border-purple-500 bg-purple-500/20'
                        : 'border-purple-500/30 hover:border-purple-500/50'
                    }`}
                  >
                    <div className="text-white font-semibold">⚡ Electric</div>
                    <div className="text-purple-200 text-sm mt-1">Lead, solos, techniques</div>
                  </button>
                  <button
                    onClick={() => setPlayingStyle('acoustic')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      playingStyle === 'acoustic'
                        ? 'border-purple-500 bg-purple-500/20'
                        : 'border-purple-500/30 hover:border-purple-500/50'
                    }`}
                  >
                    <div className="text-white font-semibold">🎸 Acoustic</div>
                    <div className="text-purple-200 text-sm mt-1">Chords, fingerstyle</div>
                  </button>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-white font-semibold mb-3">Tuning</label>
                <select
                  value={tuning}
                  onChange={(e) => setTuning(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="standard">Standard (E A D G B E)</option>
                  <option value="dropd">Drop D (D A D G B E)</option>
                  <option value="halfdrop">Half Step Down (Eb Ab Db Gb Bb Eb)</option>
                  <option value="fulldrop">Full Step Down (D G C F A D)</option>
                  <option value="dropc">Drop C (C G C F A D)</option>
                </select>
              </div>

              <div className="mb-6">
                <label className="block text-white font-semibold mb-3">Tab Complexity</label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="beginner">🟢 Beginner (Frets 0-5)</option>
                  <option value="intermediate">🟡 Intermediate (Frets 0-12)</option>
                  <option value="advanced">🔴 Advanced (Full fretboard)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'result' && transcriptionResult && (
          <div className="space-y-6">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30">
              <div className="flex items-center gap-4">
                <button
                  onClick={togglePlayback}
                  className="bg-purple-600 hover:bg-purple-700 text-white p-3 rounded-full transition-colors flex-shrink-0"
                >
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                </button>
                <div className="flex-1">
                  <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all"
                      style={{ width: `${(currentTime / (audioRef.current?.duration || 1)) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-purple-200 text-sm mt-1">
                    <span>{currentTime.toFixed(1)}s</span>
                    <span>{(audioRef.current?.duration || 0).toFixed(1)}s</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30">
              <h3 className="text-xl font-bold text-white mb-4">📊 Song Info</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-purple-300 text-sm">BPM</div>
                  <div className="text-white font-semibold text-lg">{transcriptionResult.metadata.bpm}</div>
                </div>
                <div>
                  <div className="text-purple-300 text-sm">Key</div>
                  <div className="text-white font-semibold text-lg">{transcriptionResult.metadata.key}</div>
                </div>
                <div>
                  <div className="text-purple-300 text-sm">Time Signature</div>
                  <div className="text-white font-semibold text-lg">{transcriptionResult.metadata.timeSignature}</div>
                </div>
                <div>
                  <div className="text-purple-300 text-sm">Notes Detected</div>
                  <div className="text-white font-semibold text-lg">{transcriptionResult.metadata.noteCount}</div>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-8 border border-purple-500/30">
              <h3 className="text-xl font-bold text-white mb-4">🎼 Guitar Tablature</h3>
              <div className="bg-slate-900 rounded-lg p-6 font-mono text-sm text-green-400 overflow-x-auto">
                <pre>{transcriptionResult.tablature}</pre>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-8 border border-purple-500/30">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Download className="w-6 h-6" />
                Export Options
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={() => handleExport('pdf')}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  📄 Full Tab (TXT)
                </button>
                <button
                  onClick={() => handleExport('tab')}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  📝 Tab Only (TXT)
                </button>
                <button
                  onClick={() => handleExport('lyrics')}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  🎤 Tab + Chords
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-purple-500/30 bg-slate-900/50 mt-12 py-6">
        <div className="max-w-7xl mx-auto px-4 text-center text-purple-300 text-sm">
          <p>Made with ❤️ by <a href="https://github.com/anoncam" className="text-purple-400 hover:text-purple-300">@anoncam</a></p>
          <p className="mt-2">100% client-side • Zero cost • Open source</p>
        </div>
      </footer>
    </div>
  );
}