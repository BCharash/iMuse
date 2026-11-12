# Hey iMuse — Heed wake-word training, safety, export, testing, and iMuse integration handoff

> Historical training/provenance record, reviewed 12 November 2026. Integration is complete and user-reported working. Production default is 0.75 with saved tuning preserved. Earlier 0.80 proposals, pending-swap instructions and final status statements below describe the pre-integration handoff, not current tasks. See [current model notes](../js/heed/README.md).

**Integration update, 12 November 2026:** Candidate 2026-11-12.1 installs the supplied medium export into production and the current lab. The user explicitly selected **0.75** as the new default/recommendation and confirmed existing saved thresholds must remain unchanged. This supersedes the earlier 0.80 proposal recorded below. Files remain byte-for-byte exports; display spelling is Hey iMuse. The model loaded and ran through the production adapter in isolated Chrome, and all 106 regression methods passed. Live acoustic/device acceptance in production remains pending.

**Session:** 12 November 2026  
**Purpose:** Preserve the decisions, inputs, outputs, tested settings, security precautions, and repeatable process for building a new speaker-independent Heed wake-word model in Google Colab.  
**Status:** Small and medium models trained and exported; browser tests promising; production iMuse replacement not yet verified.  
**Evidence basis:** Session discussion, preserved Colab notebooks, actual training/model ZIP archives, exported `wake.json` files, and current iMuse Heed source files. Distinguish observed results from recommendations and unknowns below.

## 1. Executive summary and decisions

- Intended spoken command: **“Hey iMuse”**, pronounced approximately **“HEY EYE-muse”** (not “hey ih-muse”). The brand/display spelling is **Hey iMuse**, but the text-to-speech (TTS) training spelling was deliberately phonetic.
- We listened to synthetic pronunciations and chose a **60:40 mixture**: **“Hey Eyemews”** (300 examples) and **“Hey Eyemuse”** (200 examples). The project configuration phrase was `Hey Eyemews`. The two written forms are prompts for TTS, **not separate wake words**.
- Trained **500 positive** and **324 user-supplied negative** WAV files, including **200 targeted distractors**. We intentionally did **not** make the near-homophone “Hey I use” a negative: sensitivity to valid pronunciations mattered more than aggressively excluding a near match.
- Trained two models for comparison: **small, 15 epochs**, and **medium, 35 epochs**. The medium model became the preferred candidate after live tests, but was not conclusively proven superior across independent speakers or environments.
- The initial exported model thresholds were **0.812 (small)** and **0.738 (medium)**. Later live experiments raised them to **0.85 (small)** and **0.80 (medium)**; the user reported both still caught all deliberate wake phrases in that short test. **0.80** is the proposed production *default* for medium, not the threshold originally stored in the export.
- Preferred production integration: **reuse iMuse’s existing Heed inference system** and replace `wake.onnx` and `wake.json`, then separately update displayed phrase/default threshold. Do not introduce a second microphone stream or change recording/recovery logic.
- Keep all original WAVs, training checkpoints, ONNX exports, notebook, and original Hey Doc model for rollback and future retraining.

## 2. Safety and trust: what we were willing to run in Colab

### Operating environment and risk boundary

We used **Google Colab**, not a local Python installation. Colab executes Python on a remote runtime; it does **not** make arbitrary third-party code inherently safe. Running a notebook or installing a package can execute code with access to the Colab runtime, files mounted there, credentials made available there, and any connected Drive content. The key precaution was to inspect and constrain the specific source and installation path before execution.

We worked from a **specific reviewed Heed source ZIP**, rather than blindly running unknown commands or cloning an unverified moving branch. The preserved pronunciation-test notebooks explicitly enforce a SHA-256 check of the uploaded ZIP:

```python
EXPECTED_SHA256 = "638556ec9a09e04e86f3b055e254fab80a28562004bcaa6b81ea845393671350"
actual = hashlib.sha256(ZIP_BYTES).hexdigest()
assert actual == EXPECTED_SHA256, "ZIP differs from reviewed source; STOP"
```

**Important:** This hash identifies the *particular source archive used in that notebook*. It does **not** certify that every future Heed release is safe. If a future ZIP has a different hash, **stop, inspect/review the new source, and establish a new expected hash**; do not merely change the constant to silence the error.

The notebooks also checked archive entries before extraction, rejecting absolute paths, `..` traversal components, and symbolic links:

```python
with zipfile.ZipFile(io.BytesIO(ZIP_BYTES)) as archive:
    for item in archive.infolist():
        path = Path(item.filename)
        assert not path.is_absolute() and ".." not in path.parts
        assert not ((item.external_attr >> 16) & 0o170000) == 0o120000
    archive.extractall(root)
```

They then verified the expected project root and `pyproject.toml` before installing the local reviewed source:

```python
SOURCE = Path("/content/heed_reviewed/heed-wakeword-main")
assert (SOURCE / "pyproject.toml").is_file()
subprocess.run([
    sys.executable, "-m", "pip", "install",
    "--disable-pip-version-check", str(SOURCE) + "[tts]"
], check=True)
```

The `[tts]` extra installs dependencies needed for speech synthesis. **Package installation and downloading TTS voices are still trust-sensitive actions**: review dependencies, their provenance and the exact notebook commands when repeating the exercise. The inspected notebook called `from heed.tts import download_voice; download_voice()` after installation. Avoid granting Colab broad access to Google Drive unless needed; if mounting Drive, review the notebook and limit credentials and private data exposed to that runtime. Do not run arbitrary shell scripts, remote `curl | bash` pipelines, or unexplained repository commands.

**What is verified here:** The preserved notebooks contain these integrity checks and commands. **What is not established:** a formal security audit of every Heed dependency, network download, or all cells used in the final training run. “Safe to run” was a practical, conditional assessment of the reviewed workflow, **not a guarantee of security**.

### Colab cleanup and persistence

- Work in `/content/...` is **ephemeral** and disappears when the runtime is deleted.
- Save the Colab notebook to Drive and **download backups before disconnecting**.
- The completed session saved the notebook and downloaded four ZIP archives listed below.
- The user ended the session using **Runtime → Disconnect and delete runtime**, then closed the incognito window. That was appropriate **after** verifying downloads and notebook persistence.
- Closing an incognito window does not delete files downloaded to the computer or a notebook saved in Drive. Conversely, files left only in `/content` are not preserved.

## 3. Phrase pronunciation experiment

### Intended utterance versus synthesis spelling

The user wants the actual spoken phrase **“Hey iMuse”**, with **i** pronounced like English “eye.” TTS may misread a brand spelling with internal capitalization. We therefore tested phonetic spellings rather than assuming the branded spelling would synthesize correctly.

The preserved `Hey_iMuse_Pronunciation_Test.ipynb` tested these candidate strings with Heed TTS:

```python
CANDIDATES = ["hey iMuse", "hey eye muse", "hey I muse", "hey eye mews"]
for phrase in CANDIDATES:
    clips = synthesize_phrase(phrase, 2, seed=17)
```

The preserved `Hey_iMuse_Mixed_Pronunciation_Preview.ipynb` additionally generated and played ten preview WAVs:

```python
MIX = [
    ("Hey Eyemews", 6, 101, "eyemews"),
    ("Hey Eyemuse", 4, 202, "eyemuse"),
]
```

We selected **60% `Hey Eyemews` and 40% `Hey Eyemuse`**, then used that mix for the 500 positive examples. This was a **human listening/design choice**, not an automatically optimized phonetic ratio. The two variants should be understood as pronunciation-diversity prompts for synthetic speakers. Future phrases should undergo the same *listen first, train second* process; spelling is only a proxy for audio.

## 4. Training project and dataset

### Colab paths and config

Working project root:

```text
/content/hey_imuse_heed_project/
    config.json
    positive/          # 500 WAV files
    negative/          # 324 WAV files
    models/
        small.pt
        small.json
        medium.pt
        medium.json
```

The backed-up `config.json` is exactly:

```json
{
  "name": "hey_imuse",
  "phrase": "Hey Eyemews"
}
```

**Positive examples:** 500 synthetic WAVs, with 300 generated from `Hey Eyemews` and 200 from `Hey Eyemuse`. The mix was meant to improve pronunciation coverage, not to train a single user's voice. **Negative examples:** 324 synthetic WAVs, consisting of 124 generic negatives and 200 targeted distractors. Deliberately omitted the close-sounding “Hey I use” negative because of the preference for sensitivity over specificity. Retain the actual WAV files rather than relying only on phrase lists; they are the reproducible dataset.

The medium model's training report says `n_negatives_real: 353` and `n_positives_real: 500`, whereas the user-supplied dataset had **324** negative WAVs. The report also says `n_user_negatives_eval: 324`. The additional **29** “real negatives” are **not fully explained by the surviving artifacts** and may reflect Heed's internal data handling. Do not silently treat 353 as the number of user-supplied negatives.

### Augmentation and evaluation caveat

The medium training metadata reports `n_positives_aug: 4500`, `n_negatives_aug: 3059`, and `tts_positives_used: 0`, `tts_distractor_phrases: 0`, `kokoro_positives_used: 0`. Those zero counters mean no *additional internally generated TTS positives/distractors* were reported during this training call; they **do not** mean the user-provided WAVs were human recordings. They were synthetic WAVs generated earlier.

The precise training command, random seeds for the full 824-file dataset, exact generic/targeted distractor text lists, and every augmentation hyperparameter are **not recoverable from the supplied backup metadata alone**. For strict byte-for-byte reproduction, preserve the complete original Colab training notebook/cells and the dataset ZIP. Do not invent command flags based on typical Heed defaults.

## 5. Training runs and measured results

| Parameter / result | Small | Medium |
|---|---:|---:|
| Epochs | 15 | 35 |
| Parameters | 10,513 | 27,089 |
| Reported training time | 95.2 s | 199.84 s |
| Final training loss | 0.00599867 | 0.00231173 |
| Reported validation accuracy | 0.9920582 | 0.9920582 |
| Validation TPR at target FPR | 0.9933036 | 0.9955357 |
| Reported user-voice TPR | 0.994 (497/500) | 1.000 (500/500) |
| Reported user-voice FPR | 0/324 | 0/324 |
| Original exported threshold | 0.812 | 0.738 |
| ONNX file size (approx.) | 45,160 bytes | 110,958 bytes |
| Architecture | 32 channels, 3 blocks | 64 channels, 3 blocks |

**Interpretation:** The medium model had a modestly better reported TPR and captured a few additional wake-word attempts in live tests. Its validation accuracy was essentially unchanged; the medium training history peaked near 99.40% validation accuracy around epoch 16 and ended near 99.21%. More epochs and parameters were not a compelling reason by themselves to move to an even larger model.

**Critical limitation:** `user_voice_tpr` in these reports was computed on the provided positive examples, **not on recordings of the actual user**. The name of the metric is potentially misleading in this synthetic-data workflow. The impressive training/validation figures cannot be equated with real-world sensitivity or false-activation rates. The training/validation split may also share synthetic generation characteristics, so independent live tests remain essential.

## 6. ONNX export and browser deployment

The trained checkpoints were PyTorch (`.pt`) files and could **not** simply be renamed to `.onnx`. Browser inference required a proper export. The first export attempt failed because the Python `onnx` package was absent. Installing it in Colab with:

```python
%pip install onnx
```

resolved that missing dependency. We used Heed's `heed.export.export_to_onnx(..., int8=False)` export pathway, producing **non-INT8** ONNX models and matching JSON metadata. The exact original export invocation/arguments beyond this are not fully preserved in the evidence summarized here; consult the saved notebook or Heed export API before reproducing it.

Exported archive:

```text
Hey_iMuse_Browser_Models.zip
    small/
        wake.onnx
        wake.json
    medium/
        wake.onnx
        wake.json
```

The `wake.json` files specify model phrase, suggested threshold, model size, preprocessing, gating, and trigger logic. Do not mix a JSON file from one training run with the ONNX file from another. Preserve both together.

### Model input and preprocessing contract

The actual exported medium JSON specifies:

- 16,000 Hz sample rate and 16,000-sample (1-second) audio window.
- 40 mel bands; `n_fft=512`; Hann window length 400 samples; hop 160 samples; `window_frames=100` in metadata (the JS preprocessor builds a 101-frame tensor).
- Mel frequency range 0–8,000 Hz.
- 8th-order 100 Hz Butterworth high-pass, plus 50/60 Hz mains notches.
- Peak normalization target −3 dBFS is documented in metadata; existing JS inference omits explicit peak normalization because its cepstral mean normalization (CMN) removes constant gain offsets.
- Log-mel features with per-bin CMN.
- Trigger requires **two consecutive raw probability crossings**, then **0.7 s refractory period**. EMA smoothing alpha **0.5** is for display, **not** the trigger threshold.
- Energy gate: filtered-audio RMS at least **−55 dBFS** and voice-band power fraction at least **0.15** (approximately 100–7,000 Hz).
- The existing JS ONNX interface expects mel tensor shape **`[1, 40, 101]`** and an output named **`logit`**; the output is converted to probability with sigmoid.

A future model must match the actual preprocessor and ONNX input/output contract, not merely have the same filename.

## 7. Live browser testing and interpretation

A dual-model lab ran both exported models on the same live microphone feed, with independent threshold sliders, score displays, trigger counts, and JSON event-log export. The lab was run through VS Code **Live Server** (not as an arbitrary `file://` page); its browser inference used Heed/ONNX Runtime resources, with internet needed for CDN dependencies. The lab's initial medium panel was visually blank due to a missing closing `</div>`; medium inference itself was working. This was fixed in `Hey_iMuse_Ready_To_Run_Fixed.zip`.

### Early test

One early test reported **11 small** and **10 medium** triggers. After the UI fix, a roughly **49-second** repeated-phrase test reported **26 small** and **27 medium** triggers. Pairing events within 0.6 seconds yielded **25 paired**, **1 small-only**, **2 medium-only**, for **28 distinct detections**. Because no complete independent utterance tally was recorded, do **not** call 28 the number of spoken wake phrases or derive a true-positive rate from it.

### Additional speaker and accent

The user's Portuguese girlfriend said the wake phrase in her natural Portuguese-accented pronunciation, **twice from approximately 1.5 metres from the laptop**, and both attempts registered. This is encouraging evidence of some accent/distance tolerance, but only two trials, not a statistically meaningful speaker-generalization study.

### Negative/background test and threshold tuning

During about **five minutes** with distant background conversation and **no intentional wake phrase**, both models false-triggered **twice**. It was not established whether these were paired activations at the same moments or independent events. The user then increased thresholds to **0.85 small** and **0.80 medium** and reported both still recognized all wake-word attempts during a short test. The false-activation test was **not yet repeated conclusively at the new thresholds**.

The user thought medium already seemed better in early use than the existing production **Hey Doc** detector. This is a qualitative early impression, not a controlled A/B comparison.

### Historical trigger probabilities (three earlier JSON logs)

| Log | Small score range | Medium score range |
|---|---|---|
| First | 0.8928–0.9784 | 0.9691–0.9944 |
| Second | 0.8193–0.9659 | 0.7383–0.9924 |
| Third | 0.8162–0.9729 | 0.7441–0.9908 |
| Overall | **0.8162–0.9784** | **0.7383–0.9944** |

Earlier review estimated that the revised thresholds would retain **56/60 small** and **56/64 medium** historical triggers if all recorded scores were unchanged. **These are historical trigger counts, not independently labeled true-positive rates**, and threshold changes can alter triggering sequences and refractory interactions. Do not treat this as a prospective sensitivity estimate.

### Silero caveat

Production iMuse uses **Silero voice activity detection** in part of its audio workflow. A speech detector may reject nonspeech noise, but **distant conversation is still speech** and may pass Silero. It is therefore not valid to assume Silero will automatically eliminate false wake triggers from conversations. Test the actual integrated pipeline.

### Model-selection decision

Prefer **medium only** as the initial production trial, not an automatic two-model ensemble. An **OR** ensemble could recover complementary detections but also admit more false positives and increase inference load; an **AND** ensemble would suppress false positives at the cost of sensitivity. Neither ensemble was adopted. A larger model was deferred pending real-world evidence of a problem.

## 8. Actual iMuse code examined: simplest integration path

The following existing files were supplied and examined:

```text
wake-detector.js
heed/heed-adapter.js
heed/wakeword.js        # uploaded as wakeword(1).js
heed/preprocessing.js
heed/filter-coeffs.js
heed/wake.onnx          # existing Hey Doc model
heed/wake.json          # existing Hey Doc metadata
```

`wake-detector.js` selects Heed versus Voicute. For Heed it collects **2,048** audio samples and calls `engine.consume(raw, sampleRate)`, then invokes `onTrigger()` only if the engine reports a trigger and current listening/enable guards pass. It does **not** own microphone acquisition, recorder state, or DOM.

`heed-adapter.js` already fetches `wake.json` and creates an ONNX Runtime Web session from `wake.onnx` in the same directory. It instantiates `WakeWordDetector(session, meta)` and uses the existing preprocessing/trigger implementation. Its returned phrase and loading message are currently hard-coded **“Hey Doc.”** It receives a `threshold` from the application and assigns `detector.threshold = threshold`, **overriding `wake.json`'s threshold**. Its function default is `0.667`, so changing the model JSON alone does **not** ensure the runtime uses `0.80`.

The existing Hey Doc `wake.json` is also a **medium** model (`channels=64`, `n_blocks=3`) with the same general 16 kHz, 40-mel, FFT-512 preprocessing contract. Thus **direct replacement is highly plausible**, but it was **not yet confirmed by a completed end-to-end iMuse test**.

### Minimal proposed change (not yet executed/validated)

1. Commit/backup the currently working iMuse repository and original Hey Doc `wake.onnx` + `wake.json`.
2. Copy **both** files from `medium/` inside `Hey_iMuse_Browser_Models.zip` into iMuse's existing `heed/` directory, preserving names `wake.onnx` and `wake.json`.
3. Hard-refresh/restart and check for cached old model assets, especially PWA/service-worker caching.
4. In iMuse Settings, manually set Heed threshold **0.80** for the initial trial (if supported); do not rely on the JSON alone.
5. Test “Hey iMuse” and the old “Hey Doc” phrase, including false activations, pauses, commands, and recording integrity.
6. Later change hard-coded displayed text to “Hey iMuse,” set the **model-specific default** to 0.80, and display the **default in parentheses** beside the slider label while separately showing the current adjustable value.
7. Preserve existing user setting persistence. Consider migration of old saved Hey Doc thresholds: they should not silently override the new model's intended default merely because they were saved for a different wake phrase.
8. Leave Voicute, Silero, recorder, microphone routing, background behavior, IndexedDB, and crash recovery unchanged.

The user considered using **Codex in VS Code** for the small configuration/UI update because it can trace threshold persistence and references throughout the repository. Codex can read the open repository; the only *new* assets it needs are the matching exported medium `wake.onnx` and `wake.json`.

### Crucial iMuse constraint

The Record subsystem must preserve audio fidelity, durable IndexedDB chunks, and crash recovery independently of wake-word detection. A wake-word change must never jeopardize the recording or create a second competing microphone capture. Test iPhone foreground/background and long recording behavior separately; previous iPhone issues involved auto-pause/visibility transitions and spontaneous stopping, so avoid changing those subsystems as part of this model swap. A false wake activation must not automatically become an unsafe destructive **Stop** command.

## 9. Backup inventory and which file is for what

| Archive / file | Contents and use |
|---|---|
| `Hey_iMuse_Training_Backup.zip` | **825 entries:** project `config.json`, 500 positive WAVs, 324 negative WAVs. Primary retraining dataset. |
| `Hey_iMuse_Small_Model_Backup.zip` | `small.pt`, `small.json`: original trained PyTorch checkpoint and training report. |
| `Hey_iMuse_Medium_Model_Backup.zip` | `medium.pt`, `medium.json`: original trained PyTorch checkpoint and training report. |
| `Hey_iMuse_Browser_Models.zip` | `small/wake.onnx`, `small/wake.json`, `medium/wake.onnx`, `medium/wake.json`: deployable browser models. |
| Saved Colab training notebook in Drive | Critical procedural record; preserve its actual training/export cells. Exact filename not established here. |
| `Hey_iMuse_Pronunciation_Test.ipynb` | Verified source upload, TTS installation, initial pronunciation candidate listening. |
| `Hey_iMuse_Mixed_Pronunciation_Preview.ipynb` | Additional 6+4 phonetic-spelling audio preview. |
| `Hey_iMuse_Dual_Model_Lab.zip` | Earlier dual-model browser test harness. |
| `Hey_iMuse_Ready_To_Run_Fixed.zip` | Working lab with medium-panel HTML closing-tag fix. |
| `hey-imuse-dual-lab-results*.json` | Live trigger events and scores, **without complete ground-truth utterance labels**. |
| Original iMuse Heed model files | Rollback to production Hey Doc. Keep in Git history or independent backup. |

**Backup validation:** The archives above were present and their members inspected during preparation of this handoff. The training archive has exactly 825 entries (824 WAVs + config). Do not assume the training ZIP includes a training notebook, Python environment, or Heed source code—it does not. Keep the reviewed Heed source ZIP and notebooks separately.

## 10. Recommended recipe for the next new wake phrase

This is a **procedural checklist**, not a verbatim transcript of every training cell or a guaranteed reproducible command sequence.

1. **Choose the spoken phrase.** Test several written TTS representations by *listening* to generated audio. Separate branded spelling from phonetic training spelling.
2. **Establish source trust.** Obtain a specific Heed source version/ZIP, inspect the relevant code and install dependencies, calculate and pin its SHA-256, reject unsafe ZIP paths, and use a fresh Colab runtime with minimal access to private files/Drive.
3. **Preserve a project config** (`name`, `phrase`) and a notebook recording source hash, package versions, code cells, random seeds, dataset-generation recipe, and export commands.
4. **Generate positives** with diverse synthetic voices/pronunciations; preserve exact WAVs and the counts for each spelling. For this project: 300 `Hey Eyemews`, 200 `Hey Eyemuse`.
5. **Generate negatives** including generic conversation and targeted near phrases, while deciding explicitly which very-close phrases to exclude to protect sensitivity. For this project: 124 generic + 200 targeted; omitted “Hey I use.”
6. **Listen to samples** before training; correct any synthetic pronunciations that sound unlike the desired command.
7. **Train a small baseline** and then a medium model if warranted. Record model size, epochs, runtime, losses, validation results, augmentation counts, and any automated threshold selection. Here: small 15 epochs, medium 35 epochs.
8. **Export each model to ONNX** using the reviewed Heed exporter; install `onnx` if required. Pair each `wake.onnx` with its own `wake.json` and validate input/output shapes and preprocessing.
9. **Test both on live audio**, including quiet room, distant microphone, different accents, natural conversation, TV/audio playback, silence, and sustained background noise. Record exact counts of *spoken* commands and triggered events to measure true-positive and false-positive rates; save raw event logs.
10. **Tune threshold using real negatives and positives.** Keep both selected runtime threshold and original metadata threshold documented. For this project: initial medium 0.738; provisional production default 0.80.
11. **Select one model for integration** unless independent tests justify an ensemble. Favor low computational overhead and reliability on the weakest intended device (iPhone).
12. **Deploy without disturbing recording.** Reuse existing Heed pipeline where compatible, preserve old model for rollback, test model caching, saved settings, microphone coexistence, and recording/recovery safety.
13. **Back up all artifacts** *before* deleting the Colab runtime: source archive/hash, notebook, dataset, PyTorch checkpoints/reports, ONNX+JSON exports, test logs, and decisions.

## 11. Open questions and work still needed

- **Production swap not yet tested:** whether the new medium ONNX/JSON works immediately when dropped into the current iMuse `heed/` folder.
- **Threshold persistence:** which file defines the slider default, how it is saved, and how an old Hey Doc override should be migrated. The caller of `loadWakeDetector()` was not supplied.
- **Cache:** whether iMuse PWA/service-worker caching will continue serving the old `wake.onnx` after a file replacement.
- **False activations:** repeat longer negative tests at 0.80, especially conversational speech; distinguish model triggers from command actions.
- **Independent positive set:** many speakers, accents, distances, noise conditions, and iPhone microphones; record utterance counts to quantify misses.
- **Silero interaction:** verify actual routing; speech VAD alone does not exclude conversational false positives.
- **Performance and recording safety:** benchmark medium Heed during iPhone recording, background transitions, and longer sessions; preserve IndexedDB persistence and audio integrity.
- **Reproducibility:** preserve full training notebook and exact dataset generation code; the supplied backup ZIPs alone do not capture every random seed, dependency version, and invocation flag.
- **Metric interpretation:** investigate the discrepancy between 324 supplied negative WAVs and 353 `n_negatives_real` reported by Heed.

## 12. Quick-reference settings for this specific model

```text
User-facing wake phrase:          Hey iMuse
Spoken target:                   HEY EYE-muse
Training config phrase:          Hey Eyemews
Positive TTS mix:                Hey Eyemews 60%; Hey Eyemuse 40%
Positive WAVs:                   500 (300 + 200)
Negative WAVs:                   324 (124 generic + 200 targeted)
Explicit excluded near-negative: Hey I use
Preferred candidate:             medium
Medium epochs:                  35
Medium parameters:              27,089
Medium trained threshold:        0.738
Medium proposed live default:    0.80
Small epochs:                   15
Small trained threshold:         0.812
Small later test threshold:      0.85
Inference sample rate:           16,000 Hz
FFT / window / hop:              512 / 400 / 160 samples
Mel bands:                       40
ONNX input:                      mel [1,40,101]
ONNX output:                     logit (sigmoid to probability)
Trigger:                         2 consecutive raw-prob crossings
Refractory:                      0.7 seconds
EMA display alpha:               0.5
Energy RMS gate:                 -55 dBFS
Voice-band power minimum:        0.15
Browser model filenames:         wake.onnx + wake.json
Preferred deployment:            existing iMuse Heed adapter
Training date:                   2026-11-12
```

---

**Final status statement:** The project produced two working exported wake-word models and a successful dual-model browser lab. The medium model is the leading candidate, with an experimentally raised threshold of 0.80. The most conservative next action is to replace only the existing iMuse Heed model pair, verify functionality, then make minimal phrase/default-setting UI changes. Nothing in this handoff claims that the production swap or long-duration iPhone reliability has already been validated.
