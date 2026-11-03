// Structural checks only: matching bytes cannot establish microphone continuity
// or prove an encoded media container will decode correctly.
export function inspectRecordingChunks(metadata, chunks, receivedCount) {
    const issues = new Set();
    const bySequence = new Map();
    for (const chunk of chunks) {
        if (!Number.isSafeInteger(chunk.sequence) || chunk.sequence < 0) {
            issues.add("Invalid chunk sequence");
            continue;
        }
        if (bySequence.has(chunk.sequence)) issues.add("Duplicate chunk sequence");
        else bySequence.set(chunk.sequence, chunk);
    }
    const ordered = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
    let expected = 0, bytes = 0;
    const parts = [];
    for (const chunk of ordered) {
        if (chunk.sequence !== expected) issues.add("Missing audio chunks");
        expected = chunk.sequence + 1;
        if (!chunk.blob || !Number.isSafeInteger(chunk.blob.size) || chunk.blob.size <= 0) {
            issues.add("Missing or empty chunk data");
            continue;
        }
        parts.push(chunk.blob);
        bytes += chunk.blob.size;
        if (chunk.bytes !== chunk.blob.size) issues.add("Chunk byte count mismatch");
    }
    if (!parts.length) issues.add("No saved audio");
    if (!Number.isSafeInteger(metadata.chunkCount) || metadata.chunkCount !== ordered.length || metadata.chunkCount !== expected) {
        issues.add("Saved chunk count mismatch");
    }
    if (!Number.isSafeInteger(metadata.bytesStored) || metadata.bytesStored !== bytes) issues.add("Saved byte total mismatch");
    const received = receivedCount ?? metadata.receivedChunkCount;
    if (Number.isSafeInteger(received) && received !== ordered.length) issues.add("Received audio is missing from storage");
    return { parts, report: { ok: issues.size === 0, issues: [...issues],
        savedChunks: ordered.length, availableBytes: bytes, checkedAt: new Date().toISOString() } };
}

export function recordingCompletion(current, report) {
    const reasons = new Set(current.metadata.interruptionReasons || []);
    if (!["stop-button", "voice-stop-confirmed-yes"].includes(current.stopIntent)) reasons.add("Recording ended without a normal user stop");
    if (current.recorderError) reasons.add("Recorder reported an error");
    if (current.finalizationDelayed) reasons.add("Finalization was delayed");
    if (!report.ok) reasons.add("Saved audio failed structural checks");
    return { state: reasons.size ? "interrupted" : "completed", interruptionReasons: [...reasons] };
}
