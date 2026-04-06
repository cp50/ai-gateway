# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

If you find a security issue, please report it privately — don't open a public issue.

**Email:** reach out to the maintainer via GitHub ([@cp50](https://github.com/cp50))

Include as much detail as you can:

- Steps to reproduce
- Affected components (auth, caching, provider routing, etc.)
- Potential impact

## What to Expect

- Acknowledgment within 48 hours
- Fix or mitigation plan within 7 days for confirmed issues
- Credit in the release notes (unless you prefer to stay anonymous)

## Scope

This policy covers the ai-gateway codebase and its default configuration. Third-party provider APIs and their security are outside scope.

Things we care about:

- API key exposure or leakage
- Authentication bypass
- Cache poisoning
- Injection via prompt or config
- Unauthorized access to admin endpoints
