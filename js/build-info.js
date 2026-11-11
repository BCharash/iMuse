// Production build: UTC release date + daily sequence. See docs/build-versioning.md.
export const APP_BUILD = '2026-11-11.6';

export function displayBuildInfo(element) {
    if (element) element.textContent = `iMuse build ${APP_BUILD}`;
}
