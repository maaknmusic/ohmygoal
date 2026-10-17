// =====================================================================
// On-device nudity detection (NSFWJS MobileNetV2 model, hosted in /models/nsfw).
// Frames never leave the device; only the resulting scores are used.
// =====================================================================

const SIZE = 224;

export class NudityGuard {
    /** getTf: async () => tf (reuses the TensorFlow.js instance already loaded for the age check). */
    constructor(getTf, modelUrl) {
        this.getTf = getTf;
        this.modelUrl = modelUrl;
        this.model = null;
        this.loading = null;
    }

    load() {
        this.loading ||= (async () => {
            const tf = this.tf = await this.getTf();
            this.model = await tf.loadLayersModel(this.modelUrl);
            tf.tidy(() => this.model.predict(tf.zeros([1, SIZE, SIZE, 3]))); // warm up
            return this;
        })();
        this.loading.catch(() => { this.loading = null; });
        return this.loading;
    }

    /**
     * Scores for one video frame, or null if not ready. explicit = porn + hentai.
     * Calls take turns (partner and self checks share the model); a call is dropped
     * only if two are already waiting, so slow devices never build a backlog.
     */
    check(video) {
        if (!this.model || this.waiting >= 2) return Promise.resolve(null);
        this.waiting = (this.waiting || 0) + 1;
        const run = this.queue = (this.queue || Promise.resolve()).then(() => this.classify(video)).finally(() => { this.waiting--; });
        return run;
    }

    async classify(video) {
        if (!video?.videoWidth || video.readyState < 2) return null;
        try {
            const tf = this.tf;
            const out = tf.tidy(() => {
                const img = tf.browser.fromPixels(video).toFloat().div(255);
                return this.model.predict(tf.image.resizeBilinear(img, [SIZE, SIZE], true).reshape([1, SIZE, SIZE, 3]));
            });
            const d = await out.data();
            out.dispose();
            return { drawing: d[0], hentai: d[1], neutral: d[2], porn: d[3], sexy: d[4], explicit: d[1] + d[3] };
        } catch (e) {
            console.warn('nudity check failed', e);
            return null;
        }
    }
}
