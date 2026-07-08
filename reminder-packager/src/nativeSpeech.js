// Native-aware speech capture.
// On a Capacitor native app (Android/iOS) the WebView has NO Web Speech API
// (window.SpeechRecognition / webkitSpeechRecognition are undefined), which is
// why the microphone works on desktop browsers but silently fails in the
// App Store / Play Store builds. This bridges to the native speech plugin when
// running inside Capacitor, and falls back to the Web Speech API on the web.
//
// IMPORTANT — two native bugs this file works around:
//
// 1) SINGLE-UTTERANCE AUTO-STOP: Android's native SpeechRecognizer ends the
//    session on the first short silence (~0.5s). To behave like continuous
//    dictation we AUTO-RESTART whenever a cycle ends, and only truly stop when
//    the user taps the mic again (controller.stop()).
//
// 2) "ACTIVE BUT NO INPUT" (this fix): with `partialResults: true`, the plugin's
//    start() promise RESOLVES IMMEDIATELY with no matches (it's documented to
//    "respond directly without result"). The previous implementation treated
//    that instant resolution as end-of-cycle and re-armed the recognizer every
//    ~250ms, so the recognizer was torn down and restarted faster than it could
//    ever capture audio — the mic looked active but received nothing.
//    The corrected control flow below does NOT restart on the start() promise.
//    Instead it listens to the `listeningState` event: a cycle is only
//    considered finished when we get `status === 'stopped'`, and only THEN (if
//    the user hasn't stopped) do we auto-restart. Transcripts come from the
//    `partialResults` listener (accumulated across cycles).

let SpeechRecognitionPlugin = null;
let capacitorRef = null;

async function loadNative() {
  if (SpeechRecognitionPlugin && capacitorRef) return true;
  try {
    const core = await import('@capacitor/core');
    capacitorRef = core.Capacitor;
    if (!capacitorRef || !capacitorRef.isNativePlatform || !capacitorRef.isNativePlatform()) {
      return false;
    }
    const mod = await import('@capacitor-community/speech-recognition');
    SpeechRecognitionPlugin = mod.SpeechRecognition;
    return !!SpeechRecognitionPlugin;
  } catch (err) {
    return false;
  }
}

export function isNativePlatform() {
  try {
    return !!(capacitorRef && capacitorRef.isNativePlatform && capacitorRef.isNativePlatform());
  } catch {
    return false;
  }
}

// Unified capture. Callbacks mirror the Web Speech API handlers the app already uses:
//   onStart()            -> called once listening begins
//   onPartial(text)      -> interim transcript (accumulated across restarts)
//   onFinal(text)        -> final transcript (accumulated across restarts)
//   onError(message)     -> human-readable error
//   onEnd()              -> called when the WHOLE session ends (after the user stops)
// Returns a controller with .stop()/.abort(). If native is unavailable it
// returns null so the caller can fall back to the Web Speech API.
export async function startNativeSpeech({ lang, onStart, onPartial, onFinal, onError, onEnd }) {
  const ok = await loadNative();
  if (!ok) return null;

  const Plugin = SpeechRecognitionPlugin;
  try {
    // Bail early if the device has no speech recognition service at all.
    try {
      const avail = await Plugin.available();
      if (avail && avail.available === false) {
        onError && onError('Speech recognition is not available on this device.');
        onEnd && onEnd();
        return { stop() {}, abort() {} };
      }
    } catch { /* available() not implemented on some platforms — continue */ }

    // Ensure permission (prompts the user the first time).
    const perm = await Plugin.checkPermissions().catch(() => null);
    if (!perm || perm.speechRecognition !== 'granted') {
      const req = await Plugin.requestPermissions().catch(() => null);
      if (!req || req.speechRecognition !== 'granted') {
        onError && onError('Microphone permission was denied. Enable it in Settings to use voice input.');
        onEnd && onEnd();
        return { stop() {}, abort() {} };
      }
    }

    // ---- session state shared across auto-restarts ----
    let stopped = false;          // set true only when the user taps to stop
    let ended = false;            // guards onEnd() from firing twice
    let restartTimer = null;      // pending auto-restart timer
    let cycleActive = false;      // true between listeningState started/stopped
    let partialListener = null;   // partialResults listener (Android)
    let stateListener = null;     // listeningState listener (Android, since 5.1)
    // committed = finalized utterances from previous restart cycles.
    // liveChunk = the current cycle's best partial (replaced, not appended).
    let committed = '';
    let liveChunk = '';
    const MAX_SILENCE_RESTARTS = 60; // safety cap (user normally stops manually)
    let restarts = 0;

    const joinText = (a, b) => [a, b].map(s => (s || '').trim()).filter(Boolean).join(' ').trim();

    const emitPartial = () => {
      const combined = joinText(committed, liveChunk);
      if (combined) onPartial && onPartial(combined);
    };

    // Roll the current cycle's live partial into committed text.
    const commitLiveChunk = () => {
      if (liveChunk && liveChunk.trim()) {
        committed = joinText(committed, liveChunk);
        liveChunk = '';
      }
    };

    const cleanupListeners = () => {
      try { if (partialListener && partialListener.remove) partialListener.remove(); } catch { /* ignore */ }
      try { if (stateListener && stateListener.remove) stateListener.remove(); } catch { /* ignore */ }
      partialListener = null;
      stateListener = null;
    };

    const finishSession = (message) => {
      if (ended) return;
      ended = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      cleanupListeners();
      commitLiveChunk();
      const finalText = committed.trim();
      if (finalText) {
        onFinal && onFinal(finalText);
      } else if (message) {
        onError && onError(message);
      }
      onEnd && onEnd();
    };

    const scheduleRestart = () => {
      if (stopped || ended) return;
      if (restarts >= MAX_SILENCE_RESTARTS) { finishSession(''); return; }
      restarts += 1;
      // Small gap lets Android release the recognizer before we re-arm it.
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => { if (!stopped && !ended) runCycle(); }, 350);
    };

    // Live partial results (Android). iOS returns everything via the start() promise.
    try {
      partialListener = await Plugin.addListener('partialResults', (data) => {
        const text = (data && data.matches && data.matches[0]) ? String(data.matches[0]).trim() : '';
        if (text) {
          liveChunk = text;
          emitPartial();
        }
      });
    } catch { /* partialResults not supported on this platform */ }

    // Cycle lifecycle via listeningState. This is the KEY fix: we restart when a
    // cycle actually STOPS, not when the start() promise resolves (which happens
    // immediately when partialResults is true).
    let hasStateEvents = false;
    try {
      stateListener = await Plugin.addListener('listeningState', (data) => {
        const status = data && data.status;
        if (status === 'started') {
          hasStateEvents = true;
          cycleActive = true;
        } else if (status === 'stopped') {
          hasStateEvents = true;
          cycleActive = false;
          // End of an utterance cycle. Commit what we heard and keep going.
          commitLiveChunk();
          emitPartial();
          scheduleRestart();
        }
      });
    } catch { /* listeningState not supported — fall back to promise-driven cycling */ }

    const runCycle = () => {
      if (stopped || ended) return;
      cycleActive = true;
      Plugin.start({
        language: lang || 'en-US',
        maxResults: 5,
        partialResults: true,
        popup: false,
      }).then((result) => {
        // With partialResults, this may resolve immediately (empty) OR, on some
        // platforms/iOS, carry the final matches. Capture matches if present.
        const matches = (result && result.matches) || [];
        const finalText = matches.length ? String(matches[0]).trim() : '';
        if (finalText) {
          liveChunk = finalText;
          emitPartial();
        }
        // If the platform gives us NO listeningState events, we can't know when
        // the cycle really ends, so fall back to promise-driven restarts (with a
        // delay long enough to actually capture speech).
        if (!hasStateEvents) {
          commitLiveChunk();
          emitPartial();
          if (!stopped && !ended) {
            if (restartTimer) clearTimeout(restartTimer);
            restartTimer = setTimeout(() => { if (!stopped && !ended) runCycle(); }, 700);
          }
        }
        // When hasStateEvents is true, the 'stopped' handler drives the restart —
        // do NOT restart here (that was the original bug: instant re-arm loop).
      }).catch((err) => {
        const raw = (err && (err.message || err.code || err)) || '';
        const msg = String(raw).toLowerCase();
        // Fatal permission/availability errors stop the whole session.
        const fatal = /denied|permission|not\s*available|unavailable|not\s*allowed/.test(msg)
          && !/no\s*match|no\s*speech|speech\s*timeout|timeout|busy|client|recognizer|network/.test(msg);
        if (fatal && !stopped) {
          stopped = true;
          finishSession('Voice capture stopped: ' + (raw || 'microphone unavailable') + '.');
          return;
        }
        // Non-fatal (no-match / timeout / recognizer busy): treat as end of cycle
        // and restart, but only if the platform isn't already driving restarts
        // through listeningState.
        cycleActive = false;
        if (!hasStateEvents) {
          commitLiveChunk();
          scheduleRestart();
        }
      });
    };

    onStart && onStart();
    runCycle();

    const stop = () => {
      stopped = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      try { Plugin.stop(); } catch { /* ignore */ }
      // Give the in-flight cycle a moment to resolve & commit, then finalize.
      setTimeout(() => finishSession((committed || liveChunk) ? '' : 'No speech detected. Tap the microphone and try again.'), 500);
    };

    return {
      stop,
      abort() {
        stopped = true;
        if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
        try { Plugin.stop(); } catch { /* ignore */ }
        finishSession('');
      },
    };
  } catch (err) {
    onError && onError('Voice capture unavailable: ' + ((err && (err.message || err)) || 'unknown error') + '.');
    onEnd && onEnd();
    return { stop() {}, abort() {} };
  }
}
