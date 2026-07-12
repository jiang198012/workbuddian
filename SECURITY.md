# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via [GitHub Security Advisories](https://github.com/jiang198012/workbuddian/security/advisories/new). Include steps to reproduce, impact, and the affected version.

## Scope & threat model

Workbuddian runs entirely on your desktop. It spawns the local **WorkBuddy / CodeBuddy CLI** via `child_process.spawn` with your vault as the working directory. It has **no server component and sends no telemetry**. Relevant areas: CLI path/argument handling, `--permission-mode` passthrough, files/selection injected into CLI prompts, and reading arbitrary attached files.

## Supported versions

The latest release receives fixes. Older versions are not maintained.
