// One reversible session-intent request per recording. No microphone or playback.
// Automatic observes the browser configuration without assigning a type.
export function beginRecordingAudioSession(mode, report = () => {}) {
    const requested = mode === "play-and-record" ? mode : "auto";
    let session = null, previous = null, attempted = false, released = false;
    let accepted = false, error = null, restoration = "not-needed";
    const readType = () => { try { return session?.type ?? null; } catch (_) { return null; } };
    const snapshot = () => ({
        requested, supported: !!session, previous, reportedType: readType(), accepted,
        error, restoration, released
    });
    try {
        session = navigator.audioSession || null;
        if (!session) {
            report("Audio session: this browser does not support the experiment. Recording uses its existing behavior.");
        } else {
            previous = session.type;
            if (requested === "auto") {
                report(`Audio session: Automatic; browser configuration left unchanged (${previous}).`);
            } else {
                attempted = true;
                session.type = requested;
                accepted = session.type === requested;
                report(accepted
                    ? "Audio session: browser accepted Play and record. Background capture still needs testing."
                    : `Audio session: Play and record was not accepted (reported ${readType()}). Recording will continue.`);
            }
        }
    } catch (failure) {
        error = String(failure);
        report(`Audio session: could not apply the choice. Recording will continue. ${error}`);
    }
    return {
        snapshot,
        release() {
            if (released) return;
            released = true;
            if (!attempted || previous == null) return;
            try {
                if (session.type === previous && previous !== requested) {
                    report("Audio session: recording ended; no session override remained to restore.");
                    return;
                }
                // Avoid overwriting a later change by another audio owner.
                if (session.type !== requested) {
                    restoration = "skipped-changed-type";
                    report("Audio session: recording ended; a later browser configuration was left unchanged.");
                    return;
                }
                session.type = previous;
                restoration = session.type === previous ? "restored" : "not-accepted";
                report(restoration === "restored"
                    ? `Audio session: recording ended; restored previous configuration (${previous}).`
                    : "Audio session: browser did not restore its previous configuration. Reload before the next comparison.");
            } catch (failure) {
                restoration = "failed";
                error = String(failure);
                report(`Audio session: restoration failed. Reload before the next comparison. ${error}`);
            }
        }
    };
}
