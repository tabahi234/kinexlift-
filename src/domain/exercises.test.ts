import { describe, expect, it } from 'vitest';
import { EXERCISES, videoUrl } from './exercises';

describe('videoUrl', () => {
  it('links to a YouTube search built from the name when no video is pinned', () => {
    const url = videoUrl({ name: 'Goblet squat' });
    expect(url.startsWith('https://www.youtube.com/results?search_query=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('Goblet squat');
  });

  it('links straight to a pinned video when one exists', () => {
    expect(videoUrl({ name: 'Plank', videoId: 'abc123' })).toBe(
      'https://www.youtube.com/watch?v=abc123',
    );
  });

  it('survives a name with punctuation, and the query round-trips intact', () => {
    const name = 'Pull-up / chin-up (assisted)';
    const url = new URL(videoUrl({ name }));
    expect(url.pathname).toBe('/results');
    expect(url.searchParams.get('search_query')).toContain(name);
  });

  it('gives every exercise in the library a link', () => {
    for (const exercise of EXERCISES) {
      expect(videoUrl(exercise)).toMatch(/^https:\/\/www\.youtube\.com\//);
    }
  });
});
