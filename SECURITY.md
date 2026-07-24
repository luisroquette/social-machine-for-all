# Security policy

Never commit `.env` files, credentials, database exports or platform tokens.
Each installation must use its own Supabase project, deployment and credentials.

Before publishing a fork, run `npm run audit:public-release`. Report a security
issue privately to the maintainers; do not include a usable secret in an issue.
