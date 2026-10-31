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
    if (!labels.includes('go') || !labels.includes('stop')) throw new Error('Go/Stop labels missing from model');
    return { recognizer, labels };
  })().catch(error => { loadPromise = null; throw error; });
  return loadPromise;
}
// The lab shared an existing microphone by temporarily returning a cloned track.
// Always restore getUserMedia, including when starting inference throws.
export async function startCommands(model, stream, overlapFactor, callback) {
  const media = navigator.mediaDevices;
  const original = media.getUserMedia;
  media.getUserMedia = function (constraints) {
    if (!constraints?.audio) return original.call(media, constraints);
    const track = stream?.getAudioTracks()?.[0];
    if (!track || track.readyState !== 'live') return Promise.reject(new Error('Shared microphone unavailable'));
    return Promise.resolve(new MediaStream([track.clone()]));
  };
  try {
    await model.recognizer.listen(result => {
      const scores = Array.from(result.scores);
      const index = scores.indexOf(Math.max(...scores));
      callback({ top: model.labels[index], go: scores[model.labels.indexOf('go')], stop: scores[model.labels.indexOf('stop')] });
    }, { probabilityThreshold: 0, overlapFactor, invokeCallbackOnNoiseAndUnknown: true });
  } finally {
    media.getUserMedia = original;
  }
}
export async function stopCommands(model) {
  if (model?.recognizer?.isListening()) await model.recognizer.stopListening();
}
