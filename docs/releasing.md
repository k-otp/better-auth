# Releasing

`@k-otp/better-auth` is published to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements).
[Sampo](https://github.com/bruits/sampo) owns the version and `CHANGELOG.md`.

## Adding a changeset

Every PR that changes what users get (`src/`, `package.json`) adds a changeset.
CI warns when one is missing.

```bash
sampo add
sampo add -p npm/@k-otp/better-auth -b patch -m "Fix ..."
```

The package id is always `npm/@k-otp/better-auth`. Write the text for users: it
becomes the changelog entry. `patch` for fixes, `minor` for compatible
features, `major` for breaking changes.

Preview:

```bash
SAMPO_RELEASE_BRANCH=main sampo release --dry-run
```

## Day-to-day flow

1. PRs add changesets.
2. After merge to `main`, `.github/workflows/release.yml` runs Sampo, which
   keeps a `sampo/release` PR up to date (version bump + changelog).
3. Merging that PR pushes the new version to `main`. If `NPM_TOKEN` is set and
   the version is not on npm yet, the workflow builds, tests, and runs
   `npm publish <tarball> --access public --provenance`.

`0.0.0` is never published. The first release is **0.1.0** (minor changeset
from `0.0.0`).

## Repository secret the owner must add

Publishing does not happen until this secret exists. Do not add it until you
are ready for the next unpublished version on `main` to be published.

| Name | Where | What |
| --- | --- | --- |
| `NPM_TOKEN` | GitHub → Settings → Secrets and variables → Actions → Repository secrets | npm granular access token (or automation token) that can publish `@k-otp/better-auth`. Bypass 2FA for CI, or use a granular token with only this package. |

The workflow also needs:

- Actions allowed to create and approve pull requests (the Sampo release PR).
- `id-token: write` (already in `release.yml`) so `npm publish --provenance`
  can sign the attestation. Node 24 on the runner supplies npm >= 11.5.1.
- The `k-otp` npm org, and you as an owner. Trusted publishing is **not**
  required; this repo publishes with `NPM_TOKEN` plus provenance.

There is no npm token in the repository. `NPM_TOKEN` is a GitHub Actions
secret, not a committed file.

## Manual publish

Prefer the workflow. If you must publish from a trusted machine after the
version in `package.json` is the one you want (and it is not `0.0.0`):

```bash
bun install
bun run check
bun pm pack
npm publish k-otp-better-auth-0.1.0.tgz --access public --provenance
```

Publish the `bun pm pack` tarball, never `npm publish` of the working tree
without a build (`prepublishOnly` refuses a missing `dist/`). Then tag
`v0.1.0` and create the GitHub Release, or let the next workflow run do it.
