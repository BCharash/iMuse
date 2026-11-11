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
