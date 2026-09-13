
import { pipeline } from
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

const modelSelect =
    document.getElementById("modelSelect");

const languageSelect =
    document.getElementById("languageSelect");

const recordButton =
    document.getElementById("recordButton");

const transcribeButton =
    document.getElementById("transcribeButton");

const status =
    document.getElementById("status");

let transcriber = null;
let loadedModel = null;
let loadingModel = false;

const models = {
    tiny: "onnx-community/whisper-tiny",
    base: "onnx-community/whisper-base",
    small: "onnx-community/whisper-small"
};

async function loadModel(modelName) {

    const modelId =
        models[modelName];

    if (!modelId) {

        throw new Error(
            `Unknown Whisper model: ${modelName}`
        );
    }

    if (
        loadedModel === modelName &&
        transcriber
    ) {

        recordButton.disabled =
            false;

        status.textContent =
            `Whisper ${modelName} ready.`;

        return;
    }

    loadingModel = true;

    recordButton.disabled =
        true;

    transcribeButton.disabled =
        true;

    console.log(
        "Loading Whisper model:",
        modelId
    );

    status.textContent =
        `Loading Whisper ${modelName}...`;

    try {

        const newTranscriber =
            await pipeline(
                "automatic-speech-recognition",
                modelId
            );

        transcriber =
            newTranscriber;

        loadedModel =
            modelName;

        window.loadedWhisperModel =
            modelName;

        console.log(
            "Whisper loaded:",
            modelId
        );

        recordButton.disabled =
            false;

        status.textContent =
            `Whisper ${modelName} ready.`;

    } catch (error) {

        console.error(
            "Could not load Whisper model:",
            error
        );

        transcriber =
            null;

        loadedModel =
            null;

        recordButton.disabled =
            true;

        status.textContent =
            `Could not load Whisper ${modelName}.`;

    } finally {

        loadingModel =
            false;
    }
}

window.loadWhisperModel =
    loadModel;

await loadModel(
    modelSelect.value
);

window.transcribeRecording =
    async function () {

        if (loadingModel) {

            console.log(
                "Whisper is still loading."
            );

            return;
        }

        if (!window.lastRecording) {

            console.log(
                "No recording available."
            );

            return;
        }

        if (!transcriber) {

            console.log(
                "Whisper is not loaded."
            );

            status.textContent =
                "Whisper is not ready.";

            return;
        }

        const language =
            languageSelect.value;

        console.log(
            "Transcribing with:",
            loadedModel
        );

        console.log(
            "Language:",
            language
        );

        status.textContent =
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

        const result =
            await transcriber(
                audioData,
                {
                    language: language,
                    task: "transcribe"
                }
            );

        console.log(
            "TRANSCRIPTION:",
            result
        );

        document.getElementById(
            "transcript"
        ).textContent =
            result.text;

        status.textContent =
            "Transcription complete.";
    };

