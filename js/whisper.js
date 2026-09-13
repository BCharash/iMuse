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

                window.loadedWhisperModel =
                    message.model;

                recordButton.disabled =
                    false;

                status.textContent =
                    `Whisper ${message.model} ready.`;
            }

            if (message.type === "transcription") {

                transcript.textContent =
                    message.text;

                transcribeButton.disabled =
                    false;

                status.innerHTML =
                    "Transcription complete.";
            }

            if (message.type === "error") {

                loadingModel =
                    false;

                recordButton.disabled =
                    true;

                transcribeButton.disabled =
                    false;

                status.textContent =
                    message.message;
            }
        };

    worker.onerror =
        () => {

            loadingModel =
                false;

            recordButton.disabled =
                true;

            transcribeButton.disabled =
                false;

            status.textContent =
                "Whisper worker error.";
        };
}

async function loadModel(modelName) {

    loadingModel =
        true;

    recordButton.disabled =
        true;

    transcribeButton.disabled =
        true;

    if (!worker) {

        createWorker();
    }

    worker.postMessage({
        type: "load",
        model: modelName
    });
}

window.loadWhisperModel =
    loadModel;

await loadModel(
    modelSelect.value
);

window.transcribeRecording =
    async function () {

        if (loadingModel) {

            return;
        }

        if (!window.lastRecording) {

            status.textContent =
                "No recording available.";

            return;
        }

        if (!worker) {

            status.textContent =
                "Whisper is not ready.";

            return;
        }

        const language =
            languageSelect.value;

        status.textContent =
            "Preparing audio...";

        try {

            const preparedAudio =
                await prepareAudioForWhisper(
                    window.lastRecording
                );

            status.innerHTML =
                '<span class="transcribing-status">' +
                '<span class="transcribing-spinner"></span>' +
                'Transcribing…' +
                '</span>';

            transcribeButton.disabled =
                true;

            worker.postMessage({
                type: "transcribe",
                audioData:
                    preparedAudio.audioData,
                language:
                    language
            });

        } catch (error) {

            status.textContent =
                "Could not prepare audio.";

            transcribeButton.disabled =
                false;
        }
    };