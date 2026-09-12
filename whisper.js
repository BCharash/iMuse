import { pipeline } from
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

console.log("Loading Whisper...");

const transcriber = await pipeline(
    "automatic-speech-recognition",
    "onnx-community/whisper-tiny.en"
);

console.log("Whisper loaded!");

window.transcribeRecording = async function () {
    if (!window.lastRecording) {
        console.log("No recording available.");
        return;
    }

    console.log("Transcribing...");

    const arrayBuffer = await window.lastRecording.arrayBuffer();

    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const sourceData = audioBuffer.getChannelData(0);

    console.log("Audio duration:", audioBuffer.duration, "seconds");
    console.log("Original sample rate:", audioBuffer.sampleRate);

    const targetSampleRate = 16000;
    const targetLength = Math.round(
        sourceData.length * targetSampleRate / audioBuffer.sampleRate
    );

    const offlineContext = new OfflineAudioContext(
        1,
        targetLength,
        targetSampleRate
    );

    const buffer = offlineContext.createBuffer(
        1,
        sourceData.length,
        audioBuffer.sampleRate
    );

buffer.copyToChannel(sourceData, 0);

const source = offlineContext.createBufferSource();
source.buffer = buffer;
source.connect(offlineContext.destination);
source.start();

const resampledBuffer = await offlineContext.startRendering();
const audioData = resampledBuffer.getChannelData(0);

console.log("Resampled sample rate:", targetSampleRate);
console.log("Resampled samples:", audioData.length);

const result = await transcriber(audioData);

    console.log("TRANSCRIPTION:", result);

    document.getElementById("transcript").textContent = result.text;
};