"""Regression coverage for emergency audio preservation and saved-player isolation."""
import json
import re
import unittest
from recording_test_support import SOURCE, MOCKS, FUNCTIONS, LIBRARY_SOURCE, evaluate


TESTS = r"""
globalThis.testResult = 'pending';
(async () => {
    seed('first');
    await stopHandler();
    const first = emergencyRecordings.get('first');
    assert(first.blob.content === 'header-firsttail-first', 'finalization preserves committed prefix and unsaved tail');
    assert(window.lastRecording === first.blob, 'emergency initially loaded');
    const rows = () => getRecoveryPanel().children.filter(element => element.children.some(child => child.className === 'saved-audio-open'));
    await renderRecoverableSessions();
    assert(location.children.includes(getRecoveryPanel()), 'unified recordings panel visible');
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
    assert(getSavedPlayback()?.id === 'first' && getSavedPlayback().dialog.open, 'compact control opens saved player');
    assert(window.lastRecording === currentRecording && displayedSessionId === currentSession, 'saved player leaves current recording intact');
    assert(row.children[0].textContent.includes('KB') && !row.children[0].textContent.includes('saved chunks'), 'row uses readable size without chunks');
    assert(row.children[3].textContent === 'Delete', 'short delete label');
    assert(row.children[4].children[0].textContent === '↓' && row.children[4].children[1].textContent === 'Stop diagnostics', 'compact diagnostics action has visible explanation');
    const previousPlayer = getSavedPlayback();
    recordingLibrary.showPlayback(emergencyRecordings.get('second').blob, 'second');
    assert(getSavedPlayback().id === 'second' && !document.body.children.includes(previousPlayer.dialog), 'opening another saved player releases previous dialog');
    previousPlayer.dialog.events.close();
    assert(getSavedPlayback().id === 'second', 'late close event does not close newer saved player');
    getSavedPlayback().dialog.close();
    assert(getSavedPlayback() === null && window.lastRecording === currentRecording, 'closing saved player preserves current recording');
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
    assert(rows().length === 3 && !getRecoveryPanel().hidden, 'all emergency copies remain listed when storage cannot be read');
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

LIBRARY_TESTS = r"""
globalThis.testResult = 'pending';
(async () => {
    const records = new Map([
        ['saved',{id:'saved',state:'completed',bytesStored:2048}],
        ['live',{id:'live',state:'recording',bytesStored:1024}],
        ['emergency',{id:'emergency',state:'storage-error',bytesStored:100}],
        ['deleted-a',{id:'deleted-a',state:'deleted',bytesStored:3072}],
        ['deleted-b',{id:'deleted-b',state:'deleted',bytesStored:4096}]
    ]);
    const emergencies = new Map([['emergency',{blob:new Blob(['full emergency']),metadata:records.get('emergency'),unsavedBytes:14}]]);
    const calls = [], permanentlyDeleted = [];
    let confirmed = false;
    window.confirm = () => confirmed;
    const library = createRecordingLibrary({
        container:location,status,
        getAllSessions:async()=>[...records.values()],
        getEmergencyRecordings:()=>emergencies,
        isSessionWriting:id=>id==='live',
        recoverSession:async(id,button,present)=>{calls.push(['load',id]);present(new Blob([id]),id);},
        exportSavedSession:async id=>{calls.push(['export',id]);},
        moveSessionToRecentlyDeleted:async id=>{records.set(id,{...records.get(id),state:'deleted'});},
        getSession:async id=>records.get(id),
        deleteSessionData:async id=>{permanentlyDeleted.push(id);records.delete(id);},
        restoreRecentlyDeletedSession:async id=>{records.set(id,{...records.get(id),state:'completed'});},
        downloadRecordingEvents:async id=>{calls.push(['diagnostics',id]);},
        pauseCurrentPlayback:()=>{calls.push(['pause-current']);}
    });
    assert(location.children.length===0 && calls.length===0,'constructor is inert');
    await library.render();
    const rows=()=>getRecoveryPanel().children.filter(e=>e.children.some(child=>child.className==='saved-audio-open'));
    assert(rows().length===3,'one row per session including emergency override');
    const saved=rows()[0],live=rows()[1],emergency=rows()[2];
    assert(live.children[1].disabled && live.children[2].disabled && live.children[3].disabled,'active row protected');
    assert(emergency.children[3].disabled && !emergency.children[1].disabled,'emergency playable but not deletable');
    saved.children[1].click();
    assert(getSavedPlayback()?.id==='saved','callback opens player for selected saved session');
    await saved.children[2].click();
    saved.children[4].children[0].click();
    assert(calls.some(c=>c[0]==='export'&&c[1]==='saved') && calls.some(c=>c[0]==='diagnostics'&&c[1]==='saved'),'exports and diagnostics delegate by ID');
    await saved.children[3].click();
    assert(records.get('saved').state==='deleted' && getSavedPlayback()===null,'soft delete closes own dialog');
    const deleted=()=>getRecoveryPanel().children.find(e=>e.getAttribute('aria-label')==='Recently Deleted recordings');
    const deletedRows=()=>deleted().children.filter(e=>e.children.some(child=>child.textContent==='Restore'));
    const restore=deletedRows()[0].children.find(e=>e.textContent==='Restore');
    await restore.click();
    assert(records.get('saved').state==='completed','restore delegates and updates library');
    const bar=deleted().children[2],selectAll=bar.children[0].children[0],bulk=bar.children[2];
    selectAll.checked=true;selectAll.events.change();
    await bulk.click();
    assert(permanentlyDeleted.length===0,'cancelled bulk deletion preserves records');
    confirmed=true;
    await bulk.click();
    assert(permanentlyDeleted.sort().join(',')==='deleted-a,deleted-b','bulk deletion affects selected deleted sessions only');
    assert(records.has('saved') && records.has('live') && records.has('emergency') && emergencies.size===1,'other sessions and emergency source remain');
    assert(!deleted(),'empty Recently Deleted section disappears');
    globalThis.testResult='PASS';
})().catch(error=>{globalThis.testResult=String(error)+'\n'+(error.stack||'');});
"""


class EmergencyRecordingsTests(unittest.TestCase):
    def test_emergency_preservation(self):
        syntax_source = re.sub(r"^import .*?;\n", "", SOURCE, flags=re.M)
        evaluate("new Function(" + json.dumps(syntax_source) + ");\n" + MOCKS + FUNCTIONS + TESTS)

    def test_recording_library_component(self):
        evaluate(MOCKS + LIBRARY_SOURCE + LIBRARY_TESTS)


if __name__ == "__main__":
    unittest.main()
