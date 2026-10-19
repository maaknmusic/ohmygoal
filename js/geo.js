// Country detection, flags and names.

// Common countries offered in the filter (ISO 3166-1 alpha-2). The user's own country is added if missing.
export const COUNTRIES = [
    'US', 'GB', 'CA', 'AU', 'IN', 'PK', 'BD', 'NP', 'LK', 'AE', 'SA', 'EG', 'MA', 'NG', 'KE', 'ZA',
    'DE', 'FR', 'IT', 'ES', 'PT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'RO',
    'GR', 'TR', 'UA', 'RU', 'IL', 'IR', 'BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'JP', 'KR', 'CN', 'TW',
    'HK', 'SG', 'MY', 'ID', 'PH', 'TH', 'VN', 'NZ', 'IE',
];

export function flagOf(code) {
    if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) return '🌐';
    return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

let regionNames = null;
export function countryName(code) {
    if (!code) return 'Unknown';
    try {
        regionNames ||= new Intl.DisplayNames(['en'], { type: 'region' });
        return regionNames.of(code) || code;
    } catch { return code; }
}

function fromLocale() {
    for (const lang of navigator.languages || [navigator.language]) {
        const m = /-([A-Z]{2})$/i.exec(lang || '');
        if (m) return m[1].toUpperCase();
    }
    return '';
}

/** Best-effort country of the user: IP lookup (cached for a day), falling back to browser locale. */
export async function detectCountry(store) {
    const cached = store.get('country', null);
    if (cached && cached.until > Date.now()) return cached.code;
    let code = '';
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch('https://api.country.is/', { signal: ctrl.signal });
        clearTimeout(timer);
        code = String((await res.json()).country || '').toUpperCase();
    } catch { /* offline or blocked */ }
    if (!/^[A-Z]{2}$/.test(code)) code = fromLocale();
    if (code) store.set('country', { code, until: Date.now() + 86400000 });
    return code;
}
