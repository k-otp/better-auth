# Sampo

This repository uses [Sampo](https://github.com/bruits/sampo) for changesets,
versioning and the changelog of `@k-otp/better-auth`
(`npm/@k-otp/better-auth`).

- Add a changeset for any user-facing change:

  ```bash
  sampo add
  sampo add -p npm/@k-otp/better-auth -b patch -m "Fix ..."
  ```

- Preview the next release locally (releases are cut from `main`):

  ```bash
  SAMPO_RELEASE_BRANCH=main sampo release --dry-run
  ```

After merges to `main`, the Release workflow keeps a single `sampo/release` PR
(version bump + changelog) up to date. Merging that PR publishes to npm once
the `NPM_TOKEN` repository secret is set; see
[docs/releasing.md](../docs/releasing.md). The first release is **0.1.0**.
