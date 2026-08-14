export const harnessTtsCss = `
  [data-harnessdesk-tts] {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 28px !important;
    height: 28px !important;
    margin-left: 4px !important;
    padding: 0 !important;
    border: 1px solid rgba(77, 107, 254, .18) !important;
    border-radius: 8px !important;
    color: #4d6bfe !important;
    background: rgba(240, 245, 255, .78) !important;
    cursor: pointer !important;
    font: 15px/1 system-ui, sans-serif !important;
    transition: background-color .16s ease, color .16s ease, transform .11s ease !important;
  }
  [data-harnessdesk-tts]:hover { color: #fff !important; background: #4d6bfe !important; }
  [data-harnessdesk-tts]:active { transform: translateY(1px) !important; }
  [data-harnessdesk-tts][data-state="playing"] { color: #fff !important; background: #3855e8 !important; }
  [data-harnessdesk-tts][data-state="error"] { color: #b5444c !important; border-color: rgba(181, 68, 76, .3) !important; }
`

export const harnessTtsScript = String.raw`(() => {
  if (window.__harnessDeskTtsInstalled) return;
  window.__harnessDeskTtsInstalled = true;
  let config = { enabled: false, autoPlay: false, endpoint: '', model: 'mimo-v2.5-tts', voice: 'mimo_default', style: '', format: 'wav' };
  let activeAudio = null;
  let activeAudioUrl = null;
  let activeStreamId = null;
  let activeButton = null;
  let audioContext = null;
  let nextAudioTime = 0;
  let streamFinished = false;
  const activeSources = new Set();
  const pendingStreamEvents = new Map();
  const knownTurns = new Set();
  const configApi = window.harnessdesk;

  function textFor(root) {
    const copy = root.cloneNode(true);
    copy.querySelectorAll('button, [role="button"], [aria-hidden="true"], [data-harnessdesk-tts]').forEach((node) => node.remove());
    return (copy.innerText || copy.textContent || '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
  }

  function answerRootFor(tail) {
    const tailRow = tail.closest('[data-chat-anchor-key]');
    if (!tailRow) return null;
    let sibling = tailRow.previousElementSibling;
    while (sibling) {
      if (sibling.getAttribute('data-chat-flow-kind') === 'assistant-step') return sibling;
      sibling = sibling.previousElementSibling;
    }
    return null;
  }

  function setButtonState(button, state) {
    if (!button) return;
    if (state) button.dataset.state = state; else delete button.dataset.state;
    button.textContent = state === 'playing' ? '■' : state === 'loading' ? '…' : '🔊';
    button.title = state === 'playing' ? 'Stop reading' : state === 'loading' ? 'Preparing audio' : state === 'error' ? 'Retry reading' : 'Read answer aloud';
  }

  function finishActiveButton(state) {
    if (activeButton) setButtonState(activeButton, state || '');
    activeButton = null;
  }

  function stopActivePlayback() {
    if (activeStreamId) void configApi.stopTtsStream(activeStreamId);
    activeStreamId = null;
    streamFinished = true;
    activeSources.forEach((source) => { try { source.stop(); } catch {} });
    activeSources.clear();
    if (activeAudio) activeAudio.pause();
    activeAudio = null;
    if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
    nextAudioTime = 0;
    finishActiveButton('');
  }

  function audioContextFor() {
    if (audioContext) return audioContext;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    audioContext = new AudioContextCtor();
    return audioContext;
  }

  function queuePcmChunk(event) {
    const context = audioContextFor();
    if (!context || !event.audioBase64) return;
    const binary = atob(event.audioBase64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const sampleCount = Math.floor(bytes.length / 2);
    if (sampleCount === 0) return;
    const buffer = context.createBuffer(1, sampleCount, event.sampleRate || 24000);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    for (let index = 0; index < sampleCount; index += 1) channel[index] = view.getInt16(index * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(nextAudioTime, context.currentTime + 0.025);
    nextAudioTime = startAt + buffer.duration;
    activeSources.add(source);
    source.addEventListener('ended', () => {
      activeSources.delete(source);
      if (streamFinished && activeSources.size === 0 && activeStreamId === event.streamId) {
        activeStreamId = null;
        finishActiveButton('');
      }
    }, { once: true });
    source.start(startAt);
  }

  function consumeStreamEvent(event) {
    if (event.type === 'chunk') {
      queuePcmChunk(event);
      if (activeButton) setButtonState(activeButton, 'playing');
    } else if (event.type === 'ended') {
      streamFinished = true;
      if (activeSources.size === 0) {
        activeStreamId = null;
        finishActiveButton('');
      }
    } else if (event.type === 'error') {
      activeStreamId = null;
      activeSources.forEach((source) => { try { source.stop(); } catch {} });
      activeSources.clear();
      if (activeButton) {
        setButtonState(activeButton, 'error');
        activeButton.title = event.error || 'MiMo TTS failed';
      }
      activeButton = null;
    }
  }

  function onStreamEvent(event) {
    if (activeStreamId === event.streamId) {
      consumeStreamEvent(event);
      return;
    }
    const queued = pendingStreamEvents.get(event.streamId) || [];
    if (queued.length < 64) queued.push(event);
    pendingStreamEvents.set(event.streamId, queued);
  }

  async function playFull(button, text) {
    const result = await configApi.speakText(text);
    if (!result || !result.ok || !result.audioBase64) {
      setButtonState(button, 'error');
      button.title = result?.error || 'MiMo TTS failed';
      activeButton = null;
      return;
    }
    const binary = atob(result.audioBase64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.format === 'wav' ? 'audio/wav' : 'audio/mpeg' }));
    const audio = new Audio(objectUrl);
    activeAudio = audio;
    activeAudioUrl = objectUrl;
    const release = () => { URL.revokeObjectURL(objectUrl); if (activeAudioUrl === objectUrl) activeAudioUrl = null; };
    audio.addEventListener('ended', () => { release(); if (activeAudio === audio) activeAudio = null; finishActiveButton(''); });
    audio.addEventListener('error', () => { release(); if (activeAudio === audio) activeAudio = null; setButtonState(button, 'error'); activeButton = null; });
    try {
      await audio.play();
      setButtonState(button, 'playing');
    } catch (error) {
      release();
      if (activeAudio === audio) activeAudio = null;
      setButtonState(button, 'error');
      activeButton = null;
      button.title = error instanceof Error ? error.message : 'Audio playback was blocked';
    }
  }

  async function play(button, text) {
    if (activeButton === button && (activeStreamId || activeAudio || button.dataset.state === 'loading')) {
      stopActivePlayback();
      return;
    }
    stopActivePlayback();
    activeButton = button;
    setButtonState(button, 'loading');
    if (config.model !== 'mimo-v2.5-tts') {
      await playFull(button, text);
      return;
    }
    const context = audioContextFor();
    if (!context) {
      await playFull(button, text);
      return;
    }
    try { await context.resume(); } catch {}
    streamFinished = false;
    nextAudioTime = 0;
    const result = await configApi.startTtsStream(text);
    if (!result || !result.ok || !result.streamId) {
      setButtonState(button, 'error');
      button.title = result?.error || 'MiMo TTS stream failed';
      activeButton = null;
      return;
    }
    activeStreamId = result.streamId;
    const queued = pendingStreamEvents.get(result.streamId) || [];
    pendingStreamEvents.delete(result.streamId);
    queued.forEach(consumeStreamEvent);
  }

  function removeButtons() {
    stopActivePlayback();
    document.querySelectorAll('[data-harnessdesk-tts]').forEach((node) => node.remove());
  }

  function enhance(root, allowAutoPlay) {
    if (!(root instanceof HTMLElement) || !config.enabled) return;
    const answerRoot = answerRootFor(root);
    if (!answerRoot) return;
    const text = textFor(answerRoot);
    if (text.length < 2) return;
    const turn = root.getAttribute('data-turn-tail') || '';
    if (root.querySelector('[data-harnessdesk-tts]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.harnessdeskTts = 'true';
    button.setAttribute('aria-label', 'Read answer aloud');
    setButtonState(button, '');
    button.addEventListener('click', () => { void play(button, text) });
    const existing = root.querySelector('button');
    const host = existing?.parentElement || root;
    host.appendChild(button);
    if (allowAutoPlay && config.autoPlay && !knownTurns.has(turn)) {
      knownTurns.add(turn);
      window.setTimeout(() => { void play(button, text) }, 80);
    }
  }

  function scan(allowAutoPlay) {
    document.querySelectorAll('[data-turn-tail]').forEach((node) => enhance(node, allowAutoPlay));
  }

  configApi.getTtsConfig().then((next) => {
    config = next;
    scan(false);
  }).catch(() => undefined);
  configApi.onTtsStream(onStreamEvent);
  configApi.onTtsConfig((next) => {
    config = next;
    if (!config.enabled) removeButtons(); else scan(false);
  });

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const root = node.matches('[data-turn-tail]') ? node : node.querySelector('[data-turn-tail]');
        if (root) enhance(root, true);
        else if (node.matches('[data-chat-flow-kind="assistant-step"]') || node.querySelector('[data-chat-flow-kind="assistant-step"]')) scan(true);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();`
