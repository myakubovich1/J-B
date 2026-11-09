# OAuth and correspondence setup

Connections are integrations within an already authenticated J*B account; they are not replacements for app sign-in. The callback checks the current user, provider, state cookie, encrypted one-time state, expiry, and PKCE verifier. State is consumed before code exchange. Tokens remain server-side in the secrets service. The browser receives only connection metadata.

## GitHub

Register a GitHub OAuth app with callback `${APP_URL}/api/integrations/callback/github`. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. The default connection requests `read:user`; the separate private-repository authorization link explicitly requests `repo` in addition to identity access. GitHub’s OAuth `repo` scope is broad: use a dedicated app/test audience, and consider a fine-grained GitHub App connector before public beta.

The repository chooser uses the public REST API when unconnected and the authorized user’s repository list when connected. A user explicitly selects repositories; import stores descriptions, primary language and README source text. It never infers proficiency, sole authorship, or individual contribution. Review and confirm imported projects in Career Profile before generating a resume.

OAuth tokens may be nonexpiring or refreshable depending on the registered app settings. The credential reader supports both and refreshes expiring envelopes. Private discovery reads only the connecting user’s credential, never a global operator token.

Official reference: [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## Gmail

Register a Google web OAuth client and enable Gmail API. The exact redirect is `${APP_URL}/api/integrations/callback/gmail`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

The connector requests `https://www.googleapis.com/auth/gmail.readonly`, because Gmail search requires access beyond the metadata-only scope. This is restricted access. Leave `EMAIL_OAUTH_APPROVED=false` until the provider’s verification/security requirements have been met or an explicitly approved test-user audience is configured. Setting this flag is an operator declaration, not evidence of Google approval.

Connections require the Autonomous plan. OAuth requests offline access and explicit consent. The worker searches only for saved application employer/role subjects after the application date, fetches bounded metadata headers, and retains a message identifier/category rather than unrelated inbox bodies. Refresh tokens remain encrypted. No inbox access occurs before connection consent.

Official references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Microsoft

Register an Entra application with a web redirect `${APP_URL}/api/integrations/callback/outlook`. Configure the supported account audience. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT_ID` (`common` for the configured multi-account flow).

Requested delegated scopes are `User.Read`, `Mail.ReadBasic`, and `offline_access`. The connector retrieves account metadata and narrow subject/from/date fields. It does not require mail sending or modification permissions. Tenant consent policies may require an administrator. Connections require the Autonomous plan.

Official reference: [Microsoft Graph delegated authorization](https://learn.microsoft.com/en-us/graph/auth-v2-user).

## What correspondence can do

The worker polls connected accounts on a configurable schedule. Both the company and role must match before a subject is associated. Recognized categories are possible receipt, interview, rejection, offer, or request for information. Messages are untrusted evidence: notifications and application events are reviewable suggestions. They do not grant submission success, automatically accept an offer, or send a reply.

Users can update tracked interview/rejection/offer/withdrawn status after reviewing their own correspondence. The exact portal receipt remains separate. No verification code is retrieved from an inbox. The manual fallback is user entry directly in an active secure Browserbase sign-in view, or manual completion of an unsupported portal. Password and one-time-code controls never become screening-answer memory.

Disconnect deletes the local/managed credential reference and prevents subsequent requests. A request already in flight may finish; revoke the app in the provider’s account settings to revoke provider access completely. Provider-side token revocation is not currently automated. Reconnect if consent expires or refresh fails.

These code paths require real configured credentials and approval before staging verification. They were not live-tested with private repositories or inboxes during the initial build.
