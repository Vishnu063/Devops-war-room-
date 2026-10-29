# NovaCart development security checklist

- Public registration creates CUSTOMER accounts only.
- OWNER access must be provisioned outside public routes.
- Do not put passwords, API keys, database URLs or session tokens in Git.
- Use HTTPS and secure session cookies before public deployment.
- Test origin checks, authorization, rate limits and session expiry.
- Use a shared rate-limit store when running multiple server instances.
- Verify database migrations on a disposable database.
- Run automated tests before deploying.
- Payment, order fulfillment and refunds are not production ready.
