import { prepareAudioForWhisper } from
    "./audio.js";

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

const transcript =
    document.getElementById("transcript");

let worker = null;
let loadingModel = false;
let loadedWhisperModel = null;
let modelLoadPromise = null;

function createWorker() {

    worker =
        new Worker(
            "./js/whisper-worker.js",
            {
                type: "module"
            }
        );

    worker.onmessage =
        event => {

            const message =
                event.data;

            if (message.type === "status") {

                status.textContent =
                    message.message;
            }

            if (message.type === "ready") {

                loadingModel =
                    false;

                loadedWhisperModel =
                    message.model;

                window.loadedWhisperModel =
                    message.model;

                if (modelLoadPromise) {

                    modelLoadPromise.resolve();
                    modelLoadPromise = null;
                }
            }

            if (message.type === "transcription") {

                transcript.textContent =
                    message.text;

                transcribeButton.disabled =
                    false;

                recordButton.disabled =
                    false;

                status.textContent =
                    "Transcription complete.";
            }

            if (message.type === "error") {

                loadingModel =
                    false;

                recordButton.disabled =
                    false;

                transcribeButton.disabled =
                    false;

                if (modelLoadPromise) {

                    modelLoadPromise.reject(
                        new Error(message.message)
                    );

                    modelLoadPromise =
                        null;
                }

                status.textContent =
                    message.message;
            }
        };

    worker.onerror =
        () => {

            loadingModel =
                false;

            recordButton.disabled =
                false;

            transcribeButton.disabled =
                false;

            if (modelLoadPromise) {

                modelLoadPromise.reject(
                    new Error("Whisper worker error.")
                );

                modelLoadPromise =
                    null;
            }

            status.textContent =
                "Whisper worker error.";
        };
}

function loadModel(modelName) {

    if (
        loadedWhisperModel === modelName
    ) {

        return Promise.resolve();
    }

    if (loadingModel) {

        return modelLoadPromise.promise;
    }

    if (!worker) {

        createWorker();
    }

    loadingModel =
        true;

    status.textContent =
        `Loading Whisper ${modelName}...`;

    modelLoadPromise = {};

    modelLoadPromise.promise =
        new Promise(
            (resolve, reject) => {

                modelLoadPromise.resolve =
                    resolve;

                modelLoadPromise.reject =
                    reject;
            }
        );

    worker.postMessage({
        type: "load",
        model: modelName
    });

    return modelLoadPromise.promise;
}

window.transcribeRecording =
    async function () {

        if (!window.lastRecording) {

            status.textContent =
                "No recording available.";

            return;
        }

        const model =
            modelSelect.value;

        const language =
            languageSelect.value;

        transcribeButton.disabled =
            true;

        recordButton.disabled =
            true;

        status.textContent =
            "Preparing audio...";

        try {

            const preparedAudio =
                await prepareAudioForWhisper(
                    window.lastRecording
                );

            await loadModel(model);

            status.innerHTML =
                '<span class="transcribing-status">' +
                '<span class="transcribing-spinner"></span>' +
                'Transcribing…' +
                '</span>';

            worker.postMessage({
                type: "transcribe",
                audioData:
                    preparedAudio.audioData,
                language:
                    language
            });

        } catch (error) {

            recordButton.disabled =
                false;

            transcribeButton.disabled =
                false;

            status.textContent =
                error?.message ||
                "Could not transcribe recording.";
        }
    };

    