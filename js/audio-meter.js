// Voice level meter: calls onLevel(0..1) about 15 times a second for the loudest part of a stream's audio.
// Used to pulse the rings around the avatars in voice chats. Returns a stop function.
export function meterStream(stream, onLevel) {
    const track = stream?.getAudioTracks?.()[0];
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!track || !Ctx) return () => {};
    let ctx;
    try { ctx = new Ctx(); } catch { return () => {}; }
    ctx.resume?.().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let last = 0;
    const loop = t => {
        if (t - last > 66) {
            last = t;
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
            onLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
        }
        raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
        cancelAnimationFrame(raf);
        try { source.disconnect(); } catch { /* already gone */ }
        ctx.close().catch(() => {});
        onLevel(0);
    };
}
