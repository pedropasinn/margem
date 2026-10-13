import { describe, expect, test } from 'vitest';
import { idDoVideoDoYoutube, urlDeAssistirNoYoutube, urlDoPlayerDoYoutube } from './youtube';

describe('idDoVideoDoYoutube', () => {
  test.each([
    ['https://www.youtube.com/watch?v=dO8EW2LqBfU', 'dO8EW2LqBfU'],
    ['https://youtube.com/watch?v=dO8EW2LqBfU&t=42s&list=PL123', 'dO8EW2LqBfU'],
    ['http://m.youtube.com/watch?feature=share&v=dO8EW2LqBfU', 'dO8EW2LqBfU'],
    ['https://music.youtube.com/watch?v=dO8EW2LqBfU', 'dO8EW2LqBfU'],
    ['https://youtu.be/dO8EW2LqBfU', 'dO8EW2LqBfU'],
    ['https://youtu.be/dO8EW2LqBfU?si=abc&t=10', 'dO8EW2LqBfU'],
    ['youtu.be/dO8EW2LqBfU', 'dO8EW2LqBfU'],
    ['www.youtube.com/watch?v=dO8EW2LqBfU', 'dO8EW2LqBfU'],
    ['https://www.youtube.com/embed/dO8EW2LqBfU?enablejsapi=1', 'dO8EW2LqBfU'],
    ['https://www.youtube-nocookie.com/embed/dO8EW2LqBfU', 'dO8EW2LqBfU'],
    ['https://www.youtube.com/shorts/dO8EW2LqBfU', 'dO8EW2LqBfU'],
    ['https://www.youtube.com/live/dO8EW2LqBfU?feature=share', 'dO8EW2LqBfU'],
    ['https://www.youtube.com/v/dO8EW2LqBfU', 'dO8EW2LqBfU'],
    ['  https://WWW.YOUTUBE.COM/watch?v=a-b_c1D2e3F  ', 'a-b_c1D2e3F'],
    ['https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3DdO8EW2LqBfU%26feature%3Dshare', 'dO8EW2LqBfU'],
  ])('%s → %s', (url, id) => { expect(idDoVideoDoYoutube(url)).toBe(id); });

  test.each([
    '', 'dO8EW2LqBfU', 'https://vimeo.com/123456789', 'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/@FernandoUlrichCanal', 'https://www.youtube.com/watch?v=curto',
    'https://www.youtube.com/watch?v=dO8EW2LqBfU0', 'https://youtube.com.evil.example/watch?v=dO8EW2LqBfU',
    'https://evil.example/youtu.be/dO8EW2LqBfU', 'ftp://youtu.be/dO8EW2LqBfU', 'javascript:alert(1)',
    'https://user:senha@www.youtube.com/watch?v=dO8EW2LqBfU', 'https://www.youtube.com/watch?v=dO8EW2Lq%3CU',
  ])('recusa %s', (url) => { expect(idDoVideoDoYoutube(url)).toBeNull(); });
});

test('URL de assistir e do player embutido', () => {
  expect(urlDeAssistirNoYoutube('dO8EW2LqBfU')).toBe('https://www.youtube.com/watch?v=dO8EW2LqBfU');
  expect(urlDeAssistirNoYoutube('dO8EW2LqBfU', 61.8)).toBe('https://www.youtube.com/watch?v=dO8EW2LqBfU&t=61s');
  const embed = new URL(urlDoPlayerDoYoutube('dO8EW2LqBfU', { origem: 'http://127.0.0.1:8730/ler/x', inicio_s: 90.4 }));
  expect(embed.origin + embed.pathname).toBe('https://www.youtube.com/embed/dO8EW2LqBfU');
  expect(Object.fromEntries(embed.searchParams)).toEqual({ enablejsapi: '1', origin: 'http://127.0.0.1:8730', playsinline: '1', rel: '0', start: '90' });
  expect(() => urlDoPlayerDoYoutube('x"><script>', { origem: 'http://a.b' })).toThrow();
});
