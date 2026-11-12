
export async function prepareAudioForWhisper(audioBlob) {

    const arrayBuffer =
        await audioBlob.arrayBuffer();

    const audioContext =
        new AudioContext();

    const audioBuffer =
        await audioContext.decodeAudioData(
            arrayBuffer
        );

    console.log(
        "Audio duration:",
        audioBuffer.duration,
        "seconds"
    );

    console.log(
        "Original sample rate:",
        audioBuffer.sampleRate
    );

    const sourceData =
        audioBuffer.getChannelData(0);

    const targetSampleRate =
        16000;

    const targetLength =
        Math.round(
            sourceData.length *
            targetSampleRate /
            audioBuffer.sampleRate
        );

    const offlineContext =
        new OfflineAudioContext(
            1,
            targetLength,
            targetSampleRate
        );

    const buffer =
        offlineContext.createBuffer(
            1,
            sourceData.length,
            audioBuffer.sampleRate
        );

    buffer.copyToChannel(
        sourceData,
        0
    );

    const source =
        offlineContext.createBufferSource();

    source.buffer =
        buffer;

    source.connect(
        offlineContext.destination
    );

    source.start();

    const resampledBuffer =
        await offlineContext.startRendering();

    const audioData =
        resampledBuffer.getChannelData(0);

    console.log(
        "Resampled sample rate:",
        targetSampleRate
    );

    console.log(
        "Resampled samples:",
        audioData.length
    );

    return {
        audioData: audioData,
        sampleRate: targetSampleRate,
        duration: audioBuffer.duration
    };
}

