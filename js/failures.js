// Plain-language reasons for the things that can go wrong before or during a chat, so nobody sees a raw error code.
// Pure functions: the app passes in what it knows (the error, whether the browser is online, which chat mode).

/** Why a camera or microphone didn't start, and what to do about it. */
export function mediaErrorText(e, mode) {
    const what = mode === 'voice' ? 'microphone' : mode === 'video' ? 'camera' : 'camera or microphone';
    switch (e?.name) {
        case 'NotAllowedError': case 'SecurityError': case 'PermissionDeniedError':
            return `Your ${what} is blocked. Allow it in your browser’s site settings (the icon next to the address), then press Start.`;
        case 'NotFoundError': case 'DevicesNotFoundError':
            return `No ${what} was found. Plug one in and try again.`;
        case 'NotReadableError': case 'TrackStartError': case 'AbortError':
            return `Your ${what} is being used by another app. Close it and try again.`;
        case 'OverconstrainedError': case 'ConstraintNotSatisfiedError':
            return `Your ${what} doesn’t support the quality we asked for.`;
        default:
            return `Your ${what} couldn’t be started.`;
    }
}

/** Errors that mean "no camera right now" (as opposed to "the person said no"): a voice chat is still possible. */
export const CAMERA_UNAVAILABLE = new Set(['NotFoundError', 'DevicesNotFoundError', 'NotReadableError', 'TrackStartError', 'OverconstrainedError']);

/** A matching (queue) error as { title, sub }. */
export function matchFailure(e, online = true) {
    if (online === false) return { title: 'You’re offline', sub: 'Check your internet connection, then press “Find someone new”.' };
    if (e?.code === 'permission-denied') return { title: 'Couldn’t start matching', sub: 'Your access may have expired. Reload the page and try again.' };
    if (e?.code === 'unavailable' || e?.code === 'deadline-exceeded' || /network|timeout|offline/i.test(String(e?.message))) {
        return { title: 'Couldn’t reach the server', sub: 'Your connection looks unstable. Try again in a moment.' };
    }
    return { title: 'Matching failed', sub: 'Something went wrong on our side. Try again in a moment.' };
}

/** The connection did not come back: { title, sub } for the end-of-chat screen.
 *  opened: the chat had started; online: navigator.onLine; hideIp: the privacy relay was in use; stranger: the leaving text. */
export function connectionLostCopy({ opened, online = true, hideIp = false, leftTitle = 'Stranger disconnected' }) {
    if (!opened) {
        return {
            title: 'Couldn’t connect',
            sub: hideIp
                ? 'The privacy relay could not connect. You can turn off “Hide my IP address” in the menu to allow direct connections (this shows your IP address to the other person).'
                : 'Your network or theirs is blocking video calls. Try another Wi-Fi or mobile data, or switch off a VPN.',
        };
    }
    if (online === false) return { title: 'You’re offline', sub: 'Check your internet connection. Press “Find someone new” when you’re back.' };
    return { title: leftTitle, sub: 'Their connection dropped.' };
}
