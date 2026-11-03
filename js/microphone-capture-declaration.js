// Optional Media Session experiment; no audio playback or background retries.
// Call once after capture starts, retain through pause, release with the stream.
let latestDeclaration = null;
export function declareRecordingMicrophone(enabled, report = () => {}) {
    const owner = {};
    latestDeclaration = owner;
    const state = {enabled: enabled === true, supported: null, phase: "disabled", error: null};
    let media = null, requested = false, settled = false, accepted = false;
    let released = false, clearing = false;
    const snapshot = () => ({...state, released});
    const publish = (phase, message, error = null) => {
        state.phase = phase; state.error = error;
        report(message, snapshot());
    };
    function clear() {
        if (!requested || !settled || !accepted || clearing) return;
        if (latestDeclaration !== owner) {
            clearing = true;
            publish("cleanup-superseded", "Microphone declaration: late cleanup skipped to protect a newer recording. Reload before another comparison.");
            return;
        }
        clearing = true;
        publish("clearing", "Microphone declaration: clearing after recording ended…");
        try {
            Promise.resolve(media.setMicrophoneActive(false)).then(() => {
                publish("cleared", "Microphone declaration: cleared after recording ended.");
            }).catch(error => publish("clear-failed", "Microphone declaration: cleanup request failed. Reload before another comparison.", String(error)));
        } catch (error) {
            publish("clear-failed", "Microphone declaration: cleanup request failed. Reload before another comparison.", String(error));
        }
    }
    if (!state.enabled) {
        publish("disabled", "Microphone declaration: experiment off; existing behavior unchanged.");
    } else {
        try {
            media = navigator.mediaSession;
            state.supported = typeof media?.setMicrophoneActive === "function";
            if (!state.supported) {
                publish("unsupported", "Microphone declaration: not supported by this browser. Recording continues normally.");
            } else if (document.visibilityState !== "visible") {
                publish("skipped-hidden", "Microphone declaration: capture started while hidden; request skipped. Start a fresh test while visible.");
            } else {
                publish("requesting", "Microphone declaration: asking the browser to mark capture active…");
                requested = true;
                Promise.resolve(media.setMicrophoneActive(true)).then(() => {
                    settled = true; accepted = true;
                    if (released) { clear(); return; }
                    publish("accepted", "Microphone declaration: browser accepted the request. Check actual background audio.");
                }).catch(error => {
                    settled = true;
                    publish("rejected", "Microphone declaration: browser rejected the request. Recording continues without it.", String(error));
                });
            }
        } catch (error) {
            settled = true;
            publish("rejected", "Microphone declaration: request unavailable or failed. Recording continues without it.", String(error));
        }
    }
    return {
        snapshot,
        release() {
            if (released) return;
            released = true;
            // A late acceptance after Stop must also be cleared; never reactivate.
            clear();
        }
    };
}
