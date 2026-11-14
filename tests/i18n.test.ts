import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elapsedText, languages, planningDescription, setLanguage, translateActivity } from '../src/i18n';

test('planning estimates stay provider-specific in every supported language', () => {
  for (const language of languages) {
    setLanguage(language);
    const copilot = planningDescription('Copilot', 'A 500-brick lighthouse');
    const azure = planningDescription('Azure Foundry', 'A 500-brick lighthouse');
    assert.match(copilot, /55–175/);
    assert.doesNotMatch(azure, /55–175/);
    assert.match(azure, /Azure Foundry/);
    assert.match(azure, /300/);
    assert.match(elapsedText(100), /100/);
  }
  setLanguage('en');
});

test('known activity templates preserve user-defined task names', () => {
  setLanguage('fr');
  assert.match(translateActivity('I accepted the "Lighthouse 🚀" handoff (5 bricks).'), /Lighthouse 🚀/);
  assert.equal(translateActivity('AI mission decision: Lighthouse 🚀'), 'AI mission decision: Lighthouse 🚀');
  setLanguage('en');
});
