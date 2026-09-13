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
                "Worker Whisper error:",
                error
            );

            self.postMessage({
                type: "error",
                message:
                    error?.message ||
                    String(error)
            });
        }

        return;
    }

    if (message.type === "transcribe") {

        if (!transcriber) {

            self.postMessage({
                type: "error",
                message:
                    "Whisper is not loaded."
            });

            return;
        }

        try {

            self.postMessage({
                type: "status",
                message:
                    "Transcribing..."
            });

            const result =
                await transcriber(
                    message.audioData,
                    {
                        language: message.language,
                        task: "transcribe",
                        chunk_length_s: 30,
                        stride_length_s: 5
                    }
                );

            self.postMessage({
                type: "transcription",
                text: result.text
            });

        } catch (error) {

            console.error(
                "Worker transcription error:",
                error
            );

            self.postMessage({
                type: "error",
                message:
                    error?.message ||
                    String(error)
            });
        }
    }
};