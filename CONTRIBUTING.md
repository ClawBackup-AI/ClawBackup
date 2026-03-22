# Contributing to ClawBackup

Thank you for considering contributing to ClawBackup!

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Code Standards](#code-standards)
- [Pull Request Process](#pull-request-process)
- [License](#license)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How to Contribute

### Reporting Bugs

If you find a bug, please submit a report via [GitHub Issues](https://github.com/ClawBackup-AI/ClawBackup/issues). Include:

- Operating system and Node.js version
- OpenClaw version
- Steps to reproduce
- Expected behavior vs actual behavior
- Relevant logs (if any)

### Suggesting Features

Feature suggestions are welcome! Please describe in an Issue:

- Feature description
- Use case
- Expected behavior

### Submitting Code

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

## Development Setup

```bash
# Clone the repository
git clone https://github.com/ClawBackup-AI/ClawBackup.git
cd ClawBackup

# Install dependencies
npm install

# Run tests
npm test

# Code linting
npm run lint

# Type checking
npm run typecheck

# Build
npm run build
```

## Code Standards

- Use TypeScript
- Follow existing code style
- Add necessary tests
- Update related documentation
- Write clear commit messages (see [VERSIONING.md](VERSIONING.md#commit-message-convention))

## Pull Request Process

1. **Before Submitting**
   - Ensure all tests pass
   - Update documentation
   - Add tests for new features
   - Follow code style guidelines

2. **PR Title**
   - Use conventional commit format
   - Example: `feat(backup): add compression support`

3. **PR Description**
   - Describe the changes
   - Reference related issues
   - List breaking changes (if any)

4. **Review Process**
   - At least one approval required
   - All CI checks must pass
   - Resolve all review comments

5. **After Approval**
   - Squash commits if needed
   - Maintainer will merge

## Version Management

For version management, release workflow, and commit conventions, see [VERSIONING.md](VERSIONING.md).

## License

By contributing code, you agree that your contributions will be licensed under the Apache License 2.0.

---

Thank you for contributing to ClawBackup! 🎉
