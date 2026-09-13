
const transcribeButton =
    document.getElementById("transcribeButton");

const modelSelect =
    document.getElementById("modelSelect");

const recordButton =
    document.getElementById("recordButton");

const transcript =
    document.getElementById("transcript");

transcribeButton.addEventListener(
    "click",
    () => {

        window.transcribeRecording();
    }
);

modelSelect.addEventListener(
    "change",
    () => {

        recordButton.disabled =
            true;

        transcribeButton.disabled =
            true;

        window.lastRecording =
            null;

        transcript.textContent =
            "";

        window.loadWhisperModel(
            modelSelect.value
        );
    }
);

