# Sign in with GitHub or OpenID Connect

Besides username and password, people can sign in with GitHub or any OpenID Connect provider (Authentik, Keycloak, Authelia, Zitadel, Google, Microsoft Entra ID, …).

Both need `BASE_URL` in `.env`, because the provider sends people back to an address under it. Client IDs and secrets go into `.env` too; it is ignored by git.

## GitHub

1. On GitHub: **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. *Homepage URL*: your `BASE_URL`.
3. *Authorization callback URL*: `<BASE_URL>/api/auth/sso/github/callback`
4. Generate a client secret.
5. In `.env`:

   ```sh
   GITHUB_CLIENT_ID=…
   GITHUB_CLIENT_SECRET=…
   ```

6. `docker compose up -d`

For GitHub Enterprise Server, also set `GITHUB_URL` and `GITHUB_API_URL`.

## OpenID Connect

1. At your provider, create a client of type *confidential* (or *public* with PKCE).
2. Redirect URI: `<BASE_URL>/api/auth/sso/oidc/callback`
3. In `.env`:

   ```sh
   # The issuer URL: the address before /.well-known/openid-configuration
   OIDC_ISSUER=https://auth.example.com/application/o/magpie/
   OIDC_CLIENT_ID=…
   OIDC_CLIENT_SECRET=…        # empty for a public client
   OIDC_NAME=Authentik         # shown on the button: "Sign in with Authentik"
   ```

4. `docker compose up -d`

## How accounts are matched

- Someone signing in through a provider for the first time gets a **new account** (username taken from the provider), but only **if sign-up is open**: `ALLOW_REGISTRATION=true`, or no account exists yet (then it becomes the admin). Such accounts have no password; one can be set under **Settings → Password**.
- With sign-up closed, only provider accounts that are already connected to a user can sign in. Existing users connect them under **Settings → Sign-in methods**, after signing in with their password.
- Accounts are matched by the provider's account id, never by email address or username. Nobody can take over an account by choosing the same name at the provider.

> With `ALLOW_REGISTRATION=true` and GitHub turned on, **anyone with a GitHub account** can create an account. Set it to `false` if only people you add should get in.
