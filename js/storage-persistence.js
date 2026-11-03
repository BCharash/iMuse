// This changes browser eviction policy, not where audio is saved. Never make
// microphone acquisition or chunk writes wait for the permission decision.
export function createStoragePersistence(storage, onChange = () => {}, timeoutMs = 5000) {
    const querySupported = typeof storage?.persisted === "function";
    const requestSupported = typeof storage?.persist === "function";
    let state = { status: "checking", busy: false, requestSupported, error: null };
    let inFlight = null;
    const publish = update => {
        state = { ...state, ...update };
        onChange({ ...state });
    };
    const bounded = async promise => {
        let timer;
        try {
            return await Promise.race([promise, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("Storage protection request timed out.")), timeoutMs);
            })]);
        } finally { clearTimeout(timer); }
    };
    function run(request) {
        if (inFlight) return inFlight;
        publish({ status: "checking", busy: true, error: null });
        inFlight = (async () => {
            try {
                if (!querySupported && !requestSupported) {
                    publish({ status: "unsupported" });
                    return;
                }
                if (querySupported && await bounded(storage.persisted())) {
                    publish({ status: "granted" });
                    return;
                }
                if (request && requestSupported) {
                    publish({ status: "requesting" });
                    const granted = await bounded(storage.persist());
                    publish({ status: granted === true ? "granted" : "not-granted" });
                } else publish({ status: querySupported ? "not-granted" : "unsupported" });
            } catch (error) {
                publish({ status: "error", error: String(error.message || error) });
            } finally { publish({ busy: false }); }
        })().then(() => ({ ...state })).finally(() => { inFlight = null; });
        return inFlight;
    }
    return {
        check: () => run(false),
        request: () => run(true),
        snapshot: () => ({ ...state })
    };
}

export function storagePersistenceLabel(state) {
    return ({
        checking: "Checking storage protection…",
        requesting: "Requesting storage protection…",
        granted: "Protected from automatic eviction",
        "not-granted": "Not granted — browser storage may be automatically removed",
        unsupported: "Persistent-storage protection is unsupported",
        error: "Storage protection could not be checked or requested"
    })[state.status] || "Storage protection is unknown";
}
