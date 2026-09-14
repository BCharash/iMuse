const recordButton =
    document.getElementById("recordButton");

const transcribeButton =
    document.getElementById("transcribeButton");

const audioPlayer =
    document.getElementById("audioPlayer");

const recordingControls =
    document.getElementById("recordingControls");

const recordAgainButton =
    document.getElementById("recordAgainButton");

const deleteButton =
    document.getElementById("deleteButton");

const status =
    document.getElementById("status");

let mediaRecorder;
let audioChunks = [];
let recordingUrl = null;

function playReadyChime() {

    const audioContext =
        new AudioContext();

    const now =
        audioContext.currentTime;

    const oscillator1 =
        audioContext.createOscillator();

    const oscillator2 =
        audioContext.createOscillator();

    const gain =
        audioContext.createGain();

    oscillator1.frequency.value = 659.25;
    oscillator2.frequency.value = 783.99;

    oscillator1.type = "sine";
    oscillator2.type = "sine";

    oscillator1.connect(gain);
    oscillator2.connect(gain);

    gain.connect(audioContext.destination);

    gain.gain.setValueAtTime(0, now);

    gain.gain.linearRampToValueAtTime(
        0.08,
        now + 0.02
    );

    gain.gain.exponentialRampToValueAtTime(
        0.001,
        now + 0.35
    );

    oscillator1.start(now);
    oscillator2.start(now + 0.12);

    oscillator1.stop(now + 0.35);
    oscillator2.stop(now + 0.47);
}

function startRecording() {

    console.log(
        "audio/mp4:",
        MediaRecorder.isTypeSupported("audio/mp4")
    );

    console.log(
        "audio/webm;codecs=opus:",
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    );

    console.log(
        "audio/webm:",
        MediaRecorder.isTypeSupported("audio/webm")
    );

    recordButton.disabled =
        true;

    status.textContent =
        "Preparing microphone...";

    navigator.mediaDevices.getUserMedia({
        audio: true
    })
    .then(stream => {

        mediaRecorder =
            new MediaRecorder(stream);

        audioChunks = [];

        let readySignalPlayed = false;

        mediaRecorder.addEventListener(
            "dataavailable",
            event => {

                audioChunks.push(
                    event.data
                );

                if (!readySignalPlayed) {

                    readySignalPlayed = true;

                    playReadyChime();

                    recordButton.textContent =
                        "Stop Recording";

                    recordButton.disabled =
                        false;

                    status.textContent =
                        "Ready — speak now.";
                }
            }
        );

        mediaRecorder.addEventListener(
            "stop",
            () => {

                stream
                    .getTracks()
                    .forEach(track =>
                        track.stop()
                    );

                const audioBlob =
                    new Blob(
                        audioChunks,
                        {
                            type: "audio/webm"
                        }
                    );

                window.lastRecording =
                    audioBlob;

                if (recordingUrl) {

                    URL.revokeObjectURL(
                        recordingUrl
                    );
                }

                recordingUrl =
                    URL.createObjectURL(
                        audioBlob
                    );

                audioPlayer.src =
                    recordingUrl;

                audioPlayer.load();

                audioPlayer.hidden =
                    false;

                recordingControls.hidden =
                    false;

                status.textContent =
                    "Recording complete.";

                transcribeButton.disabled =
                    false;

                recordButton.textContent =
                    "Start Recording";

                recordButton.disabled =
                    false;
            }
        );

        mediaRecorder.start(100);

    })
    .catch(error => {

        console.error(error);

        recordButton.disabled =
            false;

        status.textContent =
            "Microphone access was denied or unavailable.";
    });
}

recordButton.addEventListener(
    "click",
    () => {

        if (
            mediaRecorder &&
            mediaRecorder.state === "recording"
        ) {

            mediaRecorder.stop();

            recordButton.disabled =
                true;

        } else {

            startRecording();
        }
    }
);

recordAgainButton.addEventListener(
    "click",
    () => {

        audioPlayer.pause();

        startRecording();
    }
);

deleteButton.addEventListener(
    "click",
    () => {

        audioPlayer.pause();

        audioPlayer.removeAttribute(
            "src"
        );

        audioPlayer.load();

        audioPlayer.hidden =
            true;

        recordingControls.hidden =
            true;

        window.lastRecording =
            null;

        if (recordingUrl) {

            URL.revokeObjectURL(
                recordingUrl
            );

            recordingUrl =
                null;
        }

        transcribeButton.disabled =
            true;

        recordButton.textContent =
            "Start Recording";

        recordButton.disabled =
            false;

        status.textContent =
            "Ready to record.";
    }
);

