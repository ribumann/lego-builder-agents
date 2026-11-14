import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elapsedText, languages, planningDescription, setLanguage, translate, translateActivity, translateCheckDetail } from '../src/i18n';

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
  assert.match(translateActivity('I accepted the "body" handoff (5 bricks).'), /body/);
  assert.match(translateActivity('I accepted the "body" handoff (5 bricks).', true), /corps/);
  assert.match(translateActivity('I received 2 missing planned bricks for body, eyes. Reclaiming my original task.', true), /corps, yeux/);
  assert.equal(translateActivity('AI mission decision: Lighthouse 🚀'), 'AI mission decision: Lighthouse 🚀');
  const details = translateCheckDetail('Lighthouse 🚀: 5/5 face-connected; Hill: 2/2 face-connected. Not a physical stability simulation.', ['Lighthouse 🚀', 'Hill']);
  assert.match(details, /Lighthouse 🚀: 5\/5/);
  assert.match(details, /connectées par leurs faces/);
  const name = 'Hill 3/3 face-connected; Lighthouse 🚀';
  assert.ok(translateCheckDetail(`${name}: 5/5 face-connected. Not a physical stability simulation.`, [name]).startsWith(name));
  setLanguage('en');
});

test('damage, repair and inspection activity is localized in every non-English language', () => {
  const messages = [
    'What-if: I removed 4 of 12 placed bricks (about one-third). CheckBot, compare the actual build with the plan; I have not disclosed which identities are missing.',
    'I compared placed identities with the plan and found 4 missing bricks. BuildBot, route each missing identity to its owning builder.',
    'I identified 4 missing bricks by planned identity; the owning builder can replace them. BuildBot, coordinate the repair.',
    'CheckBot found 4 missing identities. I am returning them to their original builder tasks; PlanBot will recheck dependencies.',
    '8/12 bricks face-connected. Connectivity check, not a physical clutch or stability simulation.',
    'Added to the scene at grid offset (-10, 4). Existing bricks remain in place.',
    'Could not load this file: external 🚀. The current build is unchanged.',
  ];
  for (const language of languages.slice(1)) {
    setLanguage(language);
    for (const message of messages) assert.notEqual(translateActivity(message), message, `${language}: ${message}`);
    assert.match(translateActivity(messages.at(-1)!), /external 🚀/);
  }
  setLanguage('en');
});

test('known Local AI status translates while preserving unknown provider text', () => {
  const status = 'Local AI is off. Set BRICKLAB_LOCAL_AI=1 and BRICKLAB_LOCAL_MODEL to opt in. Service availability and authentication are unverified. Start the trusted host Ollama service with OLLAMA_NO_CLOUD=1. Model metadata checks cannot prove the service is offline or not proxying.';
  for (const language of languages.slice(1)) {
    setLanguage(language);
    assert.notEqual(translate(status), status);
    assert.match(translate(status), /OLLAMA_NO_CLOUD=1/);
    assert.equal(translate('Provider says 🚀'), 'Provider says 🚀');
  }
  setLanguage('en');
});
