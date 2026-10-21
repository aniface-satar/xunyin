# Update delivery

The app treats the version manifest and the APK download as separate links.

## Manifest sources

The app requests these sources concurrently and uses the highest successful version:

1. `https://aniface-satar.github.io/xunyin/version.json`
2. `https://gitee.com/not-a-chanci/xunyin/raw/main/publish/version.json`
3. jsDelivr and jsdmirror mirrors
4. GitHub raw mirrors and direct GitHub raw

GitHub Pages is published by `.github/workflows/publish-version-page.yml` whenever `publish/version.json` changes.

For Gitee, create a mirrored repository and push `main` with the same manifest.

## APK sources

The default APK link order is GitHub proxy mirrors, then Gitee release, then GitHub release. Missing sources are skipped.

The manifest can prepend HTTPS download URLs:

```json
{
  "downloadUrls": {
    "arm64-v8a": ["https://example.com/app.apk"],
    "universal": ["https://example.com/universal.apk"]
  }
}
```

Unknown ABIs fall back to `universal`.

## Known gap: the Gitee line is dead (2026-10-22)

The mirror repository is **private**, so anonymous requests get 403 on both Gitee
endpoints (`/raw/main/publish/version.json` and `/releases/download/...`). This is
not an IP-level block — from the same machine a known public repo
(`gitee.com/oschina/git-osc`) answers 200 on both HTML and API, while ours answers
403/404. Pushes still work over the PAT, so the repo exists and is not suspended;
only its visibility is private.

Impact today is zero:

- Manifest: sources are fetched concurrently and the highest version wins, so a
  permanently failing Gitee entry is just one candidate that never contributes.
- APK: URLs are tried in order and `ghproxy.net` (first in the list) answered 206
  for `v1.2.0` arm64-v8a, so Gitee is never reached.

The real risk is later: Gitee is meant to be the third backup in the download
chain. `ghfast.top` is already dead, and direct GitHub is unreachable from
mainland networks. If `ghproxy.net` and `gh-proxy.com` are unavailable at the same
time, users fall through to Gitee (403) and then to direct GitHub (timeout), and
the update download fails.

Decision: **do not fix now.** This is optional hardening, not a requirement — no
user of `v1.2.0` is affected. Revisit when several proxies are down at once or
someone reports a failed download. Fixing is server-side only, so old clients
benefit without an app update.

If it is fixed later, both steps are needed:

1. Log in to Gitee and switch the repository to public (owner login required).
2. Create a Release for the current version on the Gitee web UI and upload the five
   APKs by hand — the Gitee API has consistently returned 400 for Release creation.

Note when committing docs like this one: `release.yml` triggers on every push to
`main` with no path filter, so a docs-only push rebuilds all five APKs and appends
a second MD5 block to the release body. Use `[skip ci]` in the commit message for
docs-only changes.
