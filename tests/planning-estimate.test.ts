import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copilotPlanningEstimate } from '../src/planning-estimate';

test('Copilot estimates use rounded observed ranges and bracket untested sizes', () => {
  for (const [brief, range] of [
    ['A 20-brick lighthouse', '20–30 seconds'],
    ['Build 100 bricks', '30–50 seconds'],
    ['Make 500 bricks', '55–175 seconds'],
    ['A 2,000-brick garden', '75–125 seconds'],
    ['Build 8000 bricks', '115–185 seconds'],
    ['A 600-brick dinosaur', '55–175 seconds'],
  ]) assert.match(copilotPlanningEstimate(brief), new RegExp(range));
});

test('ambiguous and out-of-study requests use the broad unknown estimate', () => {
  for (const brief of [
    'A lighthouse', '3 towers with 500 bricks', 'between 20 and 100 bricks',
    'up to 500 bricks', 'not 500 bricks', '-20 bricks', '1.5 bricks',
    '10 bricks', '9000 bricks', 'five hundred bricks', '5000 studs',
  ]) assert.match(copilotPlanningEstimate(brief), /Estimate unknown; sampled Copilot requests took about 20–183 seconds/);
});
