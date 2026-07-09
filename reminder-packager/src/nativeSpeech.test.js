import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock @capacitor/core so isNativePlatform() is true ---
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

// --- A fake @capacitor-community/speech-recognition plugin ---
// It emulates the real Android behavior: start() with partialResults:true
// resolves IMMEDIATELY with no matches, transcripts arrive via the
// `partialResults` event, and a cycle ends via `listeningState: stopped`.
let listeners;
let startCalls;
let permState = 'granted';

function makeMockPlugin() {
  listeners = { partialResults: [], listeningState: [] };
  startCalls = 0;
  permState = 'granted';
  const emit = (event, data) => { (listeners[event] || []).forEach(fn => fn(data)); };
  return {
    __emit: emit,
    available: async () => ({ available: true }),
    checkPermissions: async () => ({ speechRecognition: permState }),
    requestPermissions: async () => ({ speechRecognition: permState }),
    addListener: async (eventName, fn) => {
      listeners[eventName] = listeners[eventName] || [];
      listeners[eventName].push(fn);
      return { remove: () => { listeners[eventName] = listeners[eventName].filter(f => f !== fn); } };
    },
    // Emulates Android partialResults:true — resolves right away, empty.
    start: async () => { startCalls += 1; return {}; },
    stop: async () => {},
  };
}

let mockPlugin = makeMockPlugin();
vi.mock('@capacitor-community/speech-recognition', () => ({
  get SpeechRecognition() { return mockPlugin; },
}));

const flush = (ms = 0) => new Promise(r => setTimeout(r, ms));

describe('startNativeSpeech (native mic input capture)', () => {
  beforeEach(() => {
    mockPlugin = makeMockPlugin();
  });

  it('captures spoken partial results and delivers them on final', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    const partials = [];
    let finalText = '';
    let started = false;

    const ctrl = await startNativeSpeech({
      lang: 'en-US',
      onStart: () => { started = true; },
      onPartial: (t) => partials.push(t),
      onFinal: (t) => { finalText = t; },
      onError: () => {},
      onEnd: () => {},
    });

    await flush(10);
    expect(started).toBe(true);

    // Simulate the user speaking: recognizer signals it started, streams a
    // partial, then the utterance cycle stops.
    mockPlugin.__emit('listeningState', { status: 'started' });
    mockPlugin.__emit('partialResults', { matches: ['meeting at the bar tomorrow'] });
    await flush(5);
    mockPlugin.__emit('listeningState', { status: 'stopped' });
    await flush(20);

    // Partial was surfaced to the UI...
    expect(partials).toContain('meeting at the bar tomorrow');

    // ...and stopping the session delivers the committed transcript.
    ctrl.stop();
    await flush(600);
    expect(finalText).toBe('meeting at the bar tomorrow');
  });

  it('does NOT rapid-restart on the immediate start() resolution (no runaway loop)', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    const ctrl = await startNativeSpeech({
      lang: 'en-US',
      onStart: () => {}, onPartial: () => {}, onFinal: () => {}, onError: () => {}, onEnd: () => {},
    });

    // Recognizer starts a cycle and stays active (no 'stopped' yet).
    mockPlugin.__emit('listeningState', { status: 'started' });
    await flush(500); // well past the old 250ms restart interval

    // With the fix, start() is called once and NOT looped while the cycle is live.
    expect(startCalls).toBe(1);
    ctrl.abort();
    await flush(10);
  });

  it('accumulates across multiple utterance cycles', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    let finalText = '';
    const ctrl = await startNativeSpeech({
      lang: 'en-US',
      onStart: () => {}, onPartial: () => {}, onFinal: (t) => { finalText = t; }, onError: () => {}, onEnd: () => {},
    });
    await flush(10);

    // Cycle 1
    mockPlugin.__emit('listeningState', { status: 'started' });
    mockPlugin.__emit('partialResults', { matches: ['call John'] });
    mockPlugin.__emit('listeningState', { status: 'stopped' });
    await flush(400); // triggers auto-restart -> start() again

    // Cycle 2
    mockPlugin.__emit('listeningState', { status: 'started' });
    mockPlugin.__emit('partialResults', { matches: ['at three pm'] });
    mockPlugin.__emit('listeningState', { status: 'stopped' });
    await flush(20);

    ctrl.stop();
    await flush(600);
    expect(finalText).toBe('call John at three pm');
    expect(startCalls).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates cumulative native partials across restart cycles', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    let finalText = '';
    const partials = [];
    const ctrl = await startNativeSpeech({
      lang: 'en-US',
      onStart: () => {}, onPartial: (t) => partials.push(t), onFinal: (t) => { finalText = t; }, onError: () => {}, onEnd: () => {},
    });
    await flush(10);

    mockPlugin.__emit('listeningState', { status: 'started' });
    mockPlugin.__emit('partialResults', { matches: ['call John'] });
    mockPlugin.__emit('listeningState', { status: 'stopped' });
    await flush(260);

    mockPlugin.__emit('listeningState', { status: 'started' });
    // Some Android recognizers send the previous phrase plus the new words.
    mockPlugin.__emit('partialResults', { matches: ['call John at three pm'] });
    mockPlugin.__emit('listeningState', { status: 'stopped' });
    await flush(20);

    ctrl.stop();
    await flush(600);
    expect(finalText).toBe('call John at three pm');
    expect(finalText).not.toContain('call John call John');
    expect(partials.at(-1)).toBe('call John at three pm');
  });

  it('does not re-emit identical repeated partial text', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    const partials = [];
    const ctrl = await startNativeSpeech({
      lang: 'en-US',
      onStart: () => {}, onPartial: (t) => partials.push(t), onFinal: () => {}, onError: () => {}, onEnd: () => {},
    });
    await flush(10);

    mockPlugin.__emit('listeningState', { status: 'started' });
    mockPlugin.__emit('partialResults', { matches: ['meeting tomorrow'] });
    mockPlugin.__emit('partialResults', { matches: ['meeting tomorrow'] });
    mockPlugin.__emit('partialResults', { matches: ['meeting tomorrow'] });
    await flush(10);

    expect(partials).toEqual(['meeting tomorrow']);
    ctrl.abort();
  });


  it('collapses repeated words and phrases from noisy native partials', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    const partials = [];
    let finalText = '';
    const ctrl = await startNativeSpeech({
      lang: 'en-US',
      onStart: () => {},
      onPartial: (t) => partials.push(t),
      onFinal: (t) => { finalText = t; },
      onError: () => {},
      onEnd: () => {},
    });
    await flush(10);

    mockPlugin.__emit('listeningState', { status: 'started' });
    mockPlugin.__emit('partialResults', { matches: ['have have appointment have appointment with Andy have appointment with Andy tomorrow morning have appointment with Andy tomorrow morning at 5 pm'] });
    mockPlugin.__emit('listeningState', { status: 'stopped' });
    await flush(20);
    ctrl.stop();
    await flush(600);

    expect(partials.at(-1)).toBe('have appointment with Andy tomorrow morning at 5 pm');
    expect(finalText).toBe('have appointment with Andy tomorrow morning at 5 pm');
  });


  it('collapses growing-prefix native loops from repeated self-heard speech', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    const partials = [];
    let finalText = '';
    const ctrl = await startNativeSpeech({
      lang: 'en-US',
      onStart: () => {},
      onPartial: (t) => partials.push(t),
      onFinal: (t) => { finalText = t; },
      onError: () => {},
      onEnd: () => {},
    });
    await flush(10);

    mockPlugin.__emit('listeningState', { status: 'started' });
    mockPlugin.__emit('partialResults', { matches: ['have have appointment have appointment tomorrow have appointment tomorrow have appointment tomorrow have appointment tomorrow at have appointment tomorrow at 5:00 p.m.'] });
    mockPlugin.__emit('listeningState', { status: 'stopped' });
    await flush(20);
    ctrl.stop();
    await flush(600);

    expect(partials.at(-1)).toBe('have appointment tomorrow at 5:00 p.m.');
    expect(finalText).toBe('have appointment tomorrow at 5:00 p.m.');
  });



  it('Smart Mode keeps native listening open until voice input, then applies the 1-second silence rule', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    let err = '';
    let ended = false;
    let finalText = '';
    await startNativeSpeech({
      lang: 'en-US',
      silenceTimeoutMs: 1000,
      onStart: () => {},
      onPartial: () => {},
      onFinal: (t) => { finalText = t; },
      onError: (m) => { err = m; },
      onEnd: () => { ended = true; },
    });
    mockPlugin.__emit('listeningState', { status: 'started' });
    await flush(1120);
    expect(ended).toBe(false);
    expect(err).toBe('');

    mockPlugin.__emit('partialResults', { matches: ['meeting with Andy'] });
    await flush(1120);
    expect(ended).toBe(true);
    expect(finalText).toBe('meeting with Andy');
  });

  it('Smart Mode finalizes native speech 1 second after the last voice input', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    let finalText = '';
    let ended = false;
    await startNativeSpeech({
      lang: 'en-US',
      silenceTimeoutMs: 1000,
      onStart: () => {},
      onPartial: () => {},
      onFinal: (t) => { finalText = t; },
      onError: () => {},
      onEnd: () => { ended = true; },
    });
    mockPlugin.__emit('listeningState', { status: 'started' });
    mockPlugin.__emit('partialResults', { matches: ['meet Andy at five'] });
    await flush(1120);
    expect(ended).toBe(true);
    expect(finalText).toBe('meet Andy at five');
  });

  it('reports an error when permission is denied', async () => {
    const { startNativeSpeech } = await import('./nativeSpeech.js');
    // Force denial via the shared permission flag (read live on each call).
    permState = 'denied';

    let err = '';
    let ended = false;
    await startNativeSpeech({
      lang: 'en-US',
      onStart: () => {}, onPartial: () => {}, onFinal: () => {},
      onError: (m) => { err = m; }, onEnd: () => { ended = true; },
    });
    await flush(10);
    expect(err).toMatch(/permission/i);
    expect(ended).toBe(true);
  });
});
