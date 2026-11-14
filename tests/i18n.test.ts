import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elapsedText, languages, planningDescription, setLanguage, translate, translateActivity, translateCheckDetail, translateTaskName } from '../src/i18n';
import { EXAMPLES, parseBrief, type World } from '../src/engine';
import { worldExample } from '../src/world-examples';

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
  assert.equal(translateTaskName('Structure', false), 'Structure');
  assert.equal(translateTaskName('Structure · support assembly & details', false, ['Structure']), 'Structure · assemblage des supports et détails');
  assert.match(translateActivity('I accepted the "Structure · support assembly & details" handoff (5 bricks).', false, ['Structure']), /Structure · assemblage des supports et détails/);
  assert.match(translateActivity('I received 2 missing planned bricks for Maison, 🚀 · structure, Tour · details. Reclaiming my original task.', false, ['Maison, 🚀', 'Tour']), /Maison, 🚀 · structure, Tour · détails/);
  assert.match(translateActivity('Appended Maison 🚀, Tour at offset -4,10.'), /Maison 🚀, Tour/);
  assert.match(translateActivity('Loaded AI mission attributed to Model 🚀. Imported files are not proof that a model ran.'), /Model 🚀/);
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
    const task = 'Object 🚀 · support assembly & details';
    const translatedTask = translateTaskName(task, false, ['Object 🚀']);
    assert.notEqual(translatedTask, task);
    assert.ok(translatedTask.startsWith('Object 🚀 · '));
    assert.ok(translateActivity(`I accepted the "${task}" handoff (5 bricks).`, false, ['Object 🚀']).includes(translatedTask));
  }
  setLanguage('en');
});

test('known Local AI status translates while preserving unknown provider text', () => {
  const status = 'Local AI is off. Set BRICKLAB_LOCAL_AI=1 and BRICKLAB_LOCAL_MODEL to opt in. Service availability and authentication are unverified. Start the trusted host Ollama service with OLLAMA_NO_CLOUD=1. Model metadata checks cannot prove the service is offline or not proxying.';
  const off = 'Local AI is off. Set BRICKLAB_LOCAL_AI=1 to opt in.';
  const notice = 'Start the trusted host Ollama service with OLLAMA_NO_CLOUD=1. Model metadata checks cannot prove the service is offline or not proxying.';
  const denied = 'Local Ollama denied access. Check authentication on the trusted server host; this adapter does not send credentials.';
  for (const language of languages.slice(1)) {
    setLanguage(language);
    assert.notEqual(translate(status), status);
    assert.match(translate(status), /OLLAMA_NO_CLOUD=1/);
    assert.equal(translate(`${off} ${notice}`), `${translate(off)} ${translate(notice)}`);
    assert.notEqual(translate(denied), denied);
    assert.equal(translate(`${denied} ${notice}`), `${translate(denied)} ${translate(notice)}`);
    const azure = 'Azure OpenAI rate or quota limit reached. No retry was attempted.';
    assert.notEqual(translateActivity(azure), azure);
    assert.equal(translate(`Provider says 🚀 ${notice}`), `Provider says 🚀 ${notice}`);
    assert.equal(translate('Provider says 🚀'), 'Provider says 🚀');
  }
  setLanguage('en');
});

test('fallback status and graphics messages translate in every language', () => {
  const messages = ['Checking the local planner…', 'Azure planning is unavailable on this server.',
    'Planner status unavailable.', 'WebGL is not supported'];
  for (const language of languages.slice(1)) {
    setLanguage(language);
    for (const message of messages) assert.notEqual(translate(message), message, `${language}: ${message}`);
    assert.equal(translate('Unknown graphics error 🚀'), 'Unknown graphics error 🚀');
  }
  setLanguage('en');
});

test('scene and imported mission errors translate inside load and restore notices', () => {
  const details = [
    'Scene append provenance is invalid.',
    'AI mission must have one valid decision per model agent.',
    'Saved build contains unknown or duplicate bricks.',
    'Custom design exceeds its expanded brick budget or 8192-brick limit.',
    'Custom design exceeds its expanded brick budget.',
    'Custom design exceeds the 8192-brick limit.',
    'Custom brick 17 repeat exceeds bounds.',
    'Copilot returned invalid JSON in its final response. No build was started and BrickLab did not retry. Revise the brief or explicitly choose offline templates.',
    'Azure returned a template or omitted custom geometry. An original custom design is required. No retry or template fallback was made.',
  ];
  for (const language of languages.slice(1)) {
    setLanguage(language);
    for (const detail of details) {
      assert.notEqual(translateActivity(detail), detail, `${language}: ${detail}`);
      const notice = `Could not load this file: ${detail}. The current build is unchanged.`;
      assert.ok(translateActivity(notice).includes(translateActivity(detail)));
      const restore = `Could not restore the saved build: ${detail}. Your old save has not been overwritten.`;
      assert.ok(translateActivity(restore).includes(translateActivity(detail)));
      if (detail.includes('17')) assert.match(translateActivity(detail), /17/);
    }
    const external = 'Cannot append a brick assigned to unknown object "Maison 🚀".';
    assert.match(translateActivity(external), /Maison 🚀/);
    assert.match(translateActivity('Could not load this file: external 🚀. The current build is unchanged.'), /external 🚀/);
  }
  setLanguage('en');
});

test('every translated suggested offline brief produces the same specification', () => {
  for (const language of languages) {
    setLanguage(language);
    for (const world of ['jurassic', 'space'] as World[]) {
      for (const example of EXAMPLES[world]) {
        assert.deepEqual(parseBrief(world, translate(example)).spec, parseBrief(world, example).spec,
          `${language}: ${example}`);
      }
    }
  }
  setLanguage('en');
});

test('local world examples translate only their generated names and preserve geometry', () => {
  for (const world of ['jurassic', 'space'] as World[]) {
    const original = worldExample(world);
    for (const language of languages.slice(1)) {
      setLanguage(language);
      const localized = worldExample(world, translate);
      assert.notEqual(localized.design!.name, original.design!.name);
      assert.deepEqual(localized.design!.objects!.map(object => object.bricks),
        original.design!.objects!.map(object => object.bricks));
      assert.ok(localized.design!.objects!.every(object => object.name.length <= 60));
    }
  }
  setLanguage('en');
});
