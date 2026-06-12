(function() {
  'use strict';

  const SAMPLE_RATE = 44100;
  const TRACK_HEIGHT = 80;
  const CLIP_VERTICAL_PADDING = 6;
  const MIN_SECONDS_VISIBLE = 1;
  const MAX_SECONDS_VISIBLE = 60;
  const DEFAULT_BPM = 120;
  const SPECTRUM_BARS = 64;
  const SCOPE_SAMPLES = 1024;

  const TRACK_COLORS = [
    { bg: '#3a5a8a', border: '#5a7aaa' },
    { bg: '#5a3a8a', border: '#7a5aaa' },
    { bg: '#3a8a5a', border: '#5aaa7a' },
    { bg: '#8a5a3a', border: '#aa7a5a' },
    { bg: '#8a3a5a', border: '#aa5a7a' },
    { bg: '#3a8a8a', border: '#5aaaaa' },
  ];

  let audioCtx = null;
  let masterGain = null;
  let masterAnalyser = null;
  let tracks = [];
  let nextTrackId = 1;
  let nextClipId = 1;

  let isPlaying = false;
  let playStartTime = 0;
  let playStartOffset = 0;
  let currentPlayTime = 0;
  let totalDuration = 60;

  let bpm = DEFAULT_BPM;
  let pixelsPerSecond = 50;
  let scrollOffsetX = 0;

  let selectedClipId = null;
  let draggingClip = null;
  let dragStartX = 0;
  let dragStartClipTime = 0;
  let snapEnabled = true;

  let pendingFileTrackId = null;

  let spectrumData = new Uint8Array(SPECTRUM_BARS);
  let spectrumPeaks = new Array(SPECTRUM_BARS).fill(0);
  let scopeTimeData = new Float32Array(SCOPE_SAMPLES);

  let trackPeakLevels = [];
  let trackPeakHold = [];
  let trackPeakHoldTime = [];

  const timelineScroll = document.getElementById('timeline-scroll');
  const timelineTracks = document.getElementById('timeline-tracks');
  const timelineRuler = document.getElementById('timeline-ruler');
  const tracksList = document.getElementById('tracks-list');
  const playhead = document.getElementById('playhead');
  const fileInput = document.getElementById('file-input');

  const spectrumCanvas = document.getElementById('spectrum-canvas');
  const scopeCanvas = document.getElementById('scope-canvas');
  const spectrumCtx = spectrumCanvas.getContext('2d');
  const scopeCtx = scopeCanvas.getContext('2d');

  const rulerCanvas = document.createElement('canvas');
  rulerCanvas.className = 'ruler-canvas';
  timelineRuler.appendChild(rulerCanvas);
  const rulerCtx = rulerCanvas.getContext('2d');

  const snapLine = document.createElement('div');
  snapLine.className = 'snap-line';
  document.getElementById('timeline-container').appendChild(snapLine);

  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 1.0;
      masterAnalyser = audioCtx.createAnalyser();
      masterAnalyser.fftSize = 2048;
      masterGain.connect(masterAnalyser);
      masterAnalyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function createTrack(name) {
    ensureAudioContext();
    const id = nextTrackId++;
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 1.0;
    const panNode = audioCtx.createStereoPanner();
    panNode.pan.value = 0;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    gainNode.connect(panNode);
    panNode.connect(analyser);
    analyser.connect(masterGain);

    const track = {
      id,
      name: name || `Track ${id}`,
      volume: 100,
      pan: 0,
      muted: false,
      soloed: false,
      clips: [],
      gainNode,
      panNode,
      analyser,
      color: TRACK_COLORS[(id - 1) % TRACK_COLORS.length],
      levelDataL: new Float32Array(analyser.fftSize),
      levelDataR: new Float32Array(analyser.fftSize),
    };
    tracks.push(track);
    trackPeakLevels[id] = [0, 0];
    trackPeakHold[id] = [0, 0];
    trackPeakHoldTime[id] = [0, 0];
    return track;
  }

  function initTracks() {
    for (let i = 1; i <= 4; i++) {
      createTrack(`Track ${i}`);
    }
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function timeToX(time) {
    return time * pixelsPerSecond - scrollOffsetX;
  }

  function xToTime(x) {
    return (x + scrollOffsetX) / pixelsPerSecond;
  }

  function snapTime(time) {
    if (!snapEnabled) return time;
    const beatDuration = 60 / bpm;
    const snapped = Math.round(time / beatDuration) * beatDuration;
    return Math.max(0, snapped);
  }

  function getBeatDuration() {
    return 60 / bpm;
  }

  function getBarDuration() {
    return getBeatDuration() * 4;
  }

  function decodeAudioFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        ensureAudioContext();
        audioCtx.decodeAudioData(e.target.result)
          .then(resolve)
          .catch(reject);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function generateWaveformData(buffer, width) {
    const channelData = buffer.getChannelData(0);
    const samplesPerPixel = Math.floor(channelData.length / width);
    const waveform = new Float32Array(width * 2);

    if (samplesPerPixel < 1) {
      for (let i = 0; i < width; i++) {
        const idx = Math.min(i, channelData.length - 1);
        waveform[i * 2] = channelData[idx];
        waveform[i * 2 + 1] = channelData[idx];
      }
      return waveform;
    }

    for (let i = 0; i < width; i++) {
      let min = Infinity;
      let max = -Infinity;
      const start = i * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, channelData.length);
      for (let j = start; j < end; j++) {
        const v = channelData[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      waveform[i * 2] = min;
      waveform[i * 2 + 1] = max;
    }
    return waveform;
  }

  function addClipToTrack(track, audioBuffer, fileName, startTime) {
    const clip = {
      id: nextClipId++,
      trackId: track.id,
      buffer: audioBuffer,
      name: fileName || 'Audio Clip',
      startTime: startTime || 0,
      duration: audioBuffer.duration,
      waveform: null,
      waveformWidth: 0,
    };

    const baseWidth = Math.ceil(clip.duration * pixelsPerSecond);
    clip.waveform = generateWaveformData(audioBuffer, Math.max(100, baseWidth));
    clip.waveformWidth = clip.waveform.length / 2;

    track.clips.push(clip);
    track.clips.sort((a, b) => a.startTime - b.startTime);

    resolveClipOverlaps(track);
    updateTotalDuration();
    renderClips();
    return clip;
  }

  function resolveClipOverlaps(track) {
    const clips = track.clips;
    for (let i = 1; i < clips.length; i++) {
      const prev = clips[i - 1];
      const curr = clips[i];
      if (curr.startTime < prev.startTime + prev.duration) {
        curr.startTime = prev.startTime + prev.duration;
      }
    }
  }

  function updateTotalDuration() {
    let maxEnd = 60;
    for (const track of tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    totalDuration = maxEnd + 5;
    document.getElementById('time-total').textContent = formatTime(totalDuration);
  }

  function getEffectiveGain(track) {
    const anySolo = tracks.some(t => t.soloed);
    if (track.muted) return 0;
    if (anySolo && !track.soloed) return 0;
    return track.volume / 100;
  }

  function applyTrackGains() {
    for (const track of tracks) {
      track.gainNode.gain.value = getEffectiveGain(track);
    }
  }

  let scheduledSources = [];

  function stopAllSources() {
    for (const s of scheduledSources) {
      try { s.stop(); } catch (e) {}
      try { s.disconnect(); } catch (e) {}
    }
    scheduledSources = [];
  }

  function schedulePlayback(startOffset) {
    stopAllSources();
    const now = audioCtx.currentTime;
    playStartTime = now;
    playStartOffset = startOffset;

    for (const track of tracks) {
      for (const clip of track.clips) {
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;

        if (clipEnd <= startOffset) continue;

        const when = now + Math.max(0, clipStart - startOffset);
        const offset = Math.max(0, startOffset - clipStart);
        const duration = clipEnd - Math.max(clipStart, startOffset);

        if (duration <= 0) continue;

        const source = audioCtx.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(track.gainNode);
        try {
          source.start(when, offset, duration);
        } catch (e) {
          try { source.start(when, offset); } catch (e2) {}
        }
        scheduledSources.push(source);
      }
    }
  }

  function togglePlay() {
    ensureAudioContext();
    if (isPlaying) {
      currentPlayTime = audioCtx.currentTime - playStartTime + playStartOffset;
      stopAllSources();
      isPlaying = false;
      document.getElementById('btn-play').classList.remove('playing');
      document.getElementById('icon-play').setAttribute('d', 'M8 5v14l11-7z');
    } else {
      const maxTime = getMaxClipEnd();
      if (currentPlayTime >= maxTime) {
        currentPlayTime = 0;
      }
      applyTrackGains();
      schedulePlayback(currentPlayTime);
      isPlaying = true;
      document.getElementById('btn-play').classList.add('playing');
      document.getElementById('icon-play').setAttribute('d', 'M6 4h4v16H6zM14 4h4v16h-4z');
    }
  }

  function stopPlayback() {
    stopAllSources();
    isPlaying = false;
    currentPlayTime = 0;
    document.getElementById('btn-play').classList.remove('playing');
    document.getElementById('icon-play').setAttribute('d', 'M8 5v14l11-7z');
    updatePlayhead();
  }

  function getMaxClipEnd() {
    let max = 0;
    for (const track of tracks) {
      for (const clip of track.clips) {
        max = Math.max(max, clip.startTime + clip.duration);
      }
    }
    return Math.max(max, 60);
  }

  function updatePlayhead() {
    if (isPlaying) {
      currentPlayTime = audioCtx.currentTime - playStartTime + playStartOffset;
      const maxTime = getMaxClipEnd();
      if (currentPlayTime >= maxTime) {
        stopPlayback();
        return;
      }
    }
    const x = timeToX(currentPlayTime);
    const timelineContainer = document.getElementById('timeline-container');
    const tracksPanelWidth = document.getElementById('tracks-panel').offsetWidth;
    playhead.style.left = (tracksPanelWidth + x) + 'px';
    document.getElementById('time-current').textContent = formatTime(currentPlayTime);
  }

  function renderTracks() {
    tracksList.innerHTML = '';

    for (const track of tracks) {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.dataset.trackId = track.id;

      const info = document.createElement('div');
      info.className = 'track-info';

      const nameEl = document.createElement('div');
      nameEl.className = 'track-name';
      nameEl.textContent = track.name;
      nameEl.title = '双击重命名';
      nameEl.addEventListener('dblclick', () => startRenameTrack(track, nameEl));
      info.appendChild(nameEl);

      const addBtn = document.createElement('button');
      addBtn.className = 'add-clip-btn';
      addBtn.innerHTML = '+';
      addBtn.title = '添加音频片段';
      addBtn.addEventListener('click', () => {
        pendingFileTrackId = track.id;
        fileInput.click();
      });
      info.appendChild(addBtn);

      row.appendChild(info);

      const levels = document.createElement('div');
      levels.className = 'track-levels';
      for (let ch = 0; ch < 2; ch++) {
        const meter = document.createElement('div');
        meter.className = 'level-meter';
        meter.dataset.trackId = track.id;
        meter.dataset.channel = ch;
        const fill = document.createElement('div');
        fill.className = 'level-fill';
        const peak = document.createElement('div');
        peak.className = 'level-peak';
        meter.appendChild(fill);
        meter.appendChild(peak);
        levels.appendChild(meter);
      }
      row.appendChild(levels);

      const controls = document.createElement('div');
      controls.className = 'track-controls';
      const msBtns = document.createElement('div');
      msBtns.className = 'ms-buttons';

      const muteBtn = document.createElement('button');
      muteBtn.className = 'ms-btn mute' + (track.muted ? ' active' : '');
      muteBtn.textContent = 'M';
      muteBtn.title = '静音';
      muteBtn.addEventListener('click', () => {
        track.muted = !track.muted;
        muteBtn.classList.toggle('active', track.muted);
        applyTrackGains();
      });

      const soloBtn = document.createElement('button');
      soloBtn.className = 'ms-btn solo' + (track.soloed ? ' active' : '');
      soloBtn.textContent = 'S';
      soloBtn.title = '独奏';
      soloBtn.addEventListener('click', () => {
        track.soloed = !track.soloed;
        soloBtn.classList.toggle('active', track.soloed);
        applyTrackGains();
      });

      msBtns.appendChild(muteBtn);
      msBtns.appendChild(soloBtn);
      controls.appendChild(msBtns);
      row.appendChild(controls);

      const panWrap = document.createElement('div');
      panWrap.className = 'track-pan';
      const panKnobWrap = document.createElement('div');
      panKnobWrap.className = 'pan-knob-wrapper';
      const panKnob = document.createElement('div');
      panKnob.className = 'pan-knob';
      const panIndicator = document.createElement('div');
      panIndicator.className = 'pan-indicator';
      panIndicator.style.transform = `translateX(-50%) rotate(${track.pan * 135}deg)`;
      panKnob.appendChild(panIndicator);
      panKnobWrap.appendChild(panKnob);
      const panVal = document.createElement('span');
      panVal.className = 'pan-value';
      panVal.textContent = track.pan === 0 ? 'C' : (track.pan < 0 ? `L${Math.round(Math.abs(track.pan) * 100)}` : `R${Math.round(track.pan * 100)}`);
      panKnobWrap.appendChild(panVal);
      panWrap.appendChild(panKnobWrap);
      attachPanKnob(panKnob, panIndicator, panVal, track);
      row.appendChild(panWrap);

      const volWrap = document.createElement('div');
      volWrap.className = 'track-volume';
      const volFader = document.createElement('input');
      volFader.type = 'range';
      volFader.className = 'fader track-fader';
      volFader.min = '0';
      volFader.max = '150';
      volFader.value = track.volume;
      volFader.step = '1';
      const volVal = document.createElement('span');
      volVal.className = 'value-label';
      volVal.textContent = track.volume + '%';
      volVal.style.fontSize = '10px';
      volFader.addEventListener('input', () => {
        track.volume = parseInt(volFader.value, 10);
        volVal.textContent = track.volume + '%';
        applyTrackGains();
      });
      volWrap.appendChild(volFader);
      volWrap.appendChild(volVal);
      row.appendChild(volWrap);

      tracksList.appendChild(row);
    }

    syncTimelineHeights();
  }

  function startRenameTrack(track, nameEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'track-name-input';
    input.value = track.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = (commit) => {
      const newName = input.value.trim() || track.name;
      if (commit) track.name = newName;
      nameEl.textContent = track.name;
      input.replaceWith(nameEl);
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  function attachPanKnob(knobEl, indicatorEl, valueEl, track) {
    let isDragging = false;
    let startY = 0;
    let startPan = 0;

    function onDown(e) {
      isDragging = true;
      startY = e.clientY;
      startPan = track.pan;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    }

    function onMove(e) {
      if (!isDragging) return;
      const delta = (startY - e.clientY) / 150;
      track.pan = Math.max(-1, Math.min(1, startPan + delta));
      track.panNode.pan.value = track.pan;
      indicatorEl.style.transform = `translateX(-50%) rotate(${track.pan * 135}deg)`;
      valueEl.textContent = track.pan === 0 ? 'C' : (track.pan < 0 ? `L${Math.round(Math.abs(track.pan) * 100)}` : `R${Math.round(track.pan * 100)}`);
    }

    function onUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    knobEl.addEventListener('mousedown', onDown);
  }

  function syncTimelineHeights() {
    timelineTracks.innerHTML = '';
    timelineTracks.style.width = Math.ceil(totalDuration * pixelsPerSecond) + 'px';

    for (const track of tracks) {
      const ttrack = document.createElement('div');
      ttrack.className = 'timeline-track';
      ttrack.dataset.trackId = track.id;
      ttrack.style.height = TRACK_HEIGHT + 'px';

      ttrack.addEventListener('dragover', (e) => {
        e.preventDefault();
        ttrack.classList.add('drop-target');
      });
      ttrack.addEventListener('dragleave', () => {
        ttrack.classList.remove('drop-target');
      });
      ttrack.addEventListener('drop', (e) => {
        e.preventDefault();
        ttrack.classList.remove('drop-target');
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          handleFiles(files, track.id);
        }
      });

      ttrack.addEventListener('click', (e) => {
        if (e.target === ttrack) {
          selectedClipId = null;
          renderClips();
        }
      });

      const hint = document.createElement('div');
      hint.className = 'track-drop-hint';
      hint.textContent = '拖拽音频文件到此处';
      ttrack.appendChild(hint);

      timelineTracks.appendChild(ttrack);
    }

    renderClips();
    drawRuler();
    renderGrid();
  }

  function renderClips() {
    document.querySelectorAll('.audio-clip').forEach(el => el.remove());

    for (const track of tracks) {
      const ttrack = timelineTracks.querySelector(`.timeline-track[data-track-id="${track.id}"]`);
      if (!ttrack) continue;

      const hint = ttrack.querySelector('.track-drop-hint');
      if (hint) hint.style.display = track.clips.length > 0 ? 'none' : 'block';

      for (const clip of track.clips) {
        const clipEl = document.createElement('div');
        clipEl.className = 'audio-clip' + (selectedClipId === clip.id ? ' selected' : '');
        clipEl.dataset.clipId = clip.id;
        const left = timeToX(clip.startTime);
        const width = clip.duration * pixelsPerSecond;
        clipEl.style.left = left + 'px';
        clipEl.style.width = Math.max(20, width) + 'px';
        clipEl.style.background = track.color.bg;
        clipEl.style.borderColor = track.color.border;
        clipEl.style.top = CLIP_VERTICAL_PADDING + 'px';
        clipEl.style.height = (TRACK_HEIGHT - CLIP_VERTICAL_PADDING * 2) + 'px';

        const nameLabel = document.createElement('div');
        nameLabel.className = 'clip-name';
        nameLabel.textContent = clip.name;
        clipEl.appendChild(nameLabel);

        const waveformCanvas = document.createElement('canvas');
        waveformCanvas.className = 'clip-canvas';
        clipEl.appendChild(waveformCanvas);

        drawClipWaveform(waveformCanvas, clip, track);

        clipEl.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          startDragClip(e, clip);
        });

        clipEl.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedClipId = clip.id;
          renderClips();
        });

        ttrack.appendChild(clipEl);
      }
    }
  }

  function drawClipWaveform(canvas, clip, track) {
    const w = Math.max(1, Math.floor(clip.duration * pixelsPerSecond));
    const h = TRACK_HEIGHT - CLIP_VERTICAL_PADDING * 2;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const midY = h / 2;
    const amp = (h / 2) - 4;

    const wf = clip.waveform;
    const srcWidth = wf.length / 2;
    const ratio = srcWidth / w;

    for (let x = 0; x < w; x++) {
      const srcX = Math.floor(x * ratio);
      const min = wf[srcX * 2];
      const max = wf[srcX * 2 + 1];
      const y1 = midY - max * amp;
      const y2 = midY - min * amp;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }

  function startDragClip(e, clip) {
    ensureAudioContext();
    draggingClip = clip;
    dragStartX = e.clientX;
    dragStartClipTime = clip.startTime;
    snapEnabled = !e.altKey;
    selectedClipId = clip.id;
    renderClips();

    document.addEventListener('mousemove', onDragClip);
    document.addEventListener('mouseup', endDragClip);
    e.preventDefault();
  }

  function onDragClip(e) {
    if (!draggingClip) return;
    snapEnabled = !e.altKey;

    const timelineRect = timelineScroll.getBoundingClientRect();
    const deltaX = e.clientX - dragStartX;
    const deltaTime = deltaX / pixelsPerSecond;
    let newTime = dragStartClipTime + deltaTime;
    newTime = Math.max(0, newTime);

    if (snapEnabled) {
      newTime = snapTime(newTime);
    }

    const snapX = timeToX(newTime);
    const timelineContainer = document.getElementById('timeline-container');
    const tracksPanelWidth = document.getElementById('tracks-panel').offsetWidth;
    snapLine.style.display = 'block';
    snapLine.style.left = (tracksPanelWidth + snapX) + 'px';

    const clipEl = document.querySelector(`.audio-clip[data-clip-id="${draggingClip.id}"]`);
    if (clipEl) {
      clipEl.style.left = snapX + 'px';
    }
  }

  function endDragClip(e) {
    if (draggingClip) {
      const deltaX = e.clientX - dragStartX;
      const deltaTime = deltaX / pixelsPerSecond;
      let newTime = dragStartClipTime + deltaTime;
      newTime = Math.max(0, newTime);
      if (snapEnabled) newTime = snapTime(newTime);
      draggingClip.startTime = newTime;

      const track = tracks.find(t => t.id === draggingClip.trackId);
      if (track) {
        track.clips.sort((a, b) => a.startTime - b.startTime);
        resolveClipOverlaps(track);
      }

      draggingClip = null;
      snapLine.style.display = 'none';
      renderClips();
    }
    document.removeEventListener('mousemove', onDragClip);
    document.removeEventListener('mouseup', endDragClip);
  }

  function renderGrid() {
    document.querySelectorAll('.beat-line').forEach(el => el.remove());

    for (const track of tracks) {
      const ttrack = timelineTracks.querySelector(`.timeline-track[data-track-id="${track.id}"]`);
      if (!ttrack) continue;

      const overlay = document.createElement('div');
      overlay.className = 'grid-overlay';

      const beatDur = getBeatDuration();
      const barDur = getBarDuration();
      const totalPx = totalDuration * pixelsPerSecond;

      for (let t = 0; t <= totalDuration; t += beatDur) {
        const x = t * pixelsPerSecond;
        if (x > totalPx + 100) break;
        const line = document.createElement('div');
        line.className = 'beat-line' + (t % barDur < 0.001 ? ' bar' : '');
        line.style.left = x + 'px';
        overlay.appendChild(line);
      }
      ttrack.appendChild(overlay);
    }
  }

  function drawRuler() {
    const dpr = window.devicePixelRatio || 1;
    const w = timelineRuler.clientWidth;
    const h = timelineRuler.clientHeight;
    rulerCanvas.width = w * dpr;
    rulerCanvas.height = h * dpr;
    rulerCanvas.style.width = w + 'px';
    rulerCanvas.style.height = h + 'px';
    rulerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    rulerCtx.fillStyle = '#25252b';
    rulerCtx.fillRect(0, 0, w, h);

    rulerCtx.strokeStyle = '#3a3a42';
    rulerCtx.fillStyle = '#8a8a95';
    rulerCtx.font = '10px "SF Mono", Monaco, Consolas, monospace';

    const beatDur = getBeatDuration();
    const barDur = getBarDuration();
    const startSeconds = scrollOffsetX / pixelsPerSecond;
    const endSeconds = startSeconds + w / pixelsPerSecond;

    const startBeat = Math.floor(startSeconds / beatDur);
    const endBeat = Math.ceil(endSeconds / beatDur);

    for (let i = startBeat; i <= endBeat; i++) {
      const t = i * beatDur;
      const x = timeToX(t);
      if (x < -10 || x > w + 10) continue;

      const isBar = (t % barDur) < 0.001;

      if (isBar) {
        rulerCtx.strokeStyle = '#5a5a65';
        rulerCtx.lineWidth = 1;
        rulerCtx.beginPath();
        rulerCtx.moveTo(x, 0);
        rulerCtx.lineTo(x, h);
        rulerCtx.stroke();

        rulerCtx.fillStyle = '#b0b0b8';
        const barNum = Math.floor(t / barDur) + 1;
        rulerCtx.fillText(barNum.toString(), x + 3, 14);
        rulerCtx.fillText(formatTime(t), x + 3, h - 4);
      } else {
        rulerCtx.strokeStyle = '#3a3a42';
        rulerCtx.lineWidth = 1;
        rulerCtx.beginPath();
        rulerCtx.moveTo(x, h - 8);
        rulerCtx.lineTo(x, h);
        rulerCtx.stroke();
      }
    }

    rulerCtx.strokeStyle = '#0f0f12';
    rulerCtx.lineWidth = 1;
    rulerCtx.beginPath();
    rulerCtx.moveTo(0, h - 0.5);
    rulerCtx.lineTo(w, h - 0.5);
    rulerCtx.stroke();
  }

  function updateLevelMeters() {
    const now = performance.now();

    for (const track of tracks) {
      const analyser = track.analyser;
      if (!analyser) continue;

      analyser.getFloatTimeDomainData(track.levelDataL);
      let peakL = 0;
      for (let i = 0; i < track.levelDataL.length; i++) {
        const abs = Math.abs(track.levelDataL[i]);
        if (abs > peakL) peakL = abs;
      }

      let peakR = peakL;

      const effectiveGain = getEffectiveGain(track);
      peakL *= effectiveGain;
      peakR *= effectiveGain;

      for (let ch = 0; ch < 2; ch++) {
        const peak = ch === 0 ? peakL : peakR;
        const meter = document.querySelector(`.level-meter[data-track-id="${track.id}"][data-channel="${ch}"]`);
        if (!meter) continue;
        const fill = meter.querySelector('.level-fill');
        const peakEl = meter.querySelector('.level-peak');

        const db = 20 * Math.log10(Math.max(0.0001, peak));
        const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));

        fill.style.height = pct + '%';

        const currentPeak = trackPeakHold[track.id] ? trackPeakHold[track.id][ch] || 0 : 0;
        const peakHold = trackPeakHoldTime[track.id] ? trackPeakHoldTime[track.id][ch] || 0 : 0;

        if (pct > currentPeak || now - peakHold > 2000) {
          if (!trackPeakHold[track.id]) trackPeakHold[track.id] = [0, 0];
          if (!trackPeakHoldTime[track.id]) trackPeakHoldTime[track.id] = [0, 0];
          trackPeakHold[track.id][ch] = pct;
          trackPeakHoldTime[track.id][ch] = now;
        }

        const displayPeak = trackPeakHold[track.id] ? trackPeakHold[track.id][ch] : 0;
        peakEl.style.bottom = displayPeak + '%';
      }
    }
  }

  function drawSpectrum() {
    const dpr = window.devicePixelRatio || 1;
    const w = spectrumCanvas.clientWidth;
    const h = spectrumCanvas.clientHeight;
    spectrumCanvas.width = w * dpr;
    spectrumCanvas.height = h * dpr;
    spectrumCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    spectrumCtx.fillStyle = '#0a0a0e';
    spectrumCtx.fillRect(0, 0, w, h);

    if (!masterAnalyser) return;

    const freqData = new Uint8Array(masterAnalyser.frequencyBinCount);
    masterAnalyser.getByteFrequencyData(freqData);

    const barCount = SPECTRUM_BARS;
    const barWidth = w / barCount;
    const gap = 1;
    const minFreq = 20;
    const maxFreq = 20000;
    const minLog = Math.log10(minFreq);
    const maxLog = Math.log10(maxFreq);
    const nyquist = SAMPLE_RATE / 2;

    for (let i = 0; i < barCount; i++) {
      const freqLowLog = minLog + (maxLog - minLog) * (i / barCount);
      const freqHighLog = minLog + (maxLog - minLog) * ((i + 1) / barCount);
      const freqLow = Math.pow(10, freqLowLog);
      const freqHigh = Math.pow(10, freqHighLog);

      const binLow = Math.floor(freqLow / nyquist * freqData.length);
      const binHigh = Math.ceil(freqHigh / nyquist * freqData.length);

      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, binLow); j < Math.min(freqData.length, binHigh); j++) {
        sum += freqData[j];
        count++;
      }
      const avg = count > 0 ? sum / count : 0;

      const barHeight = (avg / 255) * h;
      spectrumPeaks[i] *= 0.95;
      if (barHeight > spectrumPeaks[i]) spectrumPeaks[i] = barHeight;

      const x = i * barWidth + gap / 2;
      const bw = barWidth - gap;
      const bh = Math.max(1, barHeight);
      const y = h - bh;

      const pct = i / barCount;
      const hue = 200 - pct * 180;
      spectrumCtx.fillStyle = `hsl(${hue}, 80%, 55%)`;
      spectrumCtx.fillRect(x, y, bw, bh);

      spectrumCtx.fillStyle = `hsla(${hue}, 80%, 70%, 0.8)`;
      const py = h - spectrumPeaks[i] - 1;
      spectrumCtx.fillRect(x, py, bw, 1);
    }
  }

  function drawScope() {
    const dpr = window.devicePixelRatio || 1;
    const w = scopeCanvas.clientWidth;
    const h = scopeCanvas.clientHeight;
    scopeCanvas.width = w * dpr;
    scopeCanvas.height = h * dpr;
    scopeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    scopeCtx.fillStyle = '#0a0a0e';
    scopeCtx.fillRect(0, 0, w, h);

    scopeCtx.strokeStyle = '#1a3a1a';
    scopeCtx.lineWidth = 1;
    scopeCtx.beginPath();
    scopeCtx.moveTo(0, h / 2);
    scopeCtx.lineTo(w, h / 2);
    scopeCtx.stroke();

    if (!masterAnalyser) return;

    masterAnalyser.getFloatTimeDomainData(scopeTimeData);

    scopeCtx.strokeStyle = '#4aff6a';
    scopeCtx.lineWidth = 1.5;
    scopeCtx.beginPath();

    const mid = h / 2;
    const amp = (h / 2) * 0.8;

    for (let i = 0; i < scopeTimeData.length; i++) {
      const x = (i / scopeTimeData.length) * w;
      const y = mid - scopeTimeData[i] * amp;
      if (i === 0) {
        scopeCtx.moveTo(x, y);
      } else {
        scopeCtx.lineTo(x, y);
      }
    }
    scopeCtx.stroke();
  }

  function renderFrame() {
    updatePlayhead();
    updateLevelMeters();
    drawSpectrum();
    drawScope();
    requestAnimationFrame(renderFrame);
  }

  async function handleFiles(files, targetTrackId) {
    for (const file of files) {
      if (!file.type.startsWith('audio/') && !/\.(wav|mp3|ogg)$/i.test(file.name)) continue;

      try {
        const buffer = await decodeAudioFile(file);
        const track = targetTrackId
          ? tracks.find(t => t.id === targetTrackId)
          : tracks[0];
        if (track) {
          let startTime = 0;
          if (track.clips.length > 0) {
            const lastClip = track.clips[track.clips.length - 1];
            startTime = lastClip.startTime + lastClip.duration;
          }
          addClipToTrack(track, buffer, file.name.replace(/\.[^/.]+$/, ''), startTime);
        }
      } catch (e) {
        console.error('解码音频失败:', e);
        alert('无法解码音频文件: ' + file.name);
      }
    }
  }

  function exportWAV() {
    ensureAudioContext();

    if (tracks.every(t => t.clips.length === 0)) {
      alert('没有音频可导出');
      return;
    }

    let maxEnd = 0;
    for (const track of tracks) {
      for (const clip of track.clips) {
        maxEnd = Math.max(maxEnd, clip.startTime + clip.duration);
      }
    }
    if (maxEnd === 0) {
      alert('没有音频可导出');
      return;
    }

    const duration = maxEnd + 0.5;
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
    const offlineMaster = offlineCtx.createGain();
    offlineMaster.gain.value = parseFloat(document.getElementById('master-volume').value) / 100;
    offlineMaster.connect(offlineCtx.destination);

    for (const track of tracks) {
      const tGain = offlineCtx.createGain();
      tGain.gain.value = getEffectiveGain(track);
      const tPan = offlineCtx.createStereoPanner();
      tPan.pan.value = track.pan;
      tGain.connect(tPan);
      tPan.connect(offlineMaster);

      for (const clip of track.clips) {
        const source = offlineCtx.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(tGain);
        source.start(clip.startTime);
      }
    }

    offlineCtx.startRendering().then((renderedBuffer) => {
      const wavBlob = audioBufferToWav(renderedBuffer);
      const now = new Date();
      const ts = now.getFullYear().toString()
        + String(now.getMonth() + 1).padStart(2, '0')
        + String(now.getDate()).padStart(2, '0') + '_'
        + String(now.getHours()).padStart(2, '0')
        + String(now.getMinutes()).padStart(2, '0')
        + String(now.getSeconds()).padStart(2, '0');
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mix_${ts}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch((e) => {
      console.error('导出失败:', e);
      alert('导出失败: ' + e.message);
    });
  }

  function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, bufferLength - 8, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    const channels = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let sample = channels[c][i];
        sample = Math.max(-1, Math.min(1, sample));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  function setupEventListeners() {
    document.getElementById('btn-play').addEventListener('click', togglePlay);
    document.getElementById('btn-stop').addEventListener('click', stopPlayback);
    document.getElementById('btn-export').addEventListener('click', exportWAV);

    document.getElementById('master-volume').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('master-value').textContent = val + '%';
      if (masterGain) masterGain.gain.value = val / 100;
    });

    document.getElementById('bpm-input').addEventListener('change', (e) => {
      bpm = Math.max(30, Math.min(300, parseInt(e.target.value, 10) || DEFAULT_BPM));
      e.target.value = bpm;
      drawRuler();
      renderGrid();
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files, pendingFileTrackId);
        fileInput.value = '';
        pendingFileTrackId = null;
      }
    });

    timelineScroll.addEventListener('scroll', () => {
      scrollOffsetX = timelineScroll.scrollLeft;
      drawRuler();
      renderGrid();
      updatePlayhead();
    });

    timelineScroll.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const oldPps = pixelsPerSecond;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newPps = Math.max(MIN_SECONDS_VISIBLE, Math.min(MAX_SECONDS_VISIBLE * 10, pixelsPerSecond * factor));
        if (newPps !== pixelsPerSecond) {
          const rect = timelineScroll.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseTime = xToTime(mouseX);
          pixelsPerSecond = newPps;
          scrollOffsetX = mouseTime * pixelsPerSecond - mouseX;
          timelineScroll.scrollLeft = scrollOffsetX;
          syncTimelineHeights();
          renderClips();
        }
      }
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

      if (e.code === 'Space' && !e.shiftKey) {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'Space' && e.shiftKey) {
        e.preventDefault();
        stopPlayback();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId !== null) {
        e.preventDefault();
        deleteSelectedClip();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedClipId !== null) {
        e.preventDefault();
        duplicateSelectedClip();
      } else if (e.altKey) {
        snapEnabled = false;
      }
    });

    document.addEventListener('keyup', (e) => {
      if (!e.altKey) snapEnabled = true;
    });

    document.body.addEventListener('dragover', (e) => {
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
      }
    });

    document.body.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const targetTimelineTrack = e.target.closest('.timeline-track');
        if (targetTimelineTrack) return;
        e.preventDefault();
        handleFiles(e.dataTransfer.files, null);
      }
    });

    timelineRuler.addEventListener('click', (e) => {
      ensureAudioContext();
      const rect = timelineRuler.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = xToTime(x);
      currentPlayTime = Math.max(0, time);
      if (isPlaying) {
        stopAllSources();
        applyTrackGains();
        schedulePlayback(currentPlayTime);
      }
      updatePlayhead();
    });

    window.addEventListener('resize', () => {
      drawRuler();
    });
  }

  function deleteSelectedClip() {
    for (const track of tracks) {
      const idx = track.clips.findIndex(c => c.id === selectedClipId);
      if (idx !== -1) {
        track.clips.splice(idx, 1);
        selectedClipId = null;
        updateTotalDuration();
        renderClips();
        syncTimelineHeights();
        return;
      }
    }
  }

  function duplicateSelectedClip() {
    for (const track of tracks) {
      const clip = track.clips.find(c => c.id === selectedClipId);
      if (clip) {
        const newClip = {
          id: nextClipId++,
          trackId: track.id,
          buffer: clip.buffer,
          name: clip.name + ' (副本)',
          startTime: clip.startTime + clip.duration,
          duration: clip.duration,
          waveform: clip.waveform,
          waveformWidth: clip.waveformWidth,
        };
        track.clips.push(newClip);
        track.clips.sort((a, b) => a.startTime - b.startTime);
        resolveClipOverlaps(track);
        selectedClipId = newClip.id;
        updateTotalDuration();
        renderClips();
        return;
      }
    }
  }

  function init() {
    initTracks();
    renderTracks();
    syncTimelineHeights();
    setupEventListeners();
    requestAnimationFrame(renderFrame);
    document.getElementById('time-total').textContent = formatTime(totalDuration);
    updatePlayhead();
  }

  init();
})();
