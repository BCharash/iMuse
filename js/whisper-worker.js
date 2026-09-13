import { pipeline } from
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

let transcriber = null;
let loadedModel = null;

const models = {
    tiny: "onnx-community/whisper-tiny",
    base: "onnx-community/whisper-base",
    small: "onnx-community/whisper-small"
};

self.onmessage = async event => {

    const message =
        event.data;

    if (message.type === "load") {

        const modelName =
            message.model;

        const modelId =
            models[modelName];

        if (!modelId) {

            self.postMessage({
                type: "error",
                message:
                    `Unknown Whisper model: ${modelName}`
            });

            return;
        }

        try {

            self.postMessage({
                type: "status",
                message:
                    `Loading Whisper ${modelName}...`
            });

            transcriber =
                await pipeline(
                    "automatic-speech-recognition",
                    modelId
                );

            loadedModel =
                modelName;

            self.postMessage({
                type: "ready",
                model: modelName
            });

        } catch (error) {

            console.error(
                "Worker could not load Whisper:",
                error
            );

            self.postMessage({
                type: "error",
                message:
                    `Could not load Whisper ${modelName}.`
            });
        }
    }
};