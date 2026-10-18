// A device fingerprint used (together with IP address and account) to enforce bans.
// Browsers don't expose MAC addresses, so this hashes stable device characteristics instead;
// it stays the same in private/incognito windows on most browsers.

function canvasSignal() {
    try {
        const c = document.createElement('canvas');
        c.width = 220; c.height = 40;
        const g = c.getContext('2d');
        g.textBaseline = 'top';
        g.font = '16px "Arial"';
        g.fillStyle = '#f60';
        g.fillRect(100, 1, 62, 20);
        g.fillStyle = '#069';
        g.fillText('ohmygoal \u{1F44B} 1.0', 2, 15);
        g.fillStyle = 'rgba(102, 204, 0, 0.7)';
        g.fillText('ohmygoal \u{1F44B} 1.0', 4, 17);
        return c.toDataURL();
    } catch { return ''; }
}

function webglSignal() {
    try {
        const gl = document.createElement('canvas').getContext('webgl');
        if (!gl) return '';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return [
            ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
            ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            gl.getParameter(gl.MAX_TEXTURE_SIZE),
        ].join('|');
    } catch { return ''; }
}

let cached = null;
/** 32-hex-character device fingerprint. */
export function deviceFingerprint() {
    cached ||= (async () => {
        const n = navigator;
        const parts = [
            n.userAgent, n.platform, (n.languages || []).join(','), n.hardwareConcurrency, n.deviceMemory,
            n.maxTouchPoints, screen.width, screen.height, screen.colorDepth, window.devicePixelRatio,
            Intl.DateTimeFormat().resolvedOptions().timeZone, canvasSignal(), webglSignal(),
        ].join('~');
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
        return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    })();
    return cached;
}
