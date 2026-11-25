import test from 'node:test';
import assert from 'node:assert/strict';
import { githubColors } from './colors.js';

test('both GitHub palettes provide the same opaque color tokens', () => {
  const light = githubColors(false), dark = githubColors(true);
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
  for (const palette of [light, dark]) {
    for (const color of Object.values(palette)) assert.match(color, /^#[0-9a-f]{6}$/);
    for (const kind of ['addition', 'deletion', 'hunk']) {
      assert.notEqual(palette[kind], palette.background);
      assert.notEqual(palette[`${kind}Text`], palette[kind]);
    }
    assert.notEqual(palette.additionGutter, palette.addition);
    assert.notEqual(palette.deletionGutter, palette.deletion);
  }
  assert.equal(light.addition, '#e6ffec');
  assert.equal(light.deletion, '#ffebe9');
  assert.equal(dark.background, '#0d1117');
});

test('GitHub-style code stays neutral and primary buttons and draft badges remain readable', () => {
  const luminance = color => {
    const [r,g,b] = color.slice(1).match(/../g).map(hex => {
      const c = parseInt(hex,16)/255;
      return c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4;
    });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  for (const t of [githubColors(false),githubColors(true)]) {
    assert.equal(t.additionText,t.foreground);
    assert.equal(t.deletionText,t.foreground);
    for (const bg of [t.primary,t.primaryHover,t.draft]) {
      assert.ok((luminance(t.primaryText)+0.05)/(luminance(bg)+0.05) >= 4.5);
    }
  }
});
