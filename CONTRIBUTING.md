# Contributing to ATT&CK Workbench REST API

Thank you for your interest in contributing to the ATT&CK Workbench REST API! This guide will help you understand the development process, CI/CD pipeline, and publishing workflow.

## Table of Contents

- [Contributing to ATT\&CK Workbench REST API](#contributing-to-attck-workbench-rest-api)
  - [Table of Contents](#table-of-contents)
  - [Developer's Certificate of Origin v1.1](#developers-certificate-of-origin-v11)
  - [Development Workflow](#development-workflow)
  - [Branching Strategy](#branching-strategy)
  - [Commit Message Guidelines](#commit-message-guidelines)
    - [Types](#types)
  - [Continuous Integration](#continuous-integration)
  - [Releases and Versioning](#releases-and-versioning)
    - [How Versioning Works](#how-versioning-works)
    - [Release Process](#release-process)
  - [Docker Image Publishing](#docker-image-publishing)

## Developer's Certificate of Origin v1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.

## Development Workflow

The project follows these general steps for development:

1. **Fork the Repository**: Start by forking the repository to your own GitHub account.
2. **Create a Feature Branch**: Create a branch from `develop` for your changes.
3. **Implement Changes**: Make your changes following the project's code style.
4. **Write/Update Tests**: Ensure your changes are covered by tests.
5. **Run Tests Locally**: Make sure all tests pass before submitting changes.
6. **Submit a Pull Request**: Create a pull request against the `develop` branch.

If your changes are related to or dependent on changes in [attack-workbench-frontend](https://github.com/mitre-attack/attack-workbench-frontend), please link to the corresponding frontend pull request in your PR description.

## Branching Strategy

The project uses the following branch structure to support semantic-release:

- `main` / `master`: Production-ready code
- `next`: Features for the next minor version
- `next-major`: Features for the next major version
- `beta`: Beta pre-releases
- `alpha`: Alpha pre-releases
- `*.*.x` or `*.x`: Maintenance branches for specific version releases

Always target your pull requests to the `develop` branch unless specifically advised otherwise.

## Commit Message Guidelines

This project uses [conventional commits](https://www.conventionalcommits.org/) to automatically determine semantic versioning through semantic-release. Your commit messages should follow this format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat`: A new feature (triggers a MINOR version bump)
- `fix`: A bug fix (triggers a PATCH version bump)
- `docs`: Documentation only changes
- `style`: Changes that don't affect the code's meaning (whitespace, formatting, etc.)
- `refactor`: Code changes that neither fix a bug nor add a feature
- `perf`: Changes that improve performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools
- `ci`: Changes to CI configuration files and scripts
- `revert`: Reverts a previous commit

Adding `BREAKING CHANGE:` in the commit message footer will trigger a MAJOR version bump.

## Continuous Integration

The project uses GitHub Actions for continuous integration with the following workflow:

1. **Commit Linting**: Ensures all commits follow the conventional commit format
2. **Static Checks**: 
   - Runs linting checks
   - Performs security scanning with Snyk
   - Generates code coverage reports
3. **Build and Test**: Builds the application and runs tests
4. **Release** (on push to release branches):
   - Triggers semantic-release to analyze commits
   - Determines the next version number
   - Creates a GitHub release with release notes
   - Builds and publishes a Docker image

The CI workflow runs on all pull requests to ensure quality before merging.

## Releases and Versioning

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) to automate version management and package publishing based on [Semantic Versioning](https://semver.org/) rules.

### How Versioning Works

- **MAJOR** version when making incompatible API changes (triggered by a `BREAKING CHANGE:` in commit message)
- **MINOR** version when adding functionality in a backward compatible manner (triggered by a `feat:` commit type)
- **PATCH** version when making backward compatible bug fixes (triggered by a `fix:` commit type)

### Release Process

When commits are pushed to a release branch (main, next, etc.), semantic-release:

1. Analyzes the commit messages to determine the next version
2. Creates a new Git tag for the version
3. Generates release notes from commit messages
4. Creates a GitHub release
5. Builds and publishes the Docker image with appropriate tags

Pre-release branches (alpha, beta) will generate pre-release versions with appropriate suffixes.

## Docker Image Publishing

The project publishes Docker images to the GitHub Container Registry (ghcr.io) with these tags:

- `latest`: Points to the most recent release from the main branch
- `v{major}.{minor}.{patch}`: Specific version tags (e.g., `v1.2.3`)
- `{major}.{minor}.{patch}`: Version tags without the 'v' prefix
- `sha-{short-commit-sha}`: Specific commit reference

Docker images include metadata such as version, build time, and commit reference, which are accessible via both environment variables and image labels.

The image contains the Express.js REST API service and is designed to work with a MongoDB database.