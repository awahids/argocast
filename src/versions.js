// Release/version helpers for the desktop updater (kept free of Electron so tests can import them).

/** Compares x.y.z versions (ignores a leading v and any -suffix). */
export function compareVersions(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Picks the newest published release with an asset for this Mac; null if none is newer. */
export function pickMacRelease(releases, current, arch) {
  let best = null;
  for (const r of releases) {
    if (r.draft) continue;
    const version = String(r.tag_name).replace(/^v/, '');
    if (compareVersions(version, current) <= 0) continue;
    const asset = r.assets?.find((a) => a.name === `argocast-${version}-mac-${arch}.dmg`);
    if (!asset) continue;
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, url: asset.browser_download_url, size: asset.size, page: r.html_url };
    }
  }
  return best;
}
