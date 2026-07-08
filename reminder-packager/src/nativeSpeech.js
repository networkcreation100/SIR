// Native-aware speech capture.
// On a Capacitor native app (Android/iOS) the WebView has NO Web Speech API
// (window.SpeechRecognition / webkitSpeechRecognition are undefined), which is
// why the microphone works on desktop browsers but silently fails in the
// App Store / Play Store builds. This bridges to the native speech plugin when
// running inside Capacitor, and falls back to the Web Speech API on the web.
//
// IMPORTANT (published-app mic auto-stop fix):
// Android's native SpeechRecognizer (behind @capacitor-community/speech-recognition)
// is a *single-utterance* engine. It ends the session on the first short silence
// — often ~0.5s, sometimes before the user has even started speaking. In the dev
// browser the Web Speech API is far more forgiving, so the bug only shows up in
// the Play Store / App Store build. To make the native mic behave like continuous
// dictation, we AUTO-RESTART the recognizer whenever it ends on its own, and only
// truly stop when the user taps the mic again (controller.stop()). Partial and
// final transcripts are accumulated across restarts so nothing is lost.

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
    let listener = null;          // partialResults listener (Android)
    // Committed = finalized utterances from previous restart cycles.
    // liveChunk = the current cycle's best partial (replaced, not appended).
    let committed = '';
    let liveChunk = '';
    const MAX_SILENCE_RESTARTS = 40; // safety cap (~ generous; user normally stops manually)
    let restarts = 0;

    const joinText = (a, b) => [a, b].map(s => (s || '').trim()).filter(Boolean).join(' ').trim();

    const emitPartial = () => {
      const combined = joinText(committed, liveChunk);
      if (combined) onPartial && onPartial(combined);
    };

    const finishSession = (message) => {
      if (ended) return;
      ended = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      try { if (listener && listener.remove) listener.remove(); } catch { /* ignore */ }
      const finalText = joinText(committed, liveChunk);
      if (finalText) {
        onFinal && onFinal(finalText);
      } else if (message) {
        onError && onError(message);
      }
      onEnd && onEnd();
    };

    // Live partial results (Android). iOS returns everything via the start() promise.
    try {
      listener = await Plugin.addListener('partialResults', (data) => {
        const text = (data && data.matches && data.matches[0]) ? String(data.matches[0]).trim() : '';
        if (text) {
          liveChunk = text;
          emitPartial();
        }
      });
    } catch { /* partialResults not supported on this platform */ }

    const runCycle = () => {
      if (stopped) return;
      Plugin.start({
        language: lang || 'en-US',
        maxResults: 2,
        partialResults: true,
        popup: false,
      }).then((result) => {
        // A cycle produced a final result. Commit it and keep listening.
        const matches = (result && result.matches) || [];
        const finalText = matches.length ? String(matches[0]).trim() : '';
        const chunk = finalText || liveChunk;
        if (chunk) {
          committed = joinText(committed, chunk);
          liveChunk = '';
          emitPartial();
        }
      }).catch((err) => {
        // Common "quiet"/no-match errors on Android are normal end-of-utterance
        // events, NOT fatal. Keep the mic alive unless the user stopped it.
        const raw = (err && (err.message || err.code || err)) || '';
        const msg = String(raw).toLowerCase();
        const fatal = /denied|permission|not\s*available|unavailable|not\s*allowed|network/.test(msg)
          && !/no\s*match|no\s*speech|speech\s*timeout|timeout|busy|client|recognizer/.test(msg);
        if (fatal && !stopped) {
          stopped = true;
          finishSession('Voice capture stopped: ' + (raw || 'microphone unavailable') + '.');
          return;
        }
        // otherwise fall through to auto-restart below
      }).finally(() => {
        if (stopped) { finishSession(committed || liveChunk ? '' : 'No speech detected. Tap the microphone and try again.'); return; }
        if (restarts >= MAX_SILENCE_RESTARTS) { finishSession(''); return; }
        restarts += 1;
        // Small gap lets Android release the recognizer before we re-arm it.
        restartTimer = setTimeout(() => { if (!stopped) runCycle(); }, 250);
      });
    };

    onStart && onStart();
    runCycle();

    const stop = () => {
      stopped = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      try { Plugin.stop(); } catch { /* ignore */ }
      // Give the in-flight cycle a moment to resolve & commit, then finalize.
      setTimeout(() => finishSession(committed || liveChunk ? '' : 'No speech detected. Tap the microphone and try again.'), 400);
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
