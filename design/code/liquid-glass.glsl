/** @resolution */
uniform vec2 u_resolution;

/** @backdrop */
uniform sampler2D u_backdrop;

/** @sdf */
uniform sampler2D u_sdf;

/**
 * @label Tint
 * @color
 * @default #00000000
 */
uniform vec4 u_tint;

const float MARGIN = 0.5333;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float sdf(vec2 uv) {
  return texture2D(u_sdf, uv).r;
}

float bias(float u, float amount) {
  return amount * u / max(amount * u + (1.0 - amount) * (1.0 - u), 1e-5);
}

float lobe(float cosAngle, float spread) {
  float cs = cos(spread);
  return clamp((cosAngle - cs) / (1.0 - cs), 0.0, 1.0);
}

float rimLight(vec2 normal, float depth, float angle, float spread) {
  float c = dot(normal, vec2(sin(angle), cos(angle)));
  float bevel = clamp(1.0 - 0.75 * depth, 0.0, 1.0);
  float key = depth < 1.0 ? bias(bevel * lobe(c, spread), 0.5) : 0.0;
  float diffuse = clamp(1.0 - depth / 8.0, 0.0, 1.0);
  return key + bias(diffuse * lobe(c, spread * 0.65), 0.075);
}

vec3 applyTint(vec3 c, vec4 tint) {
  vec3 t = tint.rgb;
  float hi = max(t.r, max(t.g, t.b));
  float lo = min(t.r, min(t.g, t.b));
  vec3 tinted;
  if (hi - lo < 1e-4) {
    float mid = hi * (1.0 - hi);
    tinted = (0.3125 - 0.0156 * mid) * c + (1.1875 * hi - 0.25 - 0.017 * mid);
  } else {
    float l = 0.5 * (hi + lo);
    float chroma = l <= 0.5
      ? 57.0 / 85.0
      : min(87.0 * l - 15.0, 105.0 - 57.0 * l) / (85.0 * (1.0 - l));
    vec3 dark = clamp(
      45.0 / 85.0 * l + chroma * (t - l),
      -15.0 / 85.0 * t,
      1.0 + 15.0 / 85.0 * (1.0 - t));
    tinted = dark + (t - dark) * dot(c, LUMA);
  }

  return mix(c, clamp(tinted, 0.0, 1.0832), tint.a);
}

void main() {
  vec2 px = 1.0 / u_resolution;
  vec2 uv = gl_FragCoord.xy * px;

  vec2 h = 0.5 * px;
  vec2 grad = vec2(
    sdf(uv + vec2(h.x, 0.0)) - sdf(uv - vec2(h.x, 0.0)),
    sdf(uv + vec2(0.0, h.y)) - sdf(uv - vec2(0.0, h.y)));
  vec2 inward = normalize(grad + 1e-6);
  vec2 normal = -inward;

  float d = sdf(uv);
  if (d < 1.0) {
    d = sdf(uv + inward * px) - 1.0;
  }

  vec3 back = texture2D(u_backdrop, uv).rgb;
  float edge = bias(lobe(abs(normal.x), radians(106.0)), 0.4);
  vec3 margin = applyTint(mix(back, back * (0.1 + 0.6 * back), edge), u_tint);

  float g = max(d - MARGIN, 0.0);
  float m = min(u_resolution.x, u_resolution.y) - 2.0 * MARGIN;

  float amount = min(60.0, 0.5 * m);
  float height = min(20.0, 0.25 * m);
  float t = clamp(1.0 - g / height, 0.0, 1.0);
  float offset = amount * (1.0 - sqrt(1.0 - t * t));
  vec2 suv = uv + inward * offset * px;

  vec2 q = 0.25 * px;
  vec3 c = 0.25 * (
    texture2D(u_backdrop, suv + vec2(-q.x, -q.y)).rgb +
    texture2D(u_backdrop, suv + vec2(q.x, -q.y)).rgb +
    texture2D(u_backdrop, suv + vec2(-q.x, q.y)).rgb +
    texture2D(u_backdrop, suv + vec2(q.x, q.y)).rgb);

  float luma = dot(c, LUMA);
  float plain = 0.3815 + luma * (0.632 - 0.0291 * luma);
  float bled = 0.405 + luma * (0.6587 + luma * (0.0657 - 0.1326 * luma));
  float lifted = mix(plain, bled, max(m - 64.0, 0.0) / 86.0);
  c = clamp(lifted + 1.2 * (c - luma), 0.0, 1.0);
  c = mix(c, vec3(1.0), 0.22);

  c = applyTint(c, u_tint);

  float spread = radians(80.0 + 10.0 * clamp((m - 96.0) / 96.0, 0.0, 1.0));
  float light = rimLight(normal, g, 0.0, spread) + rimLight(normal, g, 3.1415927, spread);

  vec3 gain = max(0.176 - 0.106 * c, 0.0);
  c = clamp(c + light * gain, 0.0, 1.0);

  float inside = clamp((d - 0.5 * MARGIN) / MARGIN, 0.0, 1.0);
  gl_FragColor = vec4(mix(margin, c, inside), 1.0);
}
