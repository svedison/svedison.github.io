// Planar reflection for the calm water (the water town lives on its reflections: the arch and its mirror make a
// full circle). Renders the scene from the camera mirrored in y = level into a reduced-size HDR target (linear,
// un-tonemapped), with an oblique near plane at the water so nothing below the surface leaks in. The calmWater
// shader is extended (onBeforeCompile on this instance only) to sample it projectively, distorted by the same
// ripple normal, and to fall back to its analytic sky where the target is empty (alpha 0).
import type * as THREE_NS from 'three';

type THREE = typeof THREE_NS;

export interface Reflection {
  /** Render the reflection for this camera. `hide` objects are hidden during the pass. */
  render(renderer: THREE_NS.WebGLRenderer, scene: THREE_NS.Scene, camera: THREE_NS.PerspectiveCamera, hide: THREE_NS.Object3D[]): void;
  setSize(w: number, h: number): void;
  setScale(s: number): void;
  setStrength(s: number): void;
  /** Camera layer mask for the reflection pass (only objects on these layers, and lights on them, are drawn). */
  setLayers(mask: number): void;
  enabled: boolean;
  dispose(): void;
}

export function createReflection(THREE: THREE, waterMat: THREE_NS.ShaderMaterial, level = 0, scale = 0.5): Reflection {
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
  rt.texture.generateMipmaps = false;
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  const texMatrix = new THREE.Matrix4();
  const virtualCam = new THREE.PerspectiveCamera();
  const uniforms = {
    uRefl: { value: rt.texture },
    uReflMat: { value: texMatrix },
    uReflAmt: { value: 1 },
    uReflOn: { value: 1 },
  };
  waterMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'varying vec3 vWorld;',
        'varying vec3 vWorld;\nuniform sampler2D uRefl;\nuniform mat4 uReflMat;\nuniform float uReflAmt, uReflOn;',
      )
      .replace(
        'vec3 col = mix(body, refl, F);',
        /* glsl */ `
        float rA = 0.0;
        if (uReflOn > 0.5) {
          vec4 rc = uReflMat * vec4(vWorld, 1.0);
          // modest distortion: strong offsets smear the whitewash into blown-out blobs on the swell
          rc.xy += N.xz * 0.2 * rc.w * (0.3 + 0.7 * fineK);
          vec4 rs = texture2DProj(uRefl, rc);
          rA = clamp(rs.a, 0.0, 1.0) * uReflAmt;
          refl = mix(refl, rs.rgb, rA);
        }
        // reflections of solid things read stronger than the sky's (dark water, bright walls)
        vec3 col = mix(body, refl, max(F, rA * 0.62));`,
      )
      // sun glint: a wider, capped lobe. The stock pow(600) x 3 lobe blows out into hard white ellipses in the
      // mist (and worse at low DPR, where one ripple facet covers many pixels).
      .replace(
        'col += uSunColor * sg * 3.0 * uSun * step(0.0, uSunDir.y);',
        /* glsl */ `float sgw = pow(max(dot(R, uSunDir), 0.0), 140.0);
        col += uSunColor * min(sg * 0.9 + sgw * 0.32, 0.42) * uSun * step(0.0, uSunDir.y);`,
      );
  };
  waterMat.customProgramCacheKey = () => 'calm-water-planar-refl-2';
  waterMat.needsUpdate = true;

  const normal = new THREE.Vector3(0, 1, 0);
  const planePoint = new THREE.Vector3(0, level, 0);
  const camPos = new THREE.Vector3();
  const view = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const target = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const clear = new THREE.Color();
  const prevVis: boolean[] = [];
  let s = scale;
  let w = 2, h = 2;

  const api: Reflection = {
    enabled: true,
    setSize(W, H) {
      w = W;
      h = H;
      const rw = Math.max(2, Math.round(W * s)), rh = Math.max(2, Math.round(H * s));
      if (rt.width !== rw || rt.height !== rh) rt.setSize(rw, rh);
    },
    setScale(v) {
      s = v;
      api.setSize(w, h);
    },
    setStrength(v) {
      uniforms.uReflAmt.value = v;
    },
    setLayers(mask) {
      virtualCam.layers.mask = mask;
    },
    render(renderer, scene, camera, hide) {
      uniforms.uReflOn.value = api.enabled ? 1 : 0;
      if (!api.enabled) return;
      camPos.setFromMatrixPosition(camera.matrixWorld);
      view.subVectors(planePoint, camPos);
      if (view.dot(normal) > 0) return; // camera under the water
      view.reflect(normal).negate().add(planePoint);
      rot.extractRotation(camera.matrixWorld);
      lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      target.subVectors(planePoint, lookAt).reflect(normal).negate().add(planePoint);
      virtualCam.position.copy(view);
      virtualCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
      virtualCam.lookAt(target);
      virtualCam.near = camera.near;
      virtualCam.far = camera.far;
      virtualCam.updateMatrixWorld();
      virtualCam.projectionMatrix.copy(camera.projectionMatrix);
      texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      texMatrix.multiply(virtualCam.projectionMatrix).multiply(virtualCam.matrixWorldInverse);
      // oblique near plane = the water surface (Lengyel)
      plane.setFromNormalAndCoplanarPoint(normal, planePoint).applyMatrix4(virtualCam.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const pm = virtualCam.projectionMatrix.elements;
      q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
      q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
      q.z = -1;
      q.w = (1 + pm[10]) / pm[14];
      clip.multiplyScalar(2 / clip.dot(q));
      pm[2] = clip.x;
      pm[6] = clip.y;
      pm[10] = clip.z + 1 - 0.003;
      pm[14] = clip.w;
      virtualCam.projectionMatrixInverse.copy(virtualCam.projectionMatrix).invert();

      for (let i = 0; i < hide.length; i++) {
        prevVis[i] = hide[i].visible;
        hide[i].visible = false;
      }
      const prevRT = renderer.getRenderTarget();
      renderer.getClearColor(clear);
      const prevAlpha = renderer.getClearAlpha();
      const prevShadow = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(scene, virtualCam);
      renderer.setRenderTarget(prevRT);
      renderer.setClearColor(clear, prevAlpha);
      renderer.shadowMap.autoUpdate = prevShadow;
      for (let i = 0; i < hide.length; i++) hide[i].visible = prevVis[i];
    },
    dispose() {
      rt.dispose();
    },
  };
  return api;
}
