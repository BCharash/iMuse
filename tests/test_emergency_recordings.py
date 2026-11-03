"""Regression coverage for emergency audio preservation and saved-player isolation."""
import json
import re
import unittest
from recording_test_support import SOURCE, MOCKS, FUNCTIONS, evaluate


TESTS = r"""
globalThis.testResult = 'pending';
(async () => {
    seed('first');
    await stopHandler();
    const first = emergencyRecordings.get('first');
    assert(first.blob.content === 'header-firsttail-first', 'finalization preserves committed prefix and unsaved tail');
    assert(window.lastRecording === first.blob, 'emergency initially loaded');
    const rows = () => recoveryPanel.children.filter(element => element.children.some(child => child.className === 'saved-audio-open'));
    await renderRecoverableSessions();
    assert(location.children.includes(recoveryPanel), 'unified recordings panel visible');
    assert(rows().length === 1, 'one row for saved prefix plus emergency');

    // Execute the actual new-recording path through its unavailable-storage exit.
    // It clears the player before attempting database/microphone access.
    db = null;
    await startRecording();
    assert(window.lastRecording === null && audioPlayer.hidden, 'new recording clears old player');
    assert(emergencyRecordings.get('first') === first, 'new recording retains emergency data');
    assert(revoked.length > 0, 'player URL released without releasing emergency blob');

    // Another failure must not overwrite the earlier emergency.
    seed('second');
    await stopHandler();
    assert(emergencyRecordings.size === 2, 'two emergencies retained');
    await renderRecoverableSessions();
    assert(rows().length === 2, 'both recordings available without duplicate emergency rows');
    current.metadata.startedAt = 'changed';
    assert(emergencyRecordings.get('second').metadata.startedAt !== 'changed', 'metadata snapshot retained');

    // Interact with the actual rendered controls, then switch to other playback.
    const row = rows()[0];
    const currentRecording = window.lastRecording, currentSession = displayedSessionId;
    row.children[1].click();
    assert(savedPlayback?.id === 'first' && savedPlayback.dialog.open, 'compact control opens saved player');
    assert(window.lastRecording === currentRecording && displayedSessionId === currentSession, 'saved player leaves current recording intact');
    assert(row.children[0].textContent.includes('KB') && !row.children[0].textContent.includes('saved chunks'), 'row uses readable size without chunks');
    assert(row.children[3].textContent === 'Delete', 'short delete label');
    assert(row.children[4].children[0].textContent === '↓' && row.children[4].children[1].textContent === 'Stop diagnostics', 'compact diagnostics action has visible explanation');
    const previousPlayer = savedPlayback;
    showSavedPlayback(emergencyRecordings.get('second').blob, 'second');
    assert(savedPlayback.id === 'second' && !document.body.children.includes(previousPlayer.dialog), 'opening another saved player releases previous dialog');
    previousPlayer.dialog.events.close();
    assert(savedPlayback.id === 'second', 'late close event does not close newer saved player');
    savedPlayback.dialog.close();
    assert(savedPlayback === null && window.lastRecording === currentRecording, 'closing saved player preserves current recording');
    showPlayback(new Blob(['ordinary-recording']), 'ordinary');
    clearPlayback();
    assert(emergencyRecordings.size === 2, 'playback switching retains both emergencies');
    const beforeReads = reads, beforeWrites = writes;
    await row.children[2].click();
    assert(downloads[0].blob.content === 'header-firsttail-first', 'row download contains unsaved tail');
    assert(!row.children[2].disabled, 'download control enabled again');
    await exportSavedSession('second', {disabled: false});
    assert(downloads[1].blob.content === 'header-secondtail-second', 'saved-list export prefers complete emergency');
    assert(reads === beforeReads, 'emergency export does not depend on readable database');
    assert(emergencyRecordings.size === 2, 'download requests never release emergency copies');

    for (const action of [playSavedSession, recoverSession]) {
        const button = {disabled: false};
        await action('first', button);
        assert(window.lastRecording === first.blob, 'saved action prefers emergency instead of partial disk audio');
        assert(!button.disabled, 'saved action remains repeatable');
    }
    assert(reads === beforeReads && writes === beforeWrites, 'recovery neither reads partial audio nor marks it completed');
    downloadFails = true;
    const failedButton = {disabled: false};
    await exportSavedSession('first', failedButton);
    assert(!failedButton.disabled && emergencyRecordings.get('first') === first, 'failed download retains emergency and allows retry');
    downloadFails = false;
    await exportSavedSession('first', failedButton);
    assert(downloads[2].blob === first.blob, 'retry exports original artifact');

    // If even committed chunks cannot be read, retain the available tail.
    // Retention does not claim that this fragment alone is playable.
    storageReadable = false;
    seed('unreadable');
    await stopHandler();
    assert(emergencyRecordings.get('unreadable').blob.content === 'tail-unreadable', 'read failure retains available tail');
    await renderRecoverableSessions();
    assert(rows().length === 3 && !recoveryPanel.hidden, 'all emergency copies remain listed when storage cannot be read');
    const empty = {id: 'empty', metadata: {}};
    retainEmergencyRecording(empty, new Blob([]));
    assert(emergencyRecordings.size === 3, 'empty artifact not listed');
    for (const failure of ['permission', 'cancel', 'constructor']) {
        startupFailure = failure;
        await startRecording();
        assert(leaseAcquisitions === leaseReleases, 'startup failure/cancellation releases ownership: ' + failure);
        assert(emergencyRecordings.get('first') === first, 'startup failure retains earlier emergency');
    }
    globalThis.testResult = 'PASS';
})().catch(error => { globalThis.testResult = String(error.stack || error); });
"""

class EmergencyRecordingsTests(unittest.TestCase):
    def test_emergency_preservation(self):
        syntax_source = re.sub(r"^import .*?;\n", "", SOURCE, flags=re.M)
        evaluate("new Function(" + json.dumps(syntax_source) + ");\n" + MOCKS + FUNCTIONS + TESTS)


if __name__ == "__main__":
    unittest.main()
