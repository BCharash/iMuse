// Dedicated production worker. Reuse pinned local model/runtime assets, not lab orchestration.
import * as ort from './lab/vendor/ort.min.mjs';
import { StreamingResampler, SileroV5Context } from './speech-detection-core.js';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('./lab/vendor/', import.meta.url).href;
let session, serial = Promise.resolve(), epoch = -1, resampler, state, buffer, position, history;
const context = new SileroV5Context();
function reset(message) {
    epoch = message.epoch;
    resampler = new StreamingResampler(message.sampleRate);
    context.reset();
    state = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]);
    buffer = new Float32Array(0); position = 0; history = [];
}
async function frameScore(frame) {
    const input = context.prepend(frame);
    const result = await session.run({ input: new ort.Tensor('float32', input, [1, 576]), state,
        sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), []) });
    state = result.stateN;
    return Number(result.output.data[0]);
}
self.onmessage = ({ data: message }) => {
    serial = serial.then(async () => {
        try {
            if (message.type === 'prepare') {
                session = await ort.InferenceSession.create(new URL('./lab/vendor/silero_vad_v5.onnx', import.meta.url).href,
                    { executionProviders: ['wasm'] });
                reset({ epoch: -1, sampleRate: 16000 });
                await frameScore(new Float32Array(512));
                self.postMessage({ type: 'ready' });
            } else if (message.type === 'audio') {
                if (!session) throw Error('Silero is not ready');
                if (message.epoch !== epoch) reset(message);
                const pcm = resampler.push(message.pcm);
                const joined = new Float32Array(buffer.length + pcm.length);
                joined.set(buffer); joined.set(pcm, buffer.length); buffer = joined;
                while (buffer.length >= 512) {
                    const frame = buffer.slice(0, 512); buffer = buffer.slice(512);
                    const prob = await frameScore(frame); position += 512;
                    history.push({ end: position, prob });
                    while (history.length && position - history[0].end > 32000) history.shift();
                }
                self.postMessage({ type: 'result', id: message.id, epoch,
                    result: { available: true, history, end: position } });
            }
        } catch (error) {
            self.postMessage({ type: 'error', id: message.id, epoch: message.epoch, message: String(error.message || error) });
        }
    });
};
