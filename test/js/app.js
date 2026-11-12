const transcribeButton =
    document.getElementById("transcribeButton");

transcribeButton.addEventListener(
    "click",
    () => {

        window.transcribeRecording();
    }
);

