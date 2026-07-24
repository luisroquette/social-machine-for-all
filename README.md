# Social Machine

Social Machine is an open-source, self-hosted content operations system. It
includes editorial agents, approval flows, social publishing, analytics and
optional video workflows. It is licensed under [MIT](LICENSE).

## What you operate

You bring your own Supabase project, deployment, social accounts and API keys.
Nothing is shared with the project maintainers. You are responsible for costs,
published content, platform policies and applicable law.

## Quick start

1. Create a new Supabase project and apply `supabase/migrations` in order.
2. Copy `.env.example` to `.env.local` and set the three Supabase variables.
3. Run `npm ci` and `npm run dev`.
4. Create a Supabase Auth user, sign in, then configure your workspace in the
   dashboard settings.
5. Add only the credentials for modules you intend to use. Publishing and cron
   jobs should remain disabled until configuration is complete.

## Safety defaults

- No credentials, workspace ID, social account or deployment are bundled.
- Missing configuration makes an integration skip or fail safely.
- Cron jobs must be enabled deliberately in your deployment configuration.
- Run `npm run audit:public-release` before publishing a fork.

## Optional modules and costs

AI, video rendering, email, analytics and social platforms are optional. They
may incur third-party charges. Review each provider's pricing before enabling a
module; the project never supplies provider credentials.

## Development

```bash
npm ci
npm test
npm run build
```

See [SECURITY.md](SECURITY.md) before reporting a vulnerability.
