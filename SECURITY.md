# Security policy

## Supported versions

Only the latest version on `main` is supported.

## Reporting a vulnerability

Please **don't open a public issue**. Report privately through [GitHub Security Advisories](https://github.com/danielco1420/registry-challange/security/advisories/new) with:
- a description and impact,
- steps to reproduce,
- affected routes or components.

We aim to acknowledge reports within 3 business days.

## Scope notes

- This app proxies public Docker Hub data. Issues in Docker Hub itself should go to Docker.
- Of particular interest:
  - proxy abuse (SSRF, open proxy, rate-limit bypass)
  - XSS through rendered repository descriptions
  - secret leakage

Known risks and mitigations are tracked in [docs/RISKS.md](docs/RISKS.md).
