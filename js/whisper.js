import { pipeline } from
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

const modelSelect =
    document.getElementById("modelSelect");

let transcriber = null;
let loadedModel = null;

const models = {
    tiny: "onnx-community/whisper-tiny",
    base: "onnx-community/whisper-base",
    small: "onnx-community/whisper-small",
   
};

async function loadModel(modelName) {

    const modelId = models[modelName];

    if (!modelId) {
        throw new Error(
            `Unknown Whisper model: ${modelName}`
        );
    }

    if (
        loadedModel === modelName &&
        transcriber
    ) {
        return;
    }

    console.log(
        "Loading Whisper model:",
        modelId
    );

    document.getElementById("status").textContent =
        `Loading Whisper ${modelName}...`;

    transcriber = await pipeline(
        "automatic-speech-recognition",
        modelId
    );

    loadedModel = modelName;

    console.log(
        "Whisper loaded:",
        modelId
    );

    document.getElementById("status").textContent =
        `Whisper ${modelName} ready.`;
}

await loadModel(modelSelect.value);

modelSelect.addEventListener(
    "change",
    async () => {

        try {

            await loadModel(
                modelSelect.value
            );

        } catch (error) {

            console.error(
                "Could not load Whisper model:",
                error
            );

            document.getElementById("status").textContent =
                "Could not load the selected Whisper model.";
        }
    }
);

window.transcribeRecording = async function () {

    if (!window.lastRecording) {

        console.log(
            "No recording available."
        );

        return;
    }

    if (!transcriber) {

        console.log(
            "Whisper is not loaded yet."
        );

        return;
    }

    console.log("Transcribing...");

    document.getElementById("status").textContent =
        "Transcribing...";

    const arrayBuffer =
        await window.lastRecording.arrayBuffer();

    const audioContext =
        new AudioContext();

    const audioBuffer =
        await audioContext.decodeAudioData(
            arrayBuffer
        );

    const sourceData =
        audioBuffer.getChannelData(0);

    console.log(
        "Audio duration:",
        audioBuffer.duration,
        "seconds"
    );

    console.log(
        "Original sample rate:",
        audioBuffer.sampleRate
    );

    const targetSampleRate = 16000;

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

    source.buffer = buffer;

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

    const result =
        await transcriber(audioData);

    console.log(
        "TRANSCRIPTION:",
        result
    );

    document.getElementById("transcript").textContent =
        result.text;

    document.getElementById("status").textContent =
        "Transcription complete.";
};