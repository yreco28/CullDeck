# Security Policy

CullDeck is a local, offline desktop application. It never uploads your files, so the main security surface is local file handling and the Electron runtime. If you find a problem, please report it privately.

## Supported Versions

Only the latest 1.x release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x: |

If you are running an older build, update to the newest release before reporting an issue.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions or pull requests.**

Use GitHub's private vulnerability reporting:

1. Open the [Security tab](https://github.com/yreco28/CullDeck/security) of this repository.
2. Click **Report a vulnerability**.
3. Fill in the form with as much detail as possible.

Direct link: <https://github.com/yreco28/CullDeck/security/advisories/new>

Reports may be written in **Turkish or English**.

### What to include

- CullDeck version (shown in the app, or `version` in `package.json`)
- Windows version and architecture (for example Windows 11 24H2, x64)
- Steps to reproduce
- Expected and actual behavior
- Impact and a realistic attack scenario
- Proof of concept, logs or screenshots, if available

### What to expect

| Stage | Target |
| --- | --- |
| Acknowledgment of the report | within 5 business days |
| Initial assessment (valid / invalid, severity) | within 10 business days |
| Status update while the report is open | at least every 7 days |
| Fix or mitigation | depends on severity; coordinated with you |

If the report is **accepted**, we will:

- keep you informed during the investigation,
- prepare and release a fix,
- publish a GitHub Security Advisory once the fix is available,
- credit you in the advisory, unless you prefer to stay anonymous.

If the report is **declined**, we will explain why (for example: not reproducible, out of scope, or not a security issue) and, where possible, point you to a better place to report it.

## Scope

CullDeck scans folders on your machine and can delete files to the Recycle Bin or permanently. Relevant areas include:

- unsafe file handling (path traversal, symlinks, malicious filenames),
- unintended permanent deletion or deletion outside the selected folder,
- privilege or permission issues in the installer or portable build,
- Electron hardening (context isolation, Node integration, loading remote content),
- exposure of local data or credentials.

### Out of scope

- Vulnerabilities in third-party dependencies without a demonstrable exploit path in CullDeck,
- issues that require physical access to an unlocked machine or an already compromised system,
- social engineering,
- unsupported Windows versions,
- UI bugs or missing features with no security impact.

## Disclosure Policy

We follow coordinated disclosure. Please give us a reasonable amount of time to fix the issue before publishing details. We will not take legal action against researchers who act in good faith, follow this policy, and avoid privacy violations, data destruction or service disruption.

## Safe Harbor

Security research conducted in good faith under this policy is considered authorized. Test only against your own installation and data. Never access, modify or delete other people's files.
