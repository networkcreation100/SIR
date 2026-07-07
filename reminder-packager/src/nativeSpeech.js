// Native-aware speech capture.
// On a Capacitor native app (Android/iOS) the WebView has NO Web Speech API
// (window.SpeechRecognition / webkitSpeechRecognition are undefined), which is
// why the microphone works on desktop browsers but silently fails in the
// App Store / Play Store builds. This bridges to the native speech plugin when
// running inside Capacitor, and falls back to the Web Speech API on the web.

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
//   onPartial(text)      -> interim transcript
//   onFinal(text)        -> final transcript
//   onError(message)     -> human-readable error
//   onEnd()              -> called when the session ends
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

    let listener = null;
    // Live partial results (Android). iOS returns everything via the start() promise.
    try {
      listener = await Plugin.addListener('partialResults', (data) => {
        const text = (data && data.matches && data.matches[0]) ? String(data.matches[0]).trim() : '';
        if (text) onPartial && onPartial(text);
      });
    } catch { /* partialResults not supported on this platform */ }

    onStart && onStart();

    Plugin.start({
      language: lang || 'en-US',
      maxResults: 2,
      partialResults: true,
      popup: false,
    }).then((result) => {
      const matches = (result && result.matches) || [];
      const finalText = matches.length ? String(matches[0]).trim() : '';
      if (finalText) onFinal && onFinal(finalText);
      else onError && onError('No speech detected. Tap the microphone and try again.');
    }).catch((err) => {
      onError && onError('Voice capture stopped: ' + ((err && (err.message || err)) || 'microphone unavailable') + '.');
    }).finally(() => {
      if (listener && listener.remove) listener.remove();
      onEnd && onEnd();
    });

    return {
      stop() { try { Plugin.stop(); } catch {} },
      abort() { try { Plugin.stop(); } catch {} },
    };
  } catch (err) {
    onError && onError('Voice capture unavailable: ' + ((err && (err.message || err)) || 'unknown error') + '.');
    onEnd && onEnd();
    return { stop() {}, abort() {} };
  }
}
