# Contributing to ClawBackup

Thank you for considering contributing to ClawBackup!

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Code Standards](#code-standards)
- [Version Management](#version-management)
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
- Write clear commit messages

## Version Management

We follow [Semantic Versioning 2.0.0](https://semver.org/).

### Version Format

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
```

- **MAJOR**: Incompatible API changes
- **MINOR**: Backwards-compatible new features
- **PATCH**: Backwards-compatible bug fixes
- **PRERELEASE**: Pre-release versions (alpha, beta, rc)
- **BUILD**: Build metadata

### Version Bump Rules

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking API change | MAJOR | 1.0.0 → 2.0.0 |
| New feature (compatible) | MINOR | 1.0.0 → 1.1.0 |
| Bug fix (compatible) | PATCH | 1.0.0 → 1.0.1 |
| Alpha release | PRERELEASE | 1.0.0 → 1.1.0-alpha.1 |
| Beta release | PRERELEASE | 1.1.0-alpha.1 → 1.1.0-beta.1 |
| Release candidate | PRERELEASE | 1.1.0-beta.1 → 1.1.0-rc.1 |
| Stable release | Remove PRERELEASE | 1.1.0-rc.1 → 1.1.0 |

### Release Workflow

1. **Development Phase**
   - Develop on `develop` branch
   - Use feature branches for new features
   - Merge to `develop` via PR

2. **Release Preparation**
   - Create release branch `release/vX.Y.Z`
   - Update version in `package.json`
   - Update `CHANGELOG.md`
   - Run full test suite
   - Update documentation

3. **Release**
   - Merge release branch to `master`
   - Tag the release: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
   - Push tag to GitHub
   - Publish to npm
   - Create GitHub Release with release notes

4. **Post-Release**
   - Merge `master` back to `develop`
   - Close related issues

### Pre-release Versions

Pre-release versions follow this naming convention:

- `X.Y.Z-alpha.N` - Internal testing, unstable API
- `X.Y.Z-beta.N` - Public testing, feature complete
- `X.Y.Z-rc.N` - Release candidate, ready for production

### Branch Strategy

```
master (stable releases)
  │
  ├── release/v1.0.0
  │
develop (integration)
  │
  ├── feature/backup-encryption
  ├── feature/s3-storage
  └── fix/restore-bug
```

- **master**: Production-ready code, only accepts merges from release branches
- **develop**: Integration branch for features
- **feature/***: New features
- **fix/***: Bug fixes
- **release/***: Release preparation
- **hotfix/***: Emergency fixes for production

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**

| Type | Description | Version Impact |
|------|-------------|----------------|
| `feat` | New feature | MINOR |
| `fix` | Bug fix | PATCH |
| `docs` | Documentation only | None |
| `style` | Code style (formatting) | None |
| `refactor` | Code refactoring | None |
| `perf` | Performance improvement | PATCH |
| `test` | Adding/updating tests | None |
| `chore` | Build/tooling changes | None |
| `ci` | CI configuration | None |
| `revert` | Revert previous commit | Varies |
| `breaking` | Breaking change | MAJOR |

**Examples:**

```bash
# Feature
feat(backup): add compression support

# Bug fix
fix(restore): resolve path traversal vulnerability

# Breaking change
feat(api)!: change backup options interface

# With scope
docs(readme): update installation instructions
```

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

## License

By contributing code, you agree that your contributions will be licensed under the Apache License 2.0.

---

Thank you for contributing to ClawBackup! 🎉
