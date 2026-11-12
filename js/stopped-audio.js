// Wait for actual capture-side shutdown; never impose an arbitrary playback delay.
// A stuck cleanup suppresses only the announcement, not audio preservation.
export async function waitForStoppedAudio(operations, {
    timeoutMs = 2000, setTimer = setTimeout, clearTimer = clearTimeout
} = {}) {
    let timer;
    try {
        return await Promise.race([
            Promise.all(operations.map(operation => Promise.resolve(operation).then(value => value !== false, () => false)))
                .then(results => results.every(Boolean)),
            new Promise(resolve => { timer = setTimer(() => resolve(false), timeoutMs); })
        ]);
    } finally { clearTimer(timer); }
}

// Capture has stopped; retain the microphone only through the announcement.
// Cancellation also prevents a queued prompt from playing after release.
export async function announceStoppedAndRelease({operations, announce, release, enabled = true,
    timeoutMs = 8000, setTimer = setTimeout, clearTimer = clearTimeout}) {
    const controller = new AbortController();
    let timer;
    try {
        await Promise.race([
            (async () => {
                const ready = await waitForStoppedAudio(operations);
                if (ready && enabled && !controller.signal.aborted) await announce(controller.signal);
            })(),
            new Promise(resolve => { timer = setTimer(() => { controller.abort(); resolve(); }, timeoutMs); })
        ]);
    } catch (error) {
        console.warn("Stop announcement unavailable:", error);
    } finally {
        clearTimer(timer);
        controller.abort();
        release();
    }
}
