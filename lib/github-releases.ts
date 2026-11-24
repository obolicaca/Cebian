const REPOSITORY = 'obolicaca/Cebian';
export const GITHUB_REPO_URL = `https://github.com/${REPOSITORY}`;
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
export const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;

type Distribution = 'chrome' | 'firefox';

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  assets: { name: string; state: string }[];
}

// Manifest versions use the numeric core, even for releases tagged v1.8.3-spike.1.
export function releaseVersion(tag: string): string {
  return /^v?(\d+\.\d+\.\d+)(?:[-+][\w.+-]+)?$/i.exec(tag)?.[1] ?? '';
}

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

function assetName(version: string, distribution: Distribution): string {
  return `cebian-${version}-${distribution}.zip`;
}

export function releaseDownloadUrl(tag: string, distribution: Distribution): string {
  return `${GITHUB_RELEASES_URL}/download/${encodeURIComponent(tag)}/${assetName(releaseVersion(tag), distribution)}`;
}

export function selectDownloadableRelease(releases: readonly GitHubRelease[], distribution: Distribution): string | undefined {
  let latest: { tag: string; version: string } | undefined;
  for (const release of releases) {
    const tag = release.tag_name;
    const version = releaseVersion(tag);
    if (release.draft || !version || !release.assets.some(
      (asset) => asset.state === 'uploaded' && asset.name === assetName(version, distribution),
    )) continue;
    if (!latest || compareVersions(version, latest.version) > 0) latest = { tag, version };
  }
  return latest?.tag;
}
