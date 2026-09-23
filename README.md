# data-driven

Business development application, built with Next.js and deployed on Azure.

- [docs/COPILOT_INTEGRATION_GUIDE.md](docs/COPILOT_INTEGRATION_GUIDE.md): external REST API, A2A, Telegram, authentication, durable tasks, deployment, testing, and extension guidance for future applications and AI coding agents.
- [docs/DATA_RECOVERY_GUIDE.md](docs/DATA_RECOVERY_GUIDE.md): administrator backup downloads, greenfield initialization, staged data replacement, rollback, and recovery access.
- [infra/README.md](infra/README.md): Azure infrastructure and deployment procedures.

After installing the prerequisites and signing in with `az login`, deploy with
`npm run deploy -- --environment YOUR_ENVIRONMENT`. The runner creates or selects
the environment, preserves deployment secrets and the existing image, runs the
required hooks, deploys, and checks the app. New environments open `/recovery` for
initialization. See the infrastructure guide for permissions, model quota and
optional integrations.

Run `npm ci` and `npm run dev` for local development. Run `npm test`, `npm run typecheck`, and `npm run test:e2e` for the verification gates. Integrations are opt-in and require the configuration described in the guide.
