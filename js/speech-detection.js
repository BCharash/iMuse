import { speechDecision } from './speech-detection-core.js';

// One warmed worker, bounded in-flight audio, no microphone or recording ownership.
export function createSpeechDetection({
    createWorker = () => new Worker(new URL('./speech-detection-worker.js', import.meta.url), { type: 'module' }),
    onStatus = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now()
} = {}) {
    let worker = null, ready = false, preparing = null, epoch = 0, stream = null, serial = 0, loadingTimer, lastFeedAt = null;
    const pending = new Map();
    const unavailable = reason => ({ available: false, reason });
    function reset() {
        epoch++; stream = null; lastFeedAt = null;
        for (const item of pending.values()) { clearTimer(item.timer); item.resolve(unavailable('reset')); }
        pending.clear();
    }
    function fail(message) {
        const reject = preparing?.reject;
        reset(); clearTimer(loadingTimer); worker?.terminate(); worker = null; ready = false; preparing = null;
        onStatus('Unavailable — normal wake recognition continues. ' + message);
        reject?.(Error(message));
    }
    function prepare() {
        if (ready) return Promise.resolve();
        if (preparing) return preparing.promise;
        let resolve, reject;
        const promise = new Promise((a, b) => { resolve = a; reject = b; });
        preparing = { promise, resolve, reject };
        onStatus('Preparing speech detection…');
        try {
            const instance = createWorker(); worker = instance;
            instance.onerror = event => { if (worker === instance) fail(event.message || 'Speech worker failed'); };
            instance.onmessage = ({ data: message }) => {
                if (worker !== instance) return;
                if (message.type === 'ready') {
                    clearTimer(loadingTimer); ready = true;
                    const completion = preparing; preparing = null;
                    onStatus('Ready — model stays loaded between pauses.'); completion?.resolve();
                } else if (message.type === 'error') fail(message.message);
                else if (message.type === 'result') {
                    const item = pending.get(message.id);
                    if (!item || message.epoch !== item.epoch) return;
                    pending.delete(message.id); clearTimer(item.timer);
                    item.resolve(now() - item.sentAt > 250 ? unavailable('stale') : message.result);
                }
            };
            loadingTimer = setTimer(() => { if (worker === instance) fail('Preparation timed out'); }, 45000);
            instance.postMessage({ type: 'prepare' });
        } catch (error) { fail(error.message); }
        return promise;
    }
    function feed(pcm, sampleRate, key) {
        const receivedAt = now();
        if (stream !== key || (lastFeedAt !== null && receivedAt - lastFeedAt > 250)) {
            reset(); stream = key;
        }
        lastFeedAt = receivedAt;
        if (!ready) return { epoch, promise: Promise.resolve(unavailable(worker ? 'loading' : 'unavailable')) };
        if (pending.size >= 4) {
            // Terminate queued worker work too; clearing acknowledgements alone
            // would allow repeated resets to grow an invisible worker backlog.
            fail('Speech analysis queue limit reached');
            return { epoch, promise: Promise.resolve(unavailable('queue-limit')) };
        }
        const id = ++serial, packetEpoch = epoch, samples = pcm.slice();
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const timer = setTimer(() => { if (pending.has(id)) fail('Speech processing timed out'); }, 250);
        pending.set(id, { resolve, timer, epoch: packetEpoch, sentAt: now() });
        try { worker.postMessage({ type: 'audio', id, epoch: packetEpoch, pcm: samples, sampleRate }, [samples.buffer]); }
        catch (error) { fail(error.message); }
        return { epoch: packetEpoch, promise };
    }
    async function decide(ticket, settings) {
        if (!ticket) return { valid: true, ...speechDecision(unavailable('awaiting-audio'), settings) };
        const result = await ticket.promise;
        return { valid: ticket.epoch === epoch, ...speechDecision(result, settings) };
    }
    return { prepare, reset, feed, decide };
}
