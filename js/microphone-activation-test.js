// Allocate per recording; activate only directly from a trusted button click.
// No microphone acquisition, playback, timers, or background retries.
let latestOwner = null;
export function createMicrophoneActivationTest(report = () => {}) {
    const owner = {};
    latestOwner = owner;
    const state = {phase: "untested", supported: null, error: null};
    let media = null, released = false, accepted = false, clearing = false;
    const snapshot = () => ({...state, released});
    function publish(phase, message, error = null) {
        state.phase = phase;
        state.error = error == null ? null : String(error);
        report(state.error ? `${message} ${state.error}` : message, snapshot());
    }
    function clear() {
        if (!accepted || clearing) return;
        clearing = true;
        if (latestOwner !== owner) {
            publish("cleanup-superseded", "Late cleanup skipped to protect a newer recording. Reload before another comparison.");
            return;
        }
        publish("clearing", "Clearing the microphone activation test…");
        try {
            Promise.resolve(media.setMicrophoneActive(false)).then(() => {
                publish("cleared", "Microphone activation test cleared after recording ended.");
            }).catch(error => publish("clear-failed", "Cleanup failed; reload before another comparison.", error));
        } catch (error) {
            publish("clear-failed", "Cleanup failed; reload before another comparison.", error);
        }
    }
    return {
        snapshot,
        activate() {
            if (released || latestOwner !== owner || ["requesting", "accepted"].includes(state.phase)) return;
            if (document.visibilityState !== "visible") {
                publish("skipped-hidden", "Return to iMuse before tapping the test button.");
                return;
            }
            try {
                media = navigator.mediaSession;
                state.supported = typeof media?.setMicrophoneActive === "function";
                if (!state.supported) {
                    publish("unsupported", "This browser does not support the microphone activation test.");
                    return;
                }
                // Deliberately no await, Promise.then, or timer before this call.
                // WebKit requires activation in the current user gesture handler.
                const result = media.setMicrophoneActive(true);
                publish("requesting", "Waiting for the browser's microphone activation result…");
                Promise.resolve(result).then(() => {
                    accepted = true;
                    if (released) { clear(); return; }
                    publish("accepted", "Browser accepted microphone activation. Now test background speech.");
                }).catch(error => publish("rejected", "Browser rejected microphone activation:", error));
            } catch (error) {
                publish("rejected", "Browser rejected microphone activation:", error);
            }
        },
        release() {
            if (released) return;
            released = true;
            // If still pending, its resolution clears it after acceptance.
            clear();
        }
    };
}
