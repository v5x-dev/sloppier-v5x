# Mobile authentication

Mobile uses the same WorkOS AuthKit client and Convex backend as web. Copy `.env.example` to `.env.local` and supply the public client ID and Convex deployment URL. No WorkOS API secret belongs in the app.

In the WorkOS dashboard, add `v5x-code://callback` to the application's allowed redirect URIs. Enable public client authentication / PKCE and configure each social provider you intend to offer. For the Expo web build, also allow the exact web origin's `/callback` URL and configure its allowed CORS origin.

Email opens hosted AuthKit with the email address prefilled. Provider buttons select the corresponding WorkOS OAuth provider. Sign up opens hosted registration. WorkOS handles password, email verification, MFA, and provider consent before returning to the app.

Native refresh tokens are stored in Expo SecureStore. Access tokens stay in memory and refresh through WorkOS when Convex requests a new token. Web refresh tokens use sessionStorage. Signing out removes the local session.

The app now starts through `expo-router/entry`. The signed-out route is `/sign-in`, the auth return route is `/callback`, and `/` is a protected dashboard that lists the user's Convex workspaces and creates their personal workspace on first sign-in.

Adding Expo Router, AuthSession, WebBrowser and SecureStore and registering the `v5x-code` URL scheme requires rebuilding an existing development client before using native sign-in. Start Metro with `bun run start` after rebuilding.
