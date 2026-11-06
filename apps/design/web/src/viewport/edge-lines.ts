import type { MeshStandardMaterial } from "three"

// Darkens a surface where its shading normal turns sharply across one pixel: the real edges
// of a Part. Smooth curves change a little per pixel and stay unmarked. It is one derivative
// in the fragment shader, with no extra pass and no extra draw calls, so 2,000 Parts pay
// almost nothing for it.
const LOW = 0.04
const HIGH = 0.2

export function withEdgeLines(
  material: MeshStandardMaterial,
  strength = 0.8
): MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `#include <opaque_fragment>
      float edgeTurn = length(fwidth(normal));
      gl_FragColor.rgb *= 1.0 - ${strength.toFixed(3)} * smoothstep(${LOW.toFixed(3)}, ${HIGH.toFixed(3)}, edgeTurn);`
    )
  }
  material.customProgramCacheKey = () => `edge-lines-${strength}-${LOW}-${HIGH}`
  return material
}
