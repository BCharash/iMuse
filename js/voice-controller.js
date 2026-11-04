import { loadCommands, startCommands, stopCommands } from "./tensorflow/commands-adapter.js";

// Coordinates voice interactions. Session capabilities are borrowed from the recorder;
// this module never acquires/stops the capture track or writes recording storage.
export function createVoiceController({getSettings, getCurrentSession, getWakePhrase,
    getOverlap, sayResponse, setWakeStatus, setStatus}) {
    // Voice command state is independent of MediaRecorder state.
    const commandIndicator = document.getElementById("commandListening");
    const commandCountdown = document.getElementById("commandCountdown");
    const commandTimerProgress = document.getElementById("commandTimerProgress");
    const commandTimerHand = document.getElementById("commandTimerHand");
    function updateCommandTimer(remainingFraction) {
        if (!commandTimerProgress) return;
        const fraction = Math.max(0, Math.min(1, remainingFraction));
        const cx = 20, cy = 20, radius = 17;
        if (fraction >= 0.99999) {
            commandTimerProgress.setAttribute("d", `M ${cx} ${cy-radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy+radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy-radius} Z`);
            commandTimerHand.setAttribute("visibility", "hidden");
        } else if (fraction <= 0) {
            commandTimerProgress.setAttribute("d", "");
            commandTimerHand.setAttribute("visibility", "hidden");
        } else {
            // The blue sector shrinks from its clockwise edge; its boundary travels
            // counterclockwise toward 12 o'clock as the command window expires.
            const angle = -Math.PI / 2 + fraction * 2 * Math.PI;
            const x = cx + radius * Math.cos(angle);
            const y = cy + radius * Math.sin(angle);
            const largeArc = fraction > 0.5 ? 1 : 0;
            commandTimerProgress.setAttribute("d", `M ${cx} ${cy} L ${cx} ${cy-radius} A ${radius} ${radius} 0 ${largeArc} 1 ${x} ${y} Z`);
            commandTimerHand.setAttribute("x2", String(x));
            commandTimerHand.setAttribute("y2", String(y));
            commandTimerHand.setAttribute("visibility", "visible");
        }
    }

    let commandActive = false, commandGeneration = 0, commandInterval = null;
    let commandModel = null, commandStream = null;
    // Warm the command recognizer without acquiring a microphone or starting listening.
    // The adapter shares one loading promise with subsequent Go/Stop and Yes/No use.
    function preloadCommandModel() {
        if (!getSettings().audioCommands) return;
        void loadCommands().then(model => {
            commandModel = model;
        }).catch(error => {
            // A failed preload must never prevent recording or a later retry.
            console.warn("Command model preload unavailable; will retry when needed:", error);
        });
    }

    function closeCommandWindow({ restorePauseReminder = true } = {}) {
        commandActive = false;
        ++commandGeneration;
        if (commandInterval !== null) clearInterval(commandInterval);
        commandInterval = null;
        commandIndicator.hidden = true;
        const pausedSession = getCurrentSession();
        if (pausedSession) pausedSession.stopReminder();
        // Do not play a pause reminder when transitioning to Resume or Stop.
        if (restorePauseReminder && pausedSession && !pausedSession.discard &&
            pausedSession.state === "paused" &&
            !pausedSession.finalizing) {
            pausedSession.startReminder();
        }
        const shutdown = stopCommands(commandModel);
        void shutdown.catch(error => console.warn("Cannot stop command listener:", error));
        return shutdown;
    }

    // Both voice Go and the manual button must await command shutdown before capture resumes.
    async function resumeAfterCommandShutdown(current) {
        if (!current.isCurrent || current.discard || current.state !== "paused") return;
        const shutdown = closeCommandWindow({ restorePauseReminder: false });
        try {
            await shutdown;
            if (!current.isCurrent || current.discard || current.state !== "paused" ||
                current.finalizing) return;
            current.resume();
            setStatus("Resuming recording...");
        } catch (error) {
            console.error("Command listener did not shut down; recording remains paused:", error);
            if (current.isCurrent && current.state === "paused") {
                current.startReminder();
                setStatus("Could not safely resume. Recording remains paused; check voice commands.");
            }
        }
    }

    // Voice Stop is provisional until an explicit Yes is recognized.
    // The original recorder remains paused and all persisted chunks are untouched.
    async function confirmVoiceStop(current) {
        if (!current.isCurrent || current.discard || current.state !== "paused") return;
        commandActive = true;
        const generation = ++commandGeneration;
        if (commandInterval !== null) clearInterval(commandInterval);
        commandInterval = null;
        current.stopReminder();
        current.clearWake();
        commandIndicator.hidden = true;
        setWakeStatus("Preparing stop confirmation…");
        try {
            // Do not overlap listeners: wait until Go/Stop has completely released TensorFlow.
            await stopCommands(commandModel);
            if (generation !== commandGeneration || !current.isCurrent || !commandActive) return;
            // Preload/model preparation is allowed; speech recognition is NOT running during playback.
            commandModel = await loadCommands();
            if (generation !== commandGeneration || !current.isCurrent || !commandActive) return;
            const heard = await sayResponse("confirmStop");
            if (generation !== commandGeneration || !current.isCurrent || !commandActive) return;
            if (!heard) throw new Error("Stop confirmation prompt could not be played.");
            // Starting a fresh listener AFTER playback prevents its audio windows from
            // including the spoken Yes/No prompt. No artificial post-prompt delay.
            const seconds = getSettings().commandWindow;
            let expiresAt = Infinity;
            commandIndicator.firstChild.textContent = "Listening for Yes or No ";
            commandIndicator.hidden = false;
            updateCommandTimer(1);
            setWakeStatus("Say “Yes” to stop or “No” to stay paused.");
            await startCommands(commandModel, current.stream, getOverlap(), scores => {
                if (generation !== commandGeneration || !commandActive || performance.now() >= expiresAt) return;
                const settings = getSettings();
                if (scores.top === "yes" && scores.yes >= settings.yesThreshold) {
                    closeCommandWindow({ restorePauseReminder: false });
                    current.finalize("voice-stop-confirmed-yes");
                } else if (scores.top === "no" && scores.no >= settings.noThreshold) {
                    closeCommandWindow();
                    if (current.isCurrent && current.state === "paused") {
                        void sayResponse("pause");
                        current.armWake(0);
                        setWakeStatus("Stop cancelled. Recording paused.");
                    }
                }
            });
            if (generation !== commandGeneration || !commandActive) return;
            expiresAt = performance.now() + seconds * 1000;
            commandInterval = window.setInterval(() => {
                if (generation !== commandGeneration || !commandActive) return;
                const remaining = Math.max(0, (expiresAt - performance.now()) / 1000);
                updateCommandTimer(remaining / seconds);
                if (remaining === 0) {
                    closeCommandWindow();
                    if (current.isCurrent && current.state === "paused") {
                        void sayResponse("pause");
                        current.armWake(0);
                        setWakeStatus("No response received. Recording paused.");
                    }
                }
            }, 100);
        } catch (error) {
            console.warn("Stop confirmation unavailable:", error);
            if (generation !== commandGeneration) return;
            closeCommandWindow();
            if (current.isCurrent && current.state === "paused") {
                void sayResponse("pause");
                current.armWake(0);
                setWakeStatus("Stop not confirmed. Recording paused.");
            }
        }
    }

    async function handleWakeDetected(current) {
        if (!getSettings().audioCommands || commandActive || !current.isCurrent || !current.wakeDetectorEnabled) return;
        commandActive = true;
        // Silence the periodic double beep throughout the wake acknowledgement,
        // model preparation, and Go/Stop listening window.
        current.stopReminder();
        const generation = ++commandGeneration;
        current.clearWake();
        const wasRecording = current.state === "recording";
        let pauseAnnouncement;
        if (wasRecording) {
            // The pause event owns the spoken acknowledgement for every pause cause.
            // Wait for it before opening TensorFlow's command window.
            try { pauseAnnouncement = current.pauseForWake(); }
            catch (error) {
                console.warn("Wake pause failed", error);
                closeCommandWindow();
                return;
            }
        }
        setWakeStatus(`Wake word detected. Preparing voice commands…`);
        if (wasRecording) await pauseAnnouncement;
        else await sayResponse("yes");
        if (generation !== commandGeneration || !commandActive || !current.isCurrent) return;
        try {
            commandModel = await loadCommands();
            if (generation !== commandGeneration || !commandActive) return;
            commandStream = current.stream;
            const seconds = getSettings().commandWindow;
            const expiresAt = performance.now() + seconds * 1000;
            commandIndicator.firstChild.textContent = "Listening for Go or Stop ";
            commandIndicator.hidden = false;
            updateCommandTimer(1);
            await startCommands(commandModel, commandStream, getOverlap(), scores => {
                if (generation !== commandGeneration || !commandActive || performance.now() >= expiresAt) return;
                const settings = getSettings();
                const command = scores.top === "go" && scores.go >= settings.goThreshold ? "go"
                    : scores.top === "stop" && scores.stop >= settings.stopThreshold ? "stop" : null;
                if (!command) return;
                if (command === "go") {
                    void resumeAfterCommandShutdown(current);
                } else {
                    // Do NOT close the command window here: closeCommandWindow() starts
                    // an unawaited recognizer shutdown and restarts pause beeps.
                    // Confirmation owns the one awaited shutdown and keeps the
                    // recording paused throughout the transition.
                    void confirmVoiceStop(current);
                }
            });
            if (generation !== commandGeneration || !commandActive) return;
            commandInterval = setInterval(() => {
                if (generation !== commandGeneration || !commandActive) return;
                const remaining = Math.max(0, (expiresAt - performance.now()) / 1000);
                updateCommandTimer(remaining / seconds);
                if (remaining === 0) {
                    closeCommandWindow();
                    if (current.isCurrent) current.armWake(0);
                    setWakeStatus(`No command heard. Listening for “${getWakePhrase()}”.`);
                }
            }, 100);
        } catch (error) {
            console.warn("TensorFlow command recognition failed:", error);
            closeCommandWindow();
            if (current.isCurrent) current.armWake(0);
            setWakeStatus(`Voice commands unavailable. Use the recording buttons.`);
        }
    }

    return {
        get active() { return commandActive; },
        preload: preloadCommandModel,
        close: closeCommandWindow,
        resume: resumeAfterCommandShutdown,
        wake: handleWakeDetected
    };
}
