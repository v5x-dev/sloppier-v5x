const clientId = process.env.WORKOS_CLIENT_ID

const providers = clientId
  ? [
      {
        type: "customJwt",
        issuer: "https://api.workos.com/",
        algorithm: "RS256",
        jwks: `https://api.workos.com/sso/jwks/${clientId}`,
        applicationID: clientId,
      },
      {
        type: "customJwt",
        issuer: `https://api.workos.com/user_management/${clientId}`,
        algorithm: "RS256",
        jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      },
    ]
  : []

// Opt-in public keys for short-lived development demo accounts. No signing key
// is sent to Convex. Production deployments must leave this unset.
if (process.env.CODE_DEMO_JWKS && process.env.CODE_DEMO_ISSUER) {
  providers.push({
    type: "customJwt",
    issuer: process.env.CODE_DEMO_ISSUER,
    algorithm: "RS256",
    jwks: `data:application/json;base64,${process.env.CODE_DEMO_JWKS}`,
    applicationID: "code-collaboration-demo",
  })
}

export default { providers }
