// Download naming only; does not rename stored recordings or modify audio.
export function localRecordingStamp(value = new Date()) {
    let date = new Date(value);
    if (Number.isNaN(date.getTime())) date = new Date();
    const pad = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function downloadDescription(value) {
    return value.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
        .trim().replace(/[. ]+$/g, "").slice(0, 100).replace(/[. ]+$/g, "") || "iMuse";
}

let activeDialog = null;
export function requestDownloadFilename(defaultName, extension) {
    // Only one naming choice at a time, including requests from other players.
    if (activeDialog) return Promise.resolve(null);
    return new Promise(resolve => {
        const dialog = document.createElement("dialog");
        activeDialog = dialog;
        dialog.className = "saved-audio-dialog recording-download-dialog";
        dialog.setAttribute("aria-label", "Download recording");
        const heading = document.createElement("h3");
        heading.textContent = "Download recording";
        const form = document.createElement("form");
        const label = document.createElement("label");
        label.textContent = "Description";
        const input = document.createElement("input");
        input.type = "text";
        input.value = "iMuse";
        input.maxLength = 100;
        input.autocomplete = "off";
        label.append(input);
        const prefix = defaultName.endsWith("_iMuse") ? defaultName.slice(0, -5) : defaultName;
        const preview = document.createElement("p");
        preview.className = "download-name-preview";
        const filename = () => `${prefix}${downloadDescription(input.value)}`;
        const update = () => { preview.textContent = `${filename()}.${extension}`; };
        input.addEventListener("input", update);
        update();
        const actions = document.createElement("div");
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        const download = document.createElement("button");
        download.type = "submit";
        download.textContent = "Download";
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            activeDialog = null;
            if (dialog.open && typeof dialog.close === "function") dialog.close();
            dialog.remove();
            resolve(result);
        };
        cancel.addEventListener("click", () => finish(null));
        dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
        dialog.addEventListener("close", () => finish(null));
        form.addEventListener("submit", event => { event.preventDefault(); finish(filename()); });
        actions.append(cancel, download);
        form.append(label, preview, actions);
        dialog.append(heading, form);
        document.body.appendChild(dialog);
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
        input.focus({preventScroll:true});
        input.select();
    });
}
