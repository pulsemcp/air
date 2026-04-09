# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.12] - 2026-04-08

### Added
- Hooks catalog layer with directory-based definitions (#39)
- Repo-aware `air init` with GitHub resolver discovery (#34)
- Auto-generate `roots.json` for current repo during `air init` (#45)
- Comprehensive user-facing CLI guides (#32)

### Fixed
- Resolve extension packages from project dir, not SDK location (#42)
- Default to empty artifact sets when no root defaults configured — artifacts are now opt-in via root selection (#46)
- Load extensions in `startSession` before resolving artifacts (#48)

## [0.0.11] - 2026-04-07

### Fixed
- Support `${VAR:-default}` fallback syntax in `air-secrets-env` (#38)

## [0.0.10] - 2026-04-07

### Added
- Remove `default_stop_condition` from schemas; allow additional properties (#30)
- Support repo-level `@ref` syntax in GitHub resolver URIs (#33)

### Fixed
- Auto-discover extension packages in CI and publish workflows (#31)
- Improve error messages and edge case handling for `@ref` syntax (#35)
- Normalize trailing-slash stripping in workflow globs (#36)

## [0.0.9] - 2026-04-07

### Added
- Initial changelog
