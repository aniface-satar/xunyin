# Update delivery

The app treats the version manifest and the APK download as separate links.

## Manifest sources

The app requests these sources concurrently and uses the highest successful version:

1. `https://aniface-satar.github.io/xunyin/version.json`
2. `https://gitee.com/aniface-satar/xunyin/raw/main/publish/version.json`
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
