# Security policy

## Supported versions

Only the latest release (and the `latest` container image built from `main`) receives security
fixes. Please update before reporting.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). If that is not available to you, open an issue that
only says you have a security report and a maintainer will reach out with a private channel.

Include what you can of:

- the version or image digest you tested,
- steps to reproduce or a proof of concept,
- the impact as you understand it.

You can expect an acknowledgement within a week. Fixes ship as a normal release; credit is given
in the changelog unless you prefer otherwise.

## Scope notes

Spotless is a self-hosted application intended for a trusted network or an HTTPS reverse proxy.
The README's "Security model" section describes the threat model; reports that depend on
exposing the server over plain HTTP to the public internet are out of scope.
