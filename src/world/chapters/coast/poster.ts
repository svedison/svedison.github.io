// The coast's arrival poster: drawn from the very first frame while the full set (ocean bake, cube, post targets,
// shader compiles) builds in the background, then cross-faded away. It is the same golden hour in one cheap pass
// (apricot horizon, deeper zenith, a warm low sun with its glitter path, a dark sea band and a bluff line), so the
// chapter never shows an empty slate and the dark ink copy always sits on a light ground.
import type * as THREE_NS from 'three';

type THREE = typeof THREE_NS;

export interface Poster {
  /** Draw the poster over whatever is in the default framebuffer, at the given opacity (0..1). */
  render(renderer: THREE_NS.WebGLRenderer, opacity: number, sunX: number, horizonY: number, aspect: number): void;
  dispose(): void;
}

export function createPoster(THREE: THREE): Poster {
  const uniforms = {
    uOpacity: { value: 1 },
    uSun: { value: new THREE.Vector2(0.3, 0.7) },
    uHorizon: { value: 0.66 },
    uAspect: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    // colours are display-space sRGB, matching the graded live frame
    fragmentShader: /* glsl */ `
      uniform float uOpacity, uHorizon, uAspect;
      uniform vec2 uSun;
      varying vec2 vUv;
      void main(){
        float y = vUv.y;
        float hy = uHorizon;
        // matched to the graded live frame (apricot to peach; the blue zenith sits above the frame)
        vec3 zen = vec3(0.84, 0.62, 0.52);
        vec3 mid = vec3(0.94, 0.74, 0.55);
        vec3 hor = vec3(0.96, 0.66, 0.43);
        float s = clamp((y - hy) / max(1e-3, 1.0 - hy), 0.0, 1.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.35, s));
        c = mix(c, zen, smoothstep(0.3, 1.0, s));
        // sun: warm core and broad halo
        vec2 q = (vUv - uSun) * vec2(uAspect, 1.0);
        float r = length(q);
        c += vec3(1.0, 0.72, 0.42) * (exp(-r * 9.0) * 0.32 + exp(-r * 30.0) * 0.35);
        c = mix(c, vec3(1.0, 0.86, 0.62), 1.0 - smoothstep(0.018, 0.026, r));
        if (y < hy) {
          // sea: darker teal-slate with the glitter path under the sun, lighter toward the horizon
          float d = (hy - y) / max(hy, 1e-3);
          vec3 sea = mix(vec3(0.95, 0.74, 0.52), vec3(0.74, 0.62, 0.52), smoothstep(0.0, 0.3, d));
          sea = mix(sea, vec3(0.5, 0.56, 0.54), smoothstep(0.35, 0.6, d));
          float path = exp(-pow((vUv.x - uSun.x) * uAspect / (0.03 + d * 0.22), 2.0));
          float flick = 0.6 + 0.4 * sin(y * 900.0) * sin(vUv.x * 300.0 + y * 120.0);
          sea += vec3(1.0, 0.78, 0.52) * path * (1.0 - smoothstep(0.0, 0.7, d)) * (0.35 + 0.3 * flick);
          // the lit beach in the foreground, a pale foam rim where it meets the water
          float edge = d + 0.03 * sin(vUv.x * 9.0) + 0.02 * sin(vUv.x * 23.0);
          sea = mix(sea, vec3(0.97, 0.92, 0.84), exp(-pow((edge - 0.64) / 0.012, 2.0)) * 0.6);
          float land = smoothstep(0.63, 0.67, edge);
          sea = mix(sea, mix(vec3(0.88, 0.72, 0.54), vec3(0.8, 0.62, 0.46), smoothstep(0.7, 1.0, d)), land);
          c = sea;
        }
        // a whisper of horizon haze
        c = mix(c, hor, exp(-abs(y - hy) * 60.0) * 0.5);
        gl_FragColor = vec4(c, uOpacity);
      }`,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    render(renderer, opacity, sunX, horizonY, aspect) {
      if (opacity <= 0.001) return;
      uniforms.uOpacity.value = Math.min(1, opacity);
      uniforms.uSun.value.set(sunX, Math.min(0.97, horizonY + 0.07));
      uniforms.uHorizon.value = horizonY;
      uniforms.uAspect.value = aspect;
      const auto = renderer.autoClear;
      renderer.autoClear = opacity < 1 ? false : auto;
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
      renderer.autoClear = auto;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
