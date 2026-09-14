const recordButton =
    document.getElementById("recordButton");

const transcribeButton =
    document.getElementById("transcribeButton");

const status =
    document.getElementById("status");

let mediaRecorder;
let audioChunks = [];

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

recordButton.addEventListener(
    "click",
    async () => {

        if (
            !mediaRecorder ||
            mediaRecorder.state === "inactive"
        ) {

            try {

                recordButton.disabled =
                    true;

                status.textContent =
                    "Preparing microphone...";

                const stream =
                    await navigator.mediaDevices.getUserMedia({
                        audio: true
                    });

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

                        status.textContent =
                            "Recording complete.";

                        window.lastRecording =
                            audioBlob;

                        transcribeButton.disabled =
                            false;

                        recordButton.textContent =
                            "Start Recording";
                    }
                );

                mediaRecorder.start(100);

            } catch (error) {

                console.error(error);

                recordButton.disabled =
                    false;

                status.textContent =
                    "Microphone access was denied or unavailable.";
            }

        } else {

            mediaRecorder.stop();

            recordButton.disabled =
                true;
        }
    }
);