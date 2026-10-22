// =====================================================================
// GPU matte refinement for the background effects (WebGL2, optional: effects.js falls back to the canvas path).
//
// The segmentation model only sees 256 x 256 pixels, so its mask is blurry when enlarged to the output size. This
// shader enlarges it with a joint bilateral filter (taps weighted by how similar the camera colours are, so the
// edge snaps to the real edge of the hair/shoulders), then thresholds it at full resolution with a one-pixel
// anti-aliased edge. A second pass produces a thin "light wrap" layer: the new background's colour spilling over
// the person's edge, which also hides the fringe of the old room.
//
// Original code written for this project; no third-party shaders.
// =====================================================================

const VERT = `#version 300 es
out vec2 vUv;
void main() {
    vec2 p = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);   // one big triangle
    gl_Position = vec4(p, 0.0, 1.0);
    vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uConf;    // temporally smoothed person confidence (256 x 256, one channel)
uniform sampler2D uFrame;   // camera frame
uniform sampler2D uBg;      // tiny copy of the new background (light wrap colour)
uniform vec2 uPx;           // one output pixel in uv units
uniform float uT;           // confidence at the person's edge
uniform float uSoft;        // half width of the edge ramp, in confidence units
uniform float uRadius;      // bilateral tap radius in output pixels (0 = plain bilinear)
uniform float uWrap;        // light wrap strength
uniform int uMode;          // 0 = alpha mask, 1 = light wrap layer

const vec2 TAP[12] = vec2[12](
    vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
    vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071),
    vec2(2.0, 0.0), vec2(0.0, 2.0), vec2(-2.0, 0.0), vec2(0.0, -2.0));

float refine(vec2 uv) {
    float c = texture(uConf, uv).r;
    if (uRadius < 0.5) return c;
    vec3 c0 = texture(uFrame, uv).rgb;
    float acc = c, ws = 1.0;
    for (int i = 0; i < 12; i++) {
        vec2 off = TAP[i] * uPx * uRadius;
        vec3 d = texture(uFrame, uv + off).rgb - c0;
        float w = exp(-dot(d, d) * 18.0) * (i < 8 ? 1.0 : 0.7);
        acc += w * texture(uConf, uv + off).r;
        ws += w;
    }
    return acc / ws;
}

void main() {
    float c = refine(vUv);
    float fw = fwidth(c);
    float a = smoothstep(uT - uSoft - fw * 0.5, uT + uSoft + fw * 0.5, c);
    if (uMode == 0) { o = vec4(0.0, 0.0, 0.0, a); return; }
    float amt = a * (1.0 - smoothstep(uT, uT + 0.4, c)) * uWrap;
    o = vec4(texture(uBg, vUv).rgb * amt, amt);
}`;

export class MatteGL {
    /** Returns null when WebGL2 is not available. */
    static create() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
            if (!gl) return null;
            const m = new MatteGL(canvas, gl);
            return m.ok ? m : null;
        } catch { return null; }
    }

    constructor(canvas, gl) {
        this.canvas = canvas; this.gl = gl; this.ok = false; this.lost = false;
        canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; this.ok = false; });
        const sh = (type, src) => {
            const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
            return s;
        };
        try {
            const prog = gl.createProgram();
            gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
            this.prog = prog;
        } catch (e) { console.warn('matte gl', e); return; }
        gl.useProgram(this.prog);
        this.u = {};
        for (const n of ['uConf', 'uFrame', 'uBg', 'uPx', 'uT', 'uSoft', 'uRadius', 'uWrap', 'uMode']) this.u[n] = gl.getUniformLocation(this.prog, n);
        gl.uniform1i(this.u.uConf, 0); gl.uniform1i(this.u.uFrame, 1); gl.uniform1i(this.u.uBg, 2);
        const tex = () => {
            const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        };
        this.tConf = tex(); this.tFrame = tex(); this.tBg = tex();
        this.confSize = [0, 0];
        this.bgSrc = null;
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.disable(gl.BLEND);
        this.vao = gl.createVertexArray();
        this.ok = true;
    }

    resize(W, H) {
        if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
        this.gl.viewport(0, 0, W, H);
        this.gl.useProgram(this.prog);
        this.gl.uniform2f(this.u.uPx, 1 / W, 1 / H);
    }

    /** Upload this frame's inputs: conf8 = Uint8Array(cw*ch), frame = video/canvas, bg = tiny canvas for the wrap (or null). */
    upload(conf8, cw, ch, frame, bg) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tConf);
        if (this.confSize[0] !== cw || this.confSize[1] !== ch) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cw, ch, 0, gl.RED, gl.UNSIGNED_BYTE, conf8); this.confSize = [cw, ch]; }
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cw, ch, gl.RED, gl.UNSIGNED_BYTE, conf8);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tFrame);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        if (bg && bg !== this.bgSrc) {
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tBg);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bg);
            this.bgSrc = bg;
        }
    }

    /** mode 0: alpha mask (use with destination-in); mode 1: light-wrap layer (use with source-atop). Returns the GL canvas. */
    draw(mode, { t = 0.55, soft = 0.07, radius = 3, wrap = 0.6 } = {}) {
        const gl = this.gl;
        gl.useProgram(this.prog);
        gl.uniform1i(this.u.uMode, mode); gl.uniform1f(this.u.uT, t); gl.uniform1f(this.u.uSoft, soft);
        gl.uniform1f(this.u.uRadius, radius); gl.uniform1f(this.u.uWrap, wrap);
        gl.bindVertexArray(this.vao);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return this.canvas;
    }
}
