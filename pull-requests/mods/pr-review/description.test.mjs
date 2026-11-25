import test from 'node:test';
import assert from 'node:assert/strict';
import { labelColors } from './description.js';

test('label pills retain GitHub colors with contrasting text', () => {
  assert.deepEqual(labelColors('d73a4a'), {background:'#d73a4a',border:'#d73a4a',foreground:'#000000'});
  assert.equal(labelColors('ffffff').foreground, '#000000');
  assert.equal(labelColors('000000').foreground, '#ffffff');
  assert.equal(labelColors('FBCA04').background, '#FBCA04');
});

test('missing or malformed colors use a safe neutral label', () => {
  for (const color of [null, undefined, '', '#ff0000', 'red', '00000x', 123456]) {
    assert.deepEqual(labelColors(color), {background:'#ededed',border:'#ededed',foreground:'#000000'});
  }
});
