// All writers must use this coordinator. Web Locks share the browser's storage
// scope and are released by the browser when a page/process is destroyed.
export function createRecordingStorageCoordinator(lockManager, name) {
    let tail = Promise.resolve();
    let owner = null;
    const enqueue = operation => {
        const result = tail.then(operation);
        tail = result.catch(() => {});
        return result;
    };
    function requireLocks() {
        if (!lockManager?.request) throw new Error("This browser cannot coordinate recording storage safely. Use a browser with Web Locks support.");
    }
    const busy = () => new Error("Recording storage is in use by another tab. Stop its recording and try again.");
    return {
        run(operation) {
            return enqueue(() => {
                requireLocks();
                if (owner) return operation();
                return lockManager.request(name, { ifAvailable: true }, lock => {
                    if (!lock) throw busy();
                    return operation();
                });
            });
        },
        hold() {
            return enqueue(() => {
                requireLocks();
                if (owner) throw new Error("A recording is already starting or finishing in this page.");
                return new Promise((resolve, reject) => {
                    let release;
                    const lifetime = new Promise(done => { release = done; });
                    lockManager.request(name, { ifAvailable: true }, lock => {
                        if (!lock) { reject(busy()); return; }
                        const lease = { release: () => enqueue(() => {
                            if (owner === lease) { owner = null; release(); }
                        }) };
                        owner = lease;
                        resolve(lease);
                        return lifetime;
                    }).catch(reject);
                });
            });
        }
    };
}
