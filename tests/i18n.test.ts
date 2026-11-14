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

test('damage, repair and inspection activity is localized in every non-English language', () => {
  const messages = [
    'What-if: I removed 4 of 12 placed bricks (about one-third). CheckBot, compare the actual build with the plan; I have not disclosed which identities are missing.',
    'I compared placed identities with the plan and found 4 missing bricks. BuildBot, route each missing identity to its owning builder.',
    'I identified 4 missing bricks by planned identity; the owning builder can replace them. BuildBot, coordinate the repair.',
    'CheckBot found 4 missing identities. I am returning them to their original builder tasks; PlanBot will recheck dependencies.',
    '8/12 bricks face-connected. Connectivity check, not a physical clutch or stability simulation.',
  ];
  for (const language of languages.slice(1)) {
    setLanguage(language);
    for (const message of messages) assert.notEqual(translateActivity(message), message, `${language}: ${message}`);
  }
  setLanguage('en');
});
