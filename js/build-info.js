// Production build: UTC release date + daily sequence. See docs/build-versioning.md.
export const APP_BUILD = '2026-11-13.11';

export function displayBuildInfo(element) {
    if (element) element.textContent = `iMuse build ${APP_BUILD}`;
}
