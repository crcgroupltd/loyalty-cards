# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub instead: open the [Security tab](https://github.com/crcgroupltd/loyalty-cards/security) of this repository and choose **Report a vulnerability**. Include:
- what an attacker can do;
- the steps or a proof of concept to reproduce it;
- the version or commit you tested.

You should get an acknowledgement within 7 days. Please allow reasonable time for a fix before disclosing publicly. Reporters are credited in the release notes unless they prefer not to be.

## Supported versions

Only the latest release receives security fixes.

## Scope

In scope:
- **Authentication:** sessions, passwords, passkeys, invite and reset links, setup token.
- **Access control:** reading or changing another user's cards or shares.
- **Injection:** XSS, CSRF, SQL injection, and similar issues in the app.
- **Server-side request forgery:** for example through logo fetching.
- **Data exposure:** through the API, logs or the offline cache.

Out of scope:
- **Misconfigured deployments:** for example, no HTTPS, a wrong `ORIGIN`, or a `TRUST_PROXY` setting that trusts everyone.
- **Third-party services:** problems in services such as logo.dev, or in your reverse proxy.
- **Denial of service:** volumetric attacks.

This is a self-hosted project. Whoever runs an instance is responsible for securing that server and the data on it.
