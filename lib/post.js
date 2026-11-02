/**
 * Optional post-processing, core three.js only: sun god rays, ambient occlusion, bloom, vignette + grade.
 * The world is drawn into a half-float target with a depth texture, the effects read that depth, and the final pass
 * tone-maps (ACES) + writes to the canvas, so the look matches the direct render. The viewmodel is drawn afterwards.
 */
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const IGN = `float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

const AO_FRAG = `
#include <packing>
uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uProjInv;
uniform float uNear; uniform float uFar; uniform float uRadius; uniform vec2 uTexel;
varying vec2 vUv;
${IGN}
vec3 vpos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 c = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return c.xyz / c.w;
}
void main() {
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 > 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = vpos(vUv);
  vec3 pr = vpos(vUv + vec2(uTexel.x, 0.0)), pl = vpos(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = vpos(vUv + vec2(0.0, uTexel.y)), pd = vpos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(pl.z - P.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(pd.z - P.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) N = -N;
  vec3 T = normalize(abs(N.y) < 0.95 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0)));
  vec3 B = cross(N, T);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float f = (float(i) + 0.5) / 12.0;
    float a = rot + float(i) * 2.39996323;
    float rr = sqrt(f);
    vec3 dv = T * (cos(a) * rr) + B * (sin(a) * rr) + N * sqrt(1.0 - f);
    vec3 sp = P + dv * (uRadius * (0.2 + 0.8 * f));
    vec4 pc = uProj * vec4(sp, 1.0);
    vec2 suv = pc.xy / pc.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sz = perspectiveDepthToViewZ(texture2D(tDepth, suv).x, uNear, uFar);
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sz), 1e-4));
    occ += (sz >= sp.z + 0.03 ? 1.0 : 0.0) * range;
  }
  float ao = pow(clamp(1.0 - occ / 12.0, 0.0, 1.0), 1.6);
  ao = mix(ao, 1.0, smoothstep(35.0, 110.0, -P.z));
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;

const AO_BLUR_FRAG = `
#include <packing>
uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 uDir; uniform float uNear; uniform float uFar;
varying vec2 vUv;
float lz(vec2 uv) { return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
void main() {
  float cz = lz(vUv);
  float sum = texture2D(tAO, vUv).r * 0.227027, ws = 0.227027;
  for (int i = 1; i <= 4; i++) {
    float w0 = i == 1 ? 0.1945946 : i == 2 ? 0.1216216 : i == 3 ? 0.0540541 : 0.0162162;
    for (int s = -1; s <= 1; s += 2) {
      vec2 uv = vUv + uDir * float(i * s);
      float w = w0 * exp(-abs(lz(uv) - cz) / max(0.15, -cz * 0.02));
      sum += texture2D(tAO, uv).r * w; ws += w;
    }
  }
  gl_FragColor = vec4(vec3(sum / ws), 1.0);
}`;

const RAYS_FRAG = `
uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect;
varying vec2 vUv;
${IGN}
const int N = 48;
void main() {
  vec2 delta = (uSun - vUv) * (0.95 / float(N));
  vec2 uv = vUv + delta * ign(gl_FragCoord.xy);
  float illum = 0.0, w = 1.0, wsum = 0.0;
  for (int i = 0; i < N; i++) {
    uv += delta;
    vec2 cuv = clamp(uv, vec2(0.0), vec2(1.0));
    float sky = step(0.99999, texture2D(tDepth, cuv).x);
    vec2 q = (cuv - uSun) * vec2(uAspect, 1.0);
    float g = exp(-length(q) * 1.6);
    illum += sky * g * w; wsum += w; w *= 0.995;
  }
  gl_FragColor = vec4(vec3(illum / wsum), 1.0);
}`;

const BRIGHT_FRAG = `
uniform sampler2D tScene; uniform vec2 uTexel; uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = (texture2D(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tScene, vUv + uTexel * vec2(1.0, -1.0)).rgb
          + texture2D(tScene, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tScene, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
  c = min(c, vec3(8.0));
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tIn; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tIn, vUv).rgb * 0.227027027;
  c += texture2D(tIn, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tIn, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tIn, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tIn, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMP_FRAG = `
uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tAO; uniform sampler2D tRays; uniform sampler2D tBloom;
uniform float uAO; uniform float uRays; uniform float uBloom; uniform vec3 uSunColor; uniform vec2 uRayTexel;
varying vec2 vUv;
void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  #ifdef USE_AO
    col *= mix(1.0, texture2D(tAO, vUv).r, uAO);
  #endif
  #ifdef USE_RAYS
    float r = texture2D(tRays, vUv).r * 0.4
      + (texture2D(tRays, vUv + vec2(uRayTexel.x, 0.0)).r + texture2D(tRays, vUv - vec2(uRayTexel.x, 0.0)).r
       + texture2D(tRays, vUv + vec2(0.0, uRayTexel.y)).r + texture2D(tRays, vUv - vec2(0.0, uRayTexel.y)).r) * 0.15;
    float sky = step(0.99999, texture2D(tDepth, vUv).x);
    col += uSunColor * r * uRays * mix(1.0, 0.3, sky);
  #endif
  #ifdef USE_BLOOM
    col += texture2D(tBloom, vUv).rgb * uBloom;
  #endif
  #ifdef USE_GRADE
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, 1.1) * vec3(1.03, 1.0, 0.95);
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * 0.85;
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createPost(renderer) {
  const ext = renderer.extensions;
  const supported = !!renderer.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
  const fx = { rays: false, ao: false, bloom: false, grade: false, msaa: false };
  let W = 2, H = 2, rtScene = null, rtAO = null, rtRays = null, rtBloom = null, dirty = true, active = false;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(geo, null);
  quad.frustumCulled = false;
  const qScene = new THREE.Scene();
  qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(qScene, qCam); };
  const U = (o) => { const u = {}; for (const k in o) u[k] = { value: o[k] }; return u; };
  const mk = (frag, uniforms, defines) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: U(uniforms), defines: defines || {}, depthTest: false, depthWrite: false });

  const mAO = mk(AO_FRAG, { tDepth: null, uProj: new THREE.Matrix4(), uProjInv: new THREE.Matrix4(), uNear: 0.05, uFar: 400, uRadius: 0.7, uTexel: new THREE.Vector2() });
  const mAOB = mk(AO_BLUR_FRAG, { tAO: null, tDepth: null, uDir: new THREE.Vector2(), uNear: 0.05, uFar: 400 });
  const mRays = mk(RAYS_FRAG, { tDepth: null, uSun: new THREE.Vector2(), uAspect: 1 });
  const mBright = mk(BRIGHT_FRAG, { tScene: null, uTexel: new THREE.Vector2(), uThreshold: 1.05 });
  const mBlur = mk(BLUR_FRAG, { tIn: null, uDir: new THREE.Vector2() });
  const mComp = mk(COMP_FRAG, {
    tScene: null, tDepth: null, tAO: null, tRays: null, tBloom: null, uAO: 0.85, uRays: 0, uBloom: 0.4,
    uSunColor: new THREE.Vector3(1.0, 0.86, 0.62), uRayTexel: new THREE.Vector2(),
  });

  const rt = (w, h, o) => new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), Object.assign({ minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }, o));
  const clearRT = (t) => { renderer.setRenderTarget(t); renderer.clear(); };

  function free() {
    for (const t of [rtScene, rtAO && rtAO[0], rtAO && rtAO[1], rtRays, rtBloom && rtBloom[0], rtBloom && rtBloom[1]]) {
      if (t) { if (t.depthTexture) t.depthTexture.dispose(); t.dispose(); }
    }
    rtScene = rtAO = rtRays = rtBloom = null;
  }
  function ensure() {
    if (!dirty) return;
    free();
    const samples = fx.msaa ? Math.min(4, renderer.capabilities.maxSamples || 0) : 0;
    rtScene = rt(W, H, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture: new THREE.DepthTexture(W, H), samples });
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1), qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2);
    rtAO = [rt(hw, hh), rt(hw, hh)];
    rtRays = rt(hw, hh);
    rtBloom = [rt(qw, qh, { type: THREE.HalfFloatType }), rt(qw, qh, { type: THREE.HalfFloatType })];
    for (const t of [rtAO[0], rtAO[1], rtRays, rtBloom[0], rtBloom[1]]) clearRT(t);
    dirty = false;
  }

  const _v = new THREE.Vector3(), _d = new THREE.Vector3();

  return {
    supported,
    get active() { return active; },
    configure(o) {
      const was = JSON.stringify(fx);
      Object.assign(fx, { rays: false, ao: false, bloom: false, grade: false, msaa: false }, o);
      active = supported && (fx.rays || fx.ao || fx.bloom || fx.grade);
      if (JSON.stringify(fx) !== was) {
        if (fx.msaa !== JSON.parse(was).msaa) dirty = true;
        const d = mComp.defines;
        for (const [k, on] of [['USE_AO', fx.ao], ['USE_RAYS', fx.rays], ['USE_BLOOM', fx.bloom], ['USE_GRADE', fx.grade]]) { if (on) d[k] = ''; else delete d[k]; }
        mComp.needsUpdate = true;
      }
      return active;
    },
    setSize(w, h) {
      if (w === W && h === H) return;
      W = Math.max(2, w | 0); H = Math.max(2, h | 0);
      dirty = true;
    },
    render(scene, camera, sunDir) {
      ensure();
      renderer.setRenderTarget(rtScene);
      renderer.clear();
      renderer.render(scene, camera);
      const depth = rtScene.depthTexture, near = camera.near, far = camera.far;
      const hw = rtAO[0].width, hh = rtAO[0].height;

      if (fx.ao) {
        const u = mAO.uniforms;
        u.tDepth.value = depth; u.uProj.value = camera.projectionMatrix; u.uProjInv.value = camera.projectionMatrixInverse;
        u.uNear.value = near; u.uFar.value = far; u.uTexel.value.set(1 / W, 1 / H);
        pass(mAO, rtAO[0]);
        const b = mAOB.uniforms;
        b.tDepth.value = depth; b.uNear.value = near; b.uFar.value = far;
        b.tAO.value = rtAO[0].texture; b.uDir.value.set(1 / hw, 0); pass(mAOB, rtAO[1]);
        b.tAO.value = rtAO[1].texture; b.uDir.value.set(0, 1 / hh); pass(mAOB, rtAO[0]);
        mComp.uniforms.tAO.value = rtAO[0].texture;
      }

      let rayK = 0;
      if (fx.rays) {
        _v.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
        camera.getWorldDirection(_d);
        const facing = _d.dot(sunDir), edge = Math.max(Math.abs(_v.x), Math.abs(_v.y));
        rayK = smooth(-0.05, 0.4, facing) * (1 - smooth(1.0, 2.2, edge));
        if (rayK > 0.01) {
          mRays.uniforms.tDepth.value = depth;
          mRays.uniforms.uSun.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
          mRays.uniforms.uAspect.value = W / H;
          pass(mRays, rtRays);
          mComp.uniforms.tRays.value = rtRays.texture;
        } else rayK = 0;
      }
      mComp.uniforms.uRays.value = rayK * 0.6;
      mComp.uniforms.uRayTexel.value.set(1 / hw, 1 / hh);

      if (fx.bloom) {
        const qw = rtBloom[0].width, qh = rtBloom[0].height;
        mBright.uniforms.tScene.value = rtScene.texture; mBright.uniforms.uTexel.value.set(1 / W, 1 / H);
        pass(mBright, rtBloom[0]);
        for (let i = 0; i < 2; i++) {
          mBlur.uniforms.tIn.value = rtBloom[0].texture; mBlur.uniforms.uDir.value.set(1 / qw, 0); pass(mBlur, rtBloom[1]);
          mBlur.uniforms.tIn.value = rtBloom[1].texture; mBlur.uniforms.uDir.value.set(0, 1 / qh); pass(mBlur, rtBloom[0]);
        }
        mComp.uniforms.tBloom.value = rtBloom[0].texture;
      }

      mComp.uniforms.tScene.value = rtScene.texture;
      mComp.uniforms.tDepth.value = depth;
      pass(mComp, null);
    },
    dispose() { free(); },
  };
}
