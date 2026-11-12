// TensorFlow Speech Commands adapter. No recorder or IndexedDB dependencies.
const TF_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const COMMANDS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/speech-commands@0.5.4/dist/speech-commands.min.js';
let loadPromise;
function script(url, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = url;
    tag.onload = () => window[globalName] ? resolve() : reject(new Error(globalName + ' unavailable'));
    tag.onerror = () => reject(new Error('Cannot load ' + url));
    document.head.append(tag);
  });
}
export async function loadCommands() {
  if (!loadPromise) loadPromise = (async () => {
    await script(TF_URL, 'tf');
    await script(COMMANDS_URL, 'speechCommands');
    const recognizer = window.speechCommands.create('BROWSER_FFT');
    await recognizer.ensureModelLoaded();
    const labels = recognizer.wordLabels();
    if (!['go','stop','yes','no'].every(label => labels.includes(label))) throw new Error('Go/Stop/Yes/No labels missing from model');
    return { recognizer, labels };
  })().catch(error => { loadPromise = null; throw error; });
  return loadPromise;
}
// Track asynchronous listener startup so a Stop request cannot race with listen().
const listenerStates = new WeakMap();
function stateFor(model) {
  let state = listenerStates.get(model.recognizer);
  if (!state) {
    state = { starting: null, stopping: null, generation: 0 };
    listenerStates.set(model.recognizer, state);
  }
  return state;
}

// Reuse the recording microphone by cloning its track during listener startup.
export async function startCommands(model, stream, overlapFactor, callback) {
  const state = stateFor(model);
  if (state.stopping) await state.stopping;
  if (state.starting || model.recognizer.isListening()) {
    throw new Error('Command recognizer is already starting or listening');
  }
  const generation = ++state.generation;
  const media = navigator.mediaDevices;
  const original = media.getUserMedia;
  const startup = (async () => {
    media.getUserMedia = function (constraints) {
      if (!constraints?.audio) return original.call(media, constraints);
      const track = stream?.getAudioTracks()?.[0];
      if (!track || track.readyState !== 'live') return Promise.reject(new Error('Shared microphone unavailable'));
      return Promise.resolve(new MediaStream([track.clone()]));
    };
    try {
      await model.recognizer.listen(result => {
        if (generation !== state.generation) return;
        const scores = Array.from(result.scores);
        const index = scores.indexOf(Math.max(...scores));
        callback({ top: model.labels[index], go: scores[model.labels.indexOf('go')], stop: scores[model.labels.indexOf('stop')], yes: scores[model.labels.indexOf('yes')], no: scores[model.labels.indexOf('no')] });
      }, { probabilityThreshold: 0, overlapFactor, invokeCallbackOnNoiseAndUnknown: true });
    } finally {
      media.getUserMedia = original;
    }
  })();
  state.starting = startup;
  try { await startup; }
  finally { if (state.starting === startup) state.starting = null; }
}

export async function stopCommands(model) {
  if (!model?.recognizer) return;
  const state = stateFor(model);
  ++state.generation; // Reject late callbacks immediately, including while startup is pending.
  if (state.stopping) return state.stopping;
  const stopping = (async () => {
    if (state.starting) {
      try { await state.starting; } catch (_) { /* startup failed; check actual state below */ }
    }
    if (model.recognizer.isListening()) await model.recognizer.stopListening();
  })();
  state.stopping = stopping;
  try { await stopping; }
  finally { if (state.stopping === stopping) state.stopping = null; }
}
