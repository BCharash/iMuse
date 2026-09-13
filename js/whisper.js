const modelSelect =
    document.getElementById("modelSelect");

const recordButton =
    document.getElementById("recordButton");

const transcribeButton =
    document.getElementById("transcribeButton");

const status =
    document.getElementById("status");

let worker = null;
let loadingModel = false;

function createWorker() {

    worker =
        new Worker(
            "./whisper-worker.js",
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

                console.log(
                    "Whisper ready:",
                    message.model
                );
            }

            if (message.type === "error") {

                loadingModel =
                    false;

                recordButton.disabled =
                    true;

                status.textContent =
                    message.message;

                console.error(
                    "Whisper worker error:",
                    message.message
                );
            }
        };

    worker.onerror =
        error => {

            loadingModel =
                false;

            recordButton.disabled =
                true;

            status.textContent =
                "Whisper worker error.";

            console.error(
                "Whisper worker error:",
                error
            );
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