// Vite returns the hashed URL for font files imported with ?url. The UI package
// does not reference vite/client types, so declare the module here.
declare module "*.woff2?url" {
  const url: string
  export default url
}
