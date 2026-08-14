# Security Policy

## Supported version

Security fixes are applied to the latest source version. Published binaries are unsigned test builds until the release documentation explicitly says otherwise.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue containing credentials, exploit details, private logs, or user data.

Include the affected version, platform, reproduction steps, impact, and any suggested mitigation. Remove API keys and personal paths from screenshots and logs.

## Security boundary

HarnessDesk binds Harness to the local loopback interface, restricts renderer IPC, and stores its data separately from the command-line Harness profile. Local processes running as the same operating-system user may still be able to read application files; HarnessDesk is not a security boundary against an already-compromised user account.
