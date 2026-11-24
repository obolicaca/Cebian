import { describe, expect, it } from 'vitest';
import { selectDownloadableRelease, releaseDownloadUrl } from './github-releases';

const release = (tag_name: string, names: string[], extra = {}) => ({
  tag_name,
  draft: false,
  assets: names.map((name) => ({ name, state: 'uploaded' })),
  ...extra,
});

describe('selectDownloadableRelease', () => {
  it('selects the highest downloadable version, including public prereleases', () => {
    const tag = selectDownloadableRelease([
      release('v1.8.12', ['cebian-1.8.12-chrome.zip'], { draft: true }),
      release('v1.8.9', ['cebian-1.8.9-firefox.zip']),
      release('v1.8.3-spike.1', ['cebian-1.8.3-chrome.zip']),
      release('v1.8.4', ['cebian-1.8.4-chrome.zip'], { prerelease: true }),
    ], 'chrome');
    expect(tag).toBe('v1.8.4');
    expect(releaseDownloadUrl(tag!, 'chrome')).toBe(
      'https://github.com/obolicaca/Cebian/releases/download/v1.8.4/cebian-1.8.4-chrome.zip',
    );
  });

  it('uses the matching browser asset and ignores invalid tags and incomplete uploads', () => {
    expect(selectDownloadableRelease([
      release('notes', ['cebian-1.8.7-firefox.zip']),
      release('v1.8.8', [], { assets: [{ name: 'cebian-1.8.8-firefox.zip', state: 'new' }] }),
      release('v1.8.10', ['cebian-1.8.10-chrome.zip']),
      release('v1.8.9', ['cebian-1.8.9-firefox.zip']),
    ], 'firefox')).toBe('v1.8.9');
    expect(selectDownloadableRelease([], 'chrome')).toBeUndefined();
  });
});
