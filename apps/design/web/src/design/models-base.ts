// Where Part models are served from. The base is configuration, because preview and
// production stages use different buckets. It must be an https URL, or http on localhost
// for development. Nothing is guessed when it is missing: the viewport shows the error.

export type ModelsBase =
  | { ok: true; url: string }
  | { ok: false; message: string }

export function readModelsBase(raw: string | undefined): ModelsBase {
  const value = raw?.trim() ?? ""
  if (value === "")
    return {
      ok: false,
      message: "Part models are not configured. Set VITE_DESIGN_MODELS_URL to the models bucket and build again.",
    }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, message: `VITE_DESIGN_MODELS_URL is not a URL: "${value}".` }
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    return { ok: false, message: "VITE_DESIGN_MODELS_URL must be an https URL." }
  return { ok: true, url: url.href.replace(/\/$/, "") }
}
