// The ground: an endless grid in real units. Minor lines are half an inch (12.7 mm), the
// hole pitch, and major lines are five inches. Minor lines fade out when they would be
// closer together than a few pixels, and the grid fades with distance from the camera.

import { Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from "three"
import type { SceneColors } from "./colors"

export const MINOR_MM = 12.7
export const MAJOR_MM = 127

export function createGrid(colors: SceneColors): {
  mesh: Mesh
  setCamera: (at: Vector3) => void
} {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMinor: { value: MINOR_MM },
      uMajor: { value: MAJOR_MM },
      uMinorColor: { value: colors.grid },
      uMajorColor: { value: colors.gridMajor },
      uCamera: { value: new Vector3() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uMinor;
      uniform float uMajor;
      uniform vec3 uMinorColor;
      uniform vec3 uMajorColor;
      uniform vec3 uCamera;
      varying vec3 vWorld;

      // Anti-aliased lines every \`size\` millimetres, \`width\` pixels wide, and how many
      // cells each pixel spans (so the caller can fade lines that are too dense).
      float lines(vec2 p, float size, float width, out float density) {
        vec2 cell = p / size;
        vec2 span = fwidth(cell);
        density = max(span.x, span.y);
        vec2 g = abs(fract(cell - 0.5) - 0.5) / max(span, vec2(1e-6));
        return 1.0 - min(min(g.x, g.y) / width, 1.0);
      }

      void main() {
        vec2 p = vWorld.xz;
        float minorDensity;
        float minor = lines(p, uMinor, 1.0, minorDensity);
        // Minor lines fade out once they are closer than about eight pixels apart.
        minor *= 1.0 - smoothstep(0.1, 0.2, minorDensity);
        float majorDensity;
        float major = lines(p, uMajor, 1.3, majorDensity);
        major *= 1.0 - smoothstep(0.2, 0.35, majorDensity);

        float distanceFade = 1.0 - smoothstep(1500.0, 7000.0, length(vWorld.xz - uCamera.xz));
        vec3 color = mix(uMinorColor, uMajorColor, step(0.001, major));
        float alpha = max(minor * 0.22, major * 0.6) * distanceFade;
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })
  const geometry = new PlaneGeometry(200000, 200000)
  geometry.rotateX(-Math.PI / 2)
  const mesh = new Mesh(geometry, material)
  mesh.position.y = -0.05
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  return {
    mesh,
    setCamera: (at) => {
      material.uniforms.uCamera.value.copy(at)
    },
  }
}
