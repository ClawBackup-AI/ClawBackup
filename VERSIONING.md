# Version Management

This document describes the version management strategy for ClawBackup.

## Semantic Versioning

We follow [Semantic Versioning 2.0.0](https://semver.org/).

### Version Format

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
```

| Component | Description |
|-----------|-------------|
| **MAJOR** | Incompatible API changes |
| **MINOR** | Backwards-compatible new features |
| **PATCH** | Backwards-compatible bug fixes |
| **PRERELEASE** | Pre-release versions (alpha, beta, rc) |
| **BUILD** | Build metadata |

## Version Bump Rules

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking API change | MAJOR | 1.0.0 → 2.0.0 |
| New feature (compatible) | MINOR | 1.0.0 → 1.1.0 |
| Bug fix (compatible) | PATCH | 1.0.0 → 1.0.1 |
| Alpha release | PRERELEASE | 1.0.0 → 1.1.0-alpha.1 |
| Beta release | PRERELEASE | 1.1.0-alpha.1 → 1.1.0-beta.1 |
| Release candidate | PRERELEASE | 1.1.0-beta.1 → 1.1.0-rc.1 |
| Stable release | Remove PRERELEASE | 1.1.0-rc.1 → 1.1.0 |

## Pre-release Versions

| Type | Format | Description |
|------|--------|-------------|
| Alpha | `X.Y.Z-alpha.N` | Internal testing, unstable API |
| Beta | `X.Y.Z-beta.N` | Public testing, feature complete |
| Release Candidate | `X.Y.Z-rc.N` | Ready for production |

## Branch Strategy

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

### Branch Types

| Branch | Purpose | Merge Target |
|--------|---------|--------------|
| `master` | Production-ready code | Only from release/hotfix |
| `develop` | Integration branch | From feature/fix branches |
| `feature/*` | New features | → develop |
| `fix/*` | Bug fixes | → develop |
| `release/*` | Release preparation | → master, develop |
| `hotfix/*` | Emergency production fixes | → master, develop |

## Release Workflow

### 1. Development Phase

- Develop on `develop` branch
- Use feature branches for new features (`feature/xxx`)
- Use fix branches for bug fixes (`fix/xxx`)
- Merge to `develop` via Pull Request

### 2. Release Preparation

```bash
# Create release branch
git checkout develop
git checkout -b release/v1.1.0

# Update version
npm version minor --no-git-tag-version

# Update CHANGELOG.md
# Run full test suite
npm test
npm run lint
npm run typecheck
npm run build

# Commit changes
git add .
git commit -m "chore: prepare release v1.1.0"
```

### 3. Release

```bash
# Merge to master
git checkout master
git merge --no-ff release/v1.1.0

# Create tag
git tag -a v1.1.0 -m "Release v1.1.0"

# Push to GitHub
git push origin master
git push origin v1.1.0

# Publish to npm
npm publish

# Create GitHub Release
# (via GitHub UI or CLI)
```

### 4. Post-Release

```bash
# Merge back to develop
git checkout develop
git merge --no-ff master

# Delete release branch
git branch -d release/v1.1.0

# Push
git push origin develop
```

## Hotfix Workflow

For emergency fixes to production:

```bash
# Create hotfix branch from master
git checkout master
git checkout -b hotfix/v1.0.1

# Fix the issue
# Update version
npm version patch --no-git-tag-version

# Commit
git add .
git commit -m "fix: resolve critical issue"

# Merge to master
git checkout master
git merge --no-ff hotfix/v1.0.1
git tag -a v1.0.1 -m "Hotfix v1.0.1"

# Merge to develop
git checkout develop
git merge --no-ff hotfix/v1.0.1

# Push and publish
git push origin master --tags
git push origin develop
npm publish
```

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

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

### Breaking Changes

For breaking changes, add `!` after the type or include `BREAKING CHANGE:` in the footer:

```bash
# Using !
feat(api)!: change backup options interface

# Using footer
feat(api): change backup options interface

BREAKING CHANGE: The backup options interface has changed.
```

### Examples

| Description | Commit Message |
|-------------|----------------|
| New backup compression feature | `feat(backup): add compression support` |
| Fix restore bug | `fix(restore): resolve path traversal vulnerability` |
| Breaking API change | `feat(api)!: change backup options interface` |
| Update documentation | `docs(readme): update installation instructions` |

---

For contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).
