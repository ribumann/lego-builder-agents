import './style.css';
import { AGENTS, EXAMPLES, Team, allBricks, createPlan, parseBrief, restoreSnapshot, validateSpec, loadAIMission,
  type AgentId, type Brick, type World } from './engine';
import { Workbench } from './scene';
import { worldExample } from './world-examples';

const icon = (name: string) => {
  const paths: Record<string, string> = {
    play: '<path d="m9 5 11 7-11 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    fast: '<path d="m3 5 9 7-9 7zm10 0 9 7-9 7z"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    cube: '<path d="m12 3 9 5v9l-9 5-9-5V8zm0 10 9-5M12 13 3 8m9 5v9"/>',
    scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M7 12h10"/>',
    step: '<path d="m4 5 11 7-11 7zm15 0v14"/>',
    star: '<path d="m12 3 3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v1"/>',
    leaf: '<path d="M4 20 17 7M5 16C-1 5 12 3 21 3c0 9-2 22-13 16"/>',
    rocket: '<path d="M8 16c-4 0-5 5-5 5s5-1 5-5zm1-1L5 11l4-4c5-5 12-4 12-4s1 7-4 12l-4 4z"/><circle cx="15" cy="9" r="2"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cube}</svg>`;
};
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing interface element: ${selector}`);
  return result;
};
const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const app = $('#app');
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="BrickLab home"><span class="brand-mark">${icon('cube')}</span>Brick<span>Lab</span><span class="brand-dot"></span></a>
    <span class="tagline">Small bricks. Big teamwork.</span>
    <div class="top-actions"><span class="local-status"><i></i> Five agents. Your ideas.</span><button id="guide" class="button subtle">${icon('help')} How to play</button></div>
  </header>
  <main>
    <div class="world-bar">
      <div class="world-tabs" role="group" aria-label="Choose your building world">
        <button id="jurassic" class="world-tab active" aria-pressed="true">${icon('leaf')} Jurassic valley</button>
        <button id="space" class="world-tab" aria-pressed="false">${icon('rocket')} Space dock</button>
      </div>
      <div class="mission-mode"><span class="mode-dot"></span><span id="mode-label">Local rule-based agents</span><button id="settings" class="text-button">Change mode</button></div>
    </div>
    <div class="workshop">
      <aside class="mission-panel">
        <div class="mission-heading"><span class="mission-icon">${icon('leaf')}</span><span id="mission-number">Mission: Jurassic</span></div>
        <h1 id="mission-title">A little prehistoric.<br> A lot of possibility.</h1>
        <p id="mission-intro">You dream it. Five agents team up to build it, one brick at a time.</p>
        <div class="mission-steps">
          <div class="mission-step current" data-phase="brief"><b>1</b><div><strong>Imagine it</strong><span>Give your team a clear brief.</span></div></div>
          <div class="mission-step" data-phase="plan"><b>2</b><div><strong>Meet the plan</strong><span>See who does what, and why.</span></div></div>
          <div class="mission-step" data-phase="build"><b>3</b><div><strong>Watch them build</strong><span>Follow the teamwork live.</span></div></div>
          <div class="mission-step" data-phase="learn"><b>4</b><div><strong>Test & discover</strong><span>Break a brick. Learn to repair.</span></div></div>
        </div>
        <div class="field-note"><span>${icon('star')}</span><p id="field-note">An agent does more than answer. It observes, chooses an action, and checks what happened.</p></div>
        <button id="demo" class="button demo-button">${icon('play')} Run an offline demo</button>
        <div id="save-status" class="save-status">Your workshop saves on this device.</div>
      </aside>
      <section class="stage" aria-label="3D construction workbench">
        <div class="stage-heading"><span class="stage-tag"><i></i><span id="stage-status">Ready for your imagination</span></span><span id="scene-coordinates">JURASSIC / BUILD SITE A</span></div>
        <div id="canvas-host"></div>
        <div id="scene-error" class="scene-error" hidden></div>
        <div class="stage-tools" role="group" aria-label="Workbench view controls">
          <button id="blueprint" class="tool-button" aria-label="Toggle blueprint" aria-pressed="true" title="Blueprint">${icon('scan')}</button>
          <button id="explode" class="tool-button" aria-label="Toggle exploded view" aria-pressed="false" title="Exploded view">${icon('cube')}</button>
          <button id="camera" class="tool-button" aria-label="Reset camera" title="Reset camera">${icon('reset')}</button>
        </div>
        <div class="scene-caption" id="scene-caption"><strong>A big idea starts with a small brief.</strong><span>The translucent bricks are a preview, not an agent-built result.</span></div>
        <div id="brick-info" class="brick-info" hidden></div>
        <div class="stage-footer"><span>Drag to orbit <span class="separator">/</span> Scroll to zoom <span class="separator">/</span> Tap a brick to inspect</span><span class="scale-label">LEGO-style · original geometry</span></div>
      </section>
      <aside class="team-panel">
        <div class="panel-title"><h2>Your build crew</h2><span class="team-count">5 agents</span></div>
        <div class="crew">${(Object.keys(AGENTS) as AgentId[]).map(id => `
          <button class="agent-row" data-agent="${id}" title="Ask ${AGENTS[id].name} about its job">
            <span class="bot-avatar ${id}"><span class="bot-eyes">••</span></span>
            <span class="agent-name"><strong>${AGENTS[id].name}</strong><small>${AGENTS[id].role}</small></span><span class="agent-state" id="${id}-state">Ready</span>
          </button>`).join('')}</div>
        <div class="board-tabs" role="group" aria-label="Team board view">
          <button id="tab-live" class="active" aria-pressed="true">Team talk</button><button id="tab-tasks" aria-pressed="false">Task board <span id="task-count">0</span></button>
        </div>
        <div class="team-content" id="team-content"><div id="event-list" role="log" aria-label="Agent actions and explanations"></div><div id="task-list" hidden></div></div>
        <div class="team-question">
          <form id="question-form"><label for="question">Ask your crew</label><div class="question-input"><input id="question" maxlength="240" placeholder="Why do you need a plan?" autocomplete="off"/><button class="send-question" aria-label="Ask crew">${icon('arrow')}</button></div></form>
          <div id="crew-answer" role="status">Try: “Who does what?” or “Why wait?”</div>
        </div>
      </aside>
    </div>
    <section class="control-deck" aria-label="Build controls">
      <form id="brief-form" class="brief-form">
        <div class="brief-label"><label for="brief">What shall we build?</label><button type="button" id="inspire" class="text-button">Try an idea ${icon('star')}</button></div>
        <div class="brief-input"><textarea id="brief" rows="2" maxlength="1000" aria-describedby="brief-help" placeholder="Describe your dinosaur…"></textarea><button id="plan" class="button primary" type="submit">Make a plan ${icon('arrow')}</button></div>
        <p id="brief-help">Name the object, body color, and a special feature. Clearer instructions help your team.</p>
      </form>
      <div class="transport">
        <div class="build-progress"><strong id="brick-count">0 <span>bricks placed</span></strong><span id="progress-value">0%</span></div>
        <progress id="progress" max="100" value="0" aria-label="Build completion"></progress>
        <div class="playback-controls">
          <button id="run" class="button run-button" disabled>${icon('play')} Start building</button>
          <button id="step" class="tool-button" disabled aria-label="Build one step" title="One step">${icon('step')}</button>
          <button id="speed" class="button speed-button" aria-label="Fast-forward speed, currently 1 times">${icon('fast')}<span>1×</span></button>
        </div>
        <span id="transport-note">Make a plan, then give your crew the go-ahead.</span>
      </div>
    </section>
    <div id="notice" class="notice" role="alert" hidden></div>
    <section class="discovery" aria-label="Learn and experiment">
      <div class="discovery-intro"><h2>Don’t just watch.<br>Be the scientist.</h2><p>Great agents check their work.<br>Great directors ask questions.</p></div>
      <div class="inspection"><div class="section-title"><h3>Build inspection</h3><span id="inspection-result">Waiting for a build</span></div><div id="checks"></div></div>
      <div class="experiments"><h3>Try a little what-if</h3><p>Remove a finishing brick. Watch the team compare reality with its plan and repair the gap.</p><div class="experiment-actions"><button id="damage" class="button outline" disabled>Hide one brick</button><button id="repair" class="button outline" disabled>Ask team to repair</button></div><div class="replay-row"><label for="replay">Build replay</label><input id="replay" type="range" min="0" max="1" value="1" disabled aria-label="Replay placed bricks"/><button id="live-view" class="text-button">Live</button></div><span id="replay-label">Finish a build to explore its timeline.</span></div>
    </section>
    <section class="learning-strip"><span class="learning-symbol">${icon('help')}</span><div><h3 id="quiz-title">Quick thought: what makes this a team of agents?</h3><div id="quiz-options"><button data-answer="wrong">They all use the same color</button><button data-answer="right">They choose actions and share progress</button><button data-answer="wrong">They build without any plan</button></div><p id="quiz-feedback" role="status">Make a prediction, then watch the crew.</p></div><div class="file-actions"><button id="herd-example" class="button outline">Load local Jurassic herd</button><button id="fleet-example" class="button outline">Load local space fleet</button><button id="export" class="button outline" disabled>${icon('download')} Save build file</button><button id="import" class="button outline">Load build / AI mission</button><input id="import-file" type="file" accept=".json,application/json" hidden aria-label="Choose a build or AI mission JSON file"/></div></section>
    <footer><span>BrickLab <span class="footer-dot">·</span> A hands-on introduction to agentic teamwork.</span><span>Independent educational demo. Not affiliated with the LEGO Group.</span></footer>
  </main>
  <dialog id="info-dialog" aria-labelledby="dialog-title"><div class="dialog-heading"><h2 id="dialog-title">Welcome to the workshop</h2><button id="close-dialog" class="tool-button" aria-label="Close dialog">×</button></div><div id="dialog-body"></div></dialog>
`;

const phoneLayout = window.matchMedia('(max-width: 700px)');
const transport = $('.transport');
const positionTransport = () => {
  if (phoneLayout.matches) $('.stage').after(transport);
  else $('.control-deck').append(transport);
};
positionTransport();
phoneLayout.addEventListener('change', positionTransport);

let world: World = 'jurassic';
let team: Team | null = null;
let activeBrief = '';
let running = false;
let speed = 1;
let lastEventCount = -1;
let eventRevision = 0;
let showGhost = true;
let exploded = false;
let mode: 'local' | 'copilot' | 'local-ai' = 'copilot';
let apiKey = '';
let copilotEnabled = false;
let plannerState = 'unavailable';
let plannerMessage = 'Checking the local planner…';
let localPlanner = { enabled: false, state: 'off', message: 'Local AI is off. Configure Ollama on the BrickLab server host, then restart with BRICKLAB_LOCAL_AI=1 and BRICKLAB_LOCAL_MODEL set.' };
let planning = false;
let replaying = false;
let examples = 0;
let scene: Workbench | undefined;
let storageWarningShown = false;
let quizWon = false;
const brief = $<HTMLTextAreaElement>('#brief');
brief.value = EXAMPLES.jurassic[0];
const notice = (message: string) => { $('#notice').textContent = message; $('#notice').hidden = false; };
const clearNotice = () => { $('#notice').hidden = true; };
const setButton = (id: string, disabled: boolean) => { $<HTMLButtonElement>(id).disabled = disabled; };
const statusNames: Record<string, string> = {
  planned: 'Plan ready. You’re the director.', building: 'Teamwork in progress', paused: 'Paused. Take a closer look.',
  complete: 'Mission complete. Beautiful teamwork!', damaged: 'Inspection found a problem.',
};
try {
  scene = new Workbench($('#canvas-host'), (brick: Brick) => {
    const info = $('#brick-info');
    info.hidden = false;
    info.textContent = `${brick.object ? `${brick.object} · ` : ''}${brick.part} · placed by ${AGENTS[brick.agent].name} · grid (${brick.x}, ${brick.y}, ${brick.z}) · ${brick.width ?? 1} × ${brick.height ?? 1} × ${brick.depth ?? 1} cells`;
    setTimeout(() => { info.hidden = true; }, 5000);
  });
} catch (error) {
  $('#scene-error').hidden = false;
  $('#scene-error').textContent = `3D is unavailable: ${error instanceof Error ? error.message : 'WebGL is not supported'}. You can still build using the task board and text inspection below.`;
}

function save() {
  if (!team) return;
  try {
    localStorage.setItem(`bricklab-${world}`, JSON.stringify(team.snapshot(activeBrief)));
    $('#save-status').textContent = 'Saved on this device · no account needed';
  } catch {
    $('#save-status').textContent = 'Could not save on this device. Download your build instead.';
    if (!storageWarningShown) { notice('Device storage is unavailable or full. Keep this tab open or download the build file.'); storageWarningShown = true; }
  }
}
function preview() {
  try {
    scene?.setBlueprint(allBricks(createPlan(parseBrief(world, EXAMPLES[world][0]).spec)));
    scene?.sync([]);
    scene?.showBlueprint(showGhost);
  } catch (error) { notice(`Could not create preview: ${error instanceof Error ? error.message : String(error)}`); }
}
function render() {
  const total = team ? allBricks(team.plan).length : 0;
  const count = team?.bricks.size ?? 0;
  const percent = total ? Math.round(count / total * 100) : 0;
  $('#brick-count').innerHTML = `${count} <span>/ ${total || '—'} bricks</span>`;
  $('#progress-value').textContent = `${percent}%`;
  $<HTMLProgressElement>('#progress').value = percent;
  $('#stage-status').textContent = planning ? 'BuildBot is planning your custom design…' : team ? statusNames[team.status] : 'Ready for your imagination';
  const status = team?.status;
  const canRun = !!team && !['complete', 'damaged'].includes(team.status) && !planning;
  setButton('#run', !canRun);
  setButton('#step', !canRun || running);
  setButton('#damage', status !== 'complete');
  setButton('#repair', status !== 'damaged');
  setButton('#export', !count);
  setButton('#plan', planning);
  setButton('#demo', planning);
  setButton('#herd-example', planning);
  setButton('#fleet-example', planning);
  setButton('#jurassic', planning);
  setButton('#space', planning);
  $('#run').innerHTML = running ? `${icon('pause')} Pause build` : `${icon('play')} ${team && count ? 'Continue build' : 'Start building'}`;
  $('#task-count').textContent = team ? `${team.completedTasks}/${team.plan.tasks.length}` : '0';
  $('#transport-note').textContent = planning ? 'One bounded planning request. No template fallback; the crew executes locally.'
    : running ? `${speed}× playback · Both builders observe the shared board each turn.`
    : status === 'complete' ? 'Try the repair challenge below, or change your brief.'
    : status === 'damaged' ? 'The inspector noticed a problem. Ask the team to repair it.'
    : team ? 'Review the task board, then start building.' : 'Make a plan, then give your crew the go-ahead.';
  $('#scene-caption').hidden = !!team && count > 0;
  if (team && !count) {
    const name = team.plan.spec.design?.name ?? `${team.plan.spec.color} ${team.plan.spec.model}`;
    $('#scene-caption').innerHTML = `<strong>${esc(name)}. Your idea, their teamwork.</strong><span>Blueprint ready · ${total} bricks · ${team.plan.tasks.length} delegated tasks</span>`;
  }
  const phase = !team ? 'brief' : status === 'planned' ? 'plan' : ['complete','damaged'].includes(status!) ? 'learn' : 'build';
  document.querySelectorAll<HTMLElement>('.mission-step').forEach(el => el.classList.toggle('current', el.dataset.phase === phase));
  for (const id of Object.keys(AGENTS) as AgentId[]) {
    const text = id === 'build' ? planning ? 'Thinking' : running ? 'Checking' : team ? 'Watching' : 'Ready'
      : id === 'plan' ? team ? 'Reviewed' : 'Ready'
      : id === 'check' ? status === 'complete' ? 'Passed' : status === 'damaged' ? 'Problem found' : team ? 'Waiting' : 'Ready'
      : running && team?.plan.tasks.some(t => t.agent === id && !team!.taskDone(t) && t.depends.every(d => team!.taskDone(team!.plan.tasks.find(p => p.id === d)!))) ? 'Building'
      : status === 'complete' ? 'Done' : team ? 'Waiting' : 'Ready';
    $(`#${id}-state`).textContent = text;
    $(`#${id}-state`).classList.toggle('working', text === 'Building' || text === 'Thinking');
  }
  const revision = (team?.events.length ?? 0) + eventRevision;
  if (revision !== lastEventCount) {
    lastEventCount = revision;
    const events = team?.events.slice().reverse() ?? [
      { agent: 'build' as const, kind: 'plan', message: 'Hello, director! Describe any brick design. I’ll split it into jobs for our crew.', tick: 0 },
      { agent: 'plan' as const, kind: 'observe', message: 'I review the task dependencies and check whether the planned bricks connect.', tick: 0 },
      { agent: 'frame' as const, kind: 'observe', message: 'I build the body and structure. I’ll tell DetailBot when a supporting part is ready.', tick: 0 },
      { agent: 'detail' as const, kind: 'observe', message: 'Eyes, plates, cockpits, engines… I make the finishing touches. We share one task board.', tick: 0 },
      { agent: 'check' as const, kind: 'observe', message: 'I inspect the finished model and check for missing bricks.', tick: 0 },
    ];
    $('#event-list').innerHTML = events.map(e => `<article class="event ${e.agent}"><div><strong>${AGENTS[e.agent].name}</strong><span>${esc(e.kind)} · turn ${e.tick}</span></div><p>${esc(e.message)}</p></article>`).join('');
  }
  $('#task-list').innerHTML = team ? team.plan.tasks.map(task => {
    const done = team!.taskDone(task);
    const placed = task.bricks.filter(b => team!.bricks.has(b.id)).length;
    const waiting = task.depends.some(id => !team!.taskDone(team!.plan.tasks.find(t => t.id === id)!));
    return `<article class="task ${done ? 'done' : ''}"><span class="task-dot ${task.agent}">${done ? '✓' : placed ? '↗' : '·'}</span><div><strong>${esc(task.label)}</strong><small>${AGENTS[task.agent].name} · ${placed}/${task.bricks.length}</small><small>${waiting ? `Waits for: ${task.depends.map(id => esc(team!.plan.tasks.find(t => t.id === id)?.label ?? id)).join(', ')}` : done ? 'Shared board updated' : 'Dependencies ready'}</small></div></article>`;
  }).join('') : '<p class="empty-note">Make a plan to see the delegated jobs and their dependencies here.</p>';
  const checks = team?.checks ?? [];
  $('#checks').innerHTML = checks.length ? checks.map(c => `<div class="check ${c.pass ? 'passed' : ''}"><span>${c.pass ? '✓' : '·'}</span><div><strong>${esc(c.label)}</strong><small>${esc(c.detail)}</small></div></div>`).join('')
    : '<p class="empty-note">CheckBot will compare the finished build with the plan, connectivity, and brick budget. Templates also check symmetry.</p>';
  $('#inspection-result').textContent = team ? `${checks.filter(c => c.pass).length}/${checks.length} checks` : 'Waiting for a build';
  const replay = $<HTMLInputElement>('#replay');
  replay.disabled = status !== 'complete' && status !== 'damaged';
  replay.max = String(Math.max(1, count));
  if (!replaying) replay.value = String(count || 1);
  if (status === 'complete' && !replaying) $('#replay-label').textContent = 'Scrub through the actual order bricks were placed.';
  if (!replaying) scene?.sync(team ? [...team.bricks.values()] : []);
}

async function makePlan(demo = false) {
  if (planning) return;
  running = false;
  if (team?.status === 'building') team.status = 'paused';
  replaying = false;
  clearNotice();
  try {
    if (!brief.value.trim() || brief.value.length > 1000) throw new Error('Give the team a brief of 1–1,000 characters.');
    let spec;
    let source: 'local' | 'copilot' | 'local-ai' = 'local';
    const assumptions: string[] = [];
    if (mode !== 'local') {
      const localAI = mode === 'local-ai';
      if (localAI ? !localPlanner.enabled || localPlanner.state !== 'configured' : !copilotEnabled && plannerState !== 'needs-auth')
        throw new Error(localAI ? localPlanner.message : plannerMessage);
      if (!apiKey) throw new Error('Server status is not ready. Retry status in Change mode before planning.');
      planning = true; render();
      const response = await fetch(localAI ? '/api/local-plan' : '/api/plan', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bricklab-Key': apiKey },
        body: JSON.stringify({ world, brief: brief.value }) });
      const data = await response.json();
      if (!response.ok) {
        await refreshStatus();
        throw new Error(data.error || 'Copilot planning request failed.');
      }
      spec = validateSpec(data.spec, world);
      if (spec.model !== 'custom') throw new Error('The planner returned a template instead of custom geometry. No new build, retry or template fallback was made.');
      source = localAI ? 'local-ai' : 'copilot';
      assumptions.push(`${localAI ? 'Local AI' : 'Copilot'} proposed a custom brick design. The five local agents execute and inspect it; they are not separate language models.`);
    } else {
      const parsed = parseBrief(world, brief.value);
      spec = parsed.spec;
      assumptions.push(...parsed.assumptions);
      assumptions.push('Offline template mode reads a small vocabulary, not arbitrary language. Species, body color, long tail, wide wings, and budget are supported.');
    }
    const plan = createPlan(spec, assumptions, source);
    team = new Team(plan);
    activeBrief = brief.value;
    eventRevision += 1000;
    scene?.setBlueprint(allBricks(plan));
    scene?.sync([]);
    if (demo) {
      speed = 4;
      updateSpeed();
      running = true;
      team.status = 'building';
      team.log('build', 'observe', 'Guided demo: your example brief is approved. Watch how DetailBot starts when a supporting part is ready.');
      $('#field-note').textContent = 'Watch DetailBot start the feet while FrameBot builds the body. Shared progress allows independent work.';
    }
    save();
  } catch (error) {
    notice(error instanceof Error ? error.message : 'Planning failed. No new build was started.');
  } finally { planning = false; render(); }
}
function updateSpeed() {
  $('#speed').innerHTML = `${icon('fast')}<span>${speed}×</span>`;
  $('#speed').setAttribute('aria-label', `Fast-forward speed, currently ${speed} times`);
}
function restore() {
  try {
    const raw = localStorage.getItem(`bricklab-${world}`);
    if (raw) {
      const restored = restoreSnapshot(JSON.parse(raw));
      team = restored.team;
      brief.value = restored.prompt;
      activeBrief = restored.prompt;
      scene?.setBlueprint(allBricks(team.plan));
      $('#save-status').textContent = 'Previous build restored from this device.';
    } else {
      team = null;
      activeBrief = '';
      brief.value = EXAMPLES[world][0];
      preview();
    }
  } catch (error) {
    team = null;
    brief.value = EXAMPLES[world][0];
    preview();
    notice(`Could not restore the saved build: ${error instanceof Error ? error.message : 'invalid data'}. Your old save has not been overwritten.`);
  }
  eventRevision += 1000;
}
function switchWorld(next: World) {
  if (planning || next === world) return;
  save(); running = false; replaying = false; world = next;
  $('#app').classList.toggle('space-world', world === 'space');
  for (const id of ['jurassic', 'space']) {
    $(`#${id}`).classList.toggle('active', id === world);
    $(`#${id}`).setAttribute('aria-pressed', String(id === world));
  }
  const space = world === 'space';
  $('#mission-title').innerHTML = space ? 'One small brick.<br> One giant adventure.' : 'A little prehistoric.<br> A lot of possibility.';
  $('#mission-intro').textContent = space ? 'Destination: your imagination. Give the crew a spaceship mission.' : 'You dream it. Five agents team up to build it, one brick at a time.';
  $('#mission-number').textContent = `Mission: ${space ? 'Space' : 'Jurassic'}`;
  $('.mission-icon').innerHTML = icon(space ? 'rocket' : 'leaf');
  $('#scene-coordinates').textContent = space ? 'ORBITAL / BUILD SITE B' : 'JURASSIC / BUILD SITE A';
  $('#scene-caption').innerHTML = '<strong>A big idea starts with a small brief.</strong><span>The translucent bricks are a preview, not an agent-built result.</span>';
  updateMode();
  clearNotice();
  scene?.setWorld(world);
  restore(); render();
}

$('#brief-form').addEventListener('submit', event => { event.preventDefault(); void makePlan(); });
$('#jurassic').addEventListener('click', () => switchWorld('jurassic'));
$('#space').addEventListener('click', () => switchWorld('space'));
$('#inspire').addEventListener('click', () => { brief.value = EXAMPLES[world][++examples % EXAMPLES[world].length]; brief.focus(); });
$('#demo').addEventListener('click', () => { mode = 'local'; updateMode(); brief.value = EXAMPLES[world][0]; void makePlan(true); });
$('#run').addEventListener('click', () => {
  if (!team) return;
  replaying = false;
  running = !running;
  team.status = running ? 'building' : 'paused';
  render(); save();
});
$('#step').addEventListener('click', () => { if (team) { replaying = false; team.step(1); if (team.status !== 'complete' && team.status !== 'damaged') team.status = 'paused'; render(); save(); } });
$('#speed').addEventListener('click', () => { speed = speed === 1 ? 4 : speed === 4 ? 16 : 1; updateSpeed(); render(); });
$('#blueprint').addEventListener('click', () => { showGhost = !showGhost; scene?.showBlueprint(showGhost); $('#blueprint').setAttribute('aria-pressed', String(showGhost)); });
$('#explode').addEventListener('click', () => { exploded = !exploded; scene?.explode(exploded); $('#explode').setAttribute('aria-pressed', String(exploded)); });
$('#camera').addEventListener('click', () => scene?.resetCamera());
$('#damage').addEventListener('click', () => { replaying = false; team?.damage(); eventRevision++; render(); save(); });
$('#repair').addEventListener('click', () => { replaying = false; team?.repair(); running = team?.status === 'building'; eventRevision++; render(); save(); });
$('#replay').addEventListener('input', () => {
  if (!team) return;
  replaying = true;
  const count = Number($<HTMLInputElement>('#replay').value);
  scene?.sync([...team.bricks.values()].slice(0, count));
  scene?.showBlueprint(false);
  $('#replay-label').textContent = `Replay: ${count} / ${team.bricks.size} placed bricks. Your saved build is unchanged.`;
});
$('#live-view').addEventListener('click', () => { replaying = false; scene?.showBlueprint(showGhost); render(); });
for (const tab of ['live', 'tasks']) $(`#tab-${tab}`).addEventListener('click', () => {
  $('#event-list').hidden = tab !== 'live';
  $('#task-list').hidden = tab !== 'tasks';
  for (const id of ['live', 'tasks']) { $(`#tab-${id}`).classList.toggle('active', tab === id); $(`#tab-${id}`).setAttribute('aria-pressed', String(tab === id)); }
});
function answer(question: string, agent?: AgentId) {
  const q = question.toLowerCase();
  const id = agent ?? (/checkbot|inspect|quality/.test(q) ? 'check' : /planbot|dependencies/.test(q) ? 'plan' : /detail|wait|finish/.test(q) ? 'detail' : /frame|structure/.test(q) ? 'frame' : 'build');
  const responses: Record<AgentId, string> = {
    build: 'I turn your goal into tasks and coordinate the crew. A language model is optional here: our local agents follow explicit rules.',
    plan: 'I review the task graph for missing dependencies and cycles before the build starts, and warn if the planned bricks are disconnected.',
    frame: 'I check the shared board, choose a ready structure task, and place bricks. I tell DetailBot when each supporting part is ready. I do not need a new instruction for every brick.',
    detail: 'I can work alongside FrameBot. Feet wait for legs; eyes wait for a head. Those dependencies stop me from placing details before their supporting part exists.',
    check: 'I inspect the completed build against its plan, connectivity and budget. If bricks are missing, I identify them so their owners can repair the build.',
  };
  let response = responses[id];
  if (/cost|money|price/.test(q)) response = 'Offline templates make no model calls. Local AI uses compute on the server host. Copilot starts one CLI planning invocation per click; the CLI may retry internally, so subscription usage can differ. We cannot measure a dollar price here.';
  else if (/repair|missing|broken/.test(q)) response = 'We compare the actual brick grid with the planned grid. The specialist who owns a missing brick reopens that task and replaces it. That is an observe–act–check loop.';
  else if (/prompt|brief|change|color/.test(q)) response = 'Try a body color, species or ship type, and one feature. For example: “purple brachiosaurus” or “blue explorer with wide wings.” Then make a new plan. Unspecified choices are shown as assumptions.';
  else if (/why.*plan|plan.*why/.test(q)) response = 'A shared plan tells each specialist what to do and which parts must exist first. Without dependencies, an agent could add eyes before there is a head!';
  else if (/\b(real|ai|model|llm)\b/.test(q)) response = 'In local mode all five agents follow rules, not language models. Copilot can interpret the brief; all five agents still work locally. Our messages explain program decisions, not hidden model thoughts.';
  else if (!agent && !/who|what|job|help|team|wait|frame|detail|build|structure|planbot|checkbot|inspect|quality|dependencies/.test(q)) response = 'I’m a local teaching guide, not an open-ended chat model. Ask about our jobs, dependencies, the brief, repair, AI mode, or cost.';
  $('#crew-answer').textContent = `${AGENTS[id].name}: ${response}`;
}
$('#question-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $<HTMLInputElement>('#question');
  if (input.value.trim()) { answer(input.value); input.value = ''; }
});
document.querySelectorAll<HTMLButtonElement>('[data-agent]').forEach(button => button.addEventListener('click', () => answer('', button.dataset.agent as AgentId)));
document.querySelectorAll<HTMLButtonElement>('[data-answer]').forEach(button => button.addEventListener('click', () => {
  const right = button.dataset.answer === 'right';
  quizWon ||= right;
  $('#quiz-feedback').textContent = right ? 'Exactly! A goal, a shared plan, independent actions, and feedback. You earned the Team Scientist stamp.' : 'Not quite. Look for each agent choosing a ready task and sharing what changed. Try again.';
  $('#quiz-title').textContent = quizWon ? 'Team Scientist stamp earned!' : 'Quick thought: what makes this a team of agents?';
}));
$('#export').addEventListener('click', () => {
  if (!team) return;
  const payload = { ...team.snapshot(activeBrief), explanation: 'Original stylized brick grid. Not official LEGO instructions or a physical stability guarantee.', source: team.plan.source };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  link.download = `bricklab-${team.plan.spec.model}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
});
function loadWorldExample(exampleWorld: World) {
  if (planning) return;
  try {
    const plan = createPlan(worldExample(exampleWorld), ['This themed world is a deterministic local example, not a model result.'], 'local');
    const example = new Team(plan);
    mode = 'local'; updateMode();
    if (world !== plan.spec.world) switchWorld(plan.spec.world);
    running = false; replaying = false;
    team = example;
    activeBrief = `Original local ${exampleWorld === 'jurassic' ? 'Jurassic herd' : 'space fleet'} example`;
    brief.value = activeBrief;
    scene?.setBlueprint(allBricks(plan));
    scene?.showBlueprint(showGhost);
    eventRevision += 1000;
    notice('Local world example loaded: original deterministic geometry, not a live model result. Start the crew to build it.');
    save(); render();
  } catch (error) {
    notice(`Could not load the world example: ${error instanceof Error ? error.message : 'invalid design'}.`);
  }
}
$('#herd-example').addEventListener('click', () => loadWorldExample('jurassic'));
$('#fleet-example').addEventListener('click', () => loadWorldExample('space'));
$('#import').addEventListener('click', () => $<HTMLInputElement>('#import-file').click());
$('#import-file').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('#import-file');
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (planning) throw new Error('Wait for the current model request to finish before loading a file.');
    if (file.size > 4_000_000) throw new Error('Build files must be smaller than 4 MB.');
    const data: unknown = JSON.parse(await file.text());
    const isMission = !!data && typeof data === 'object' && 'kind' in data && data.kind === 'bricklab-ai-mission';
    const loaded = isMission ? loadAIMission(data) : restoreSnapshot(data);
    if (loaded.team.plan.spec.world !== world) switchWorld(loaded.team.plan.spec.world);
    running = false;
    replaying = false;
    team = loaded.team;
    activeBrief = loaded.prompt;
    brief.value = loaded.prompt;
    scene?.setBlueprint(allBricks(team.plan));
    scene?.showBlueprint(showGhost);
    eventRevision += 1000;
    clearNotice();
    if (isMission) notice('AI mission loaded. Three imported model decisions set the plan and task priorities; PlanBot and CheckBot work locally. File attribution is not independently verified. Press Start building to watch.');
    save(); render();
  } catch (error) {
    notice(`Could not load this file: ${error instanceof Error ? error.message : 'invalid JSON'}. The current build is unchanged.`);
  } finally { input.value = ''; }
});
function dialog(title: string, body: string) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = body;
  $<HTMLDialogElement>('#info-dialog').showModal();
}
$('#close-dialog').addEventListener('click', () => $<HTMLDialogElement>('#info-dialog').close());
$('#guide').addEventListener('click', () => dialog('You’re the director. They’re the crew.', `
  <p>This workshop makes agent teamwork visible. Choose <strong>Jurassic valley</strong> or <strong>Space dock</strong>, then describe your build.</p>
  <ol><li><strong>Imagine:</strong> name the species or ship type, body color, and a feature.</li><li><strong>Plan:</strong> BuildBot delegates jobs. Open the task board to inspect dependencies.</li><li><strong>Build:</strong> approve the plan, pause, step one turn, or fast-forward at 4× and 16×.</li><li><strong>Experiment:</strong> hide a brick, ask for a repair, or replay the placement timeline.</li></ol>
  <p>Cloud planning is the default: describe any static brick design, not just these themes. Pressing <strong>Send brief to Copilot</strong> sends the brief to GitHub and may consume quota. No model request happens on load.</p>
  <p>Explicit offline template mode supports <strong>stegosaurus and brachiosaurus</strong>, both from the Jurassic, and explorer/cargo ships. Body colors: green, orange, blue, purple, red, white. Features: long tail, wide wings. You can add “budget 500 bricks”. Other requests may not change these templates. Guided demos and local examples use no model calls.</p>
  <p>Copilot and optional Local AI must return custom geometry; template responses fail visibly. Five local agents coordinate, verify, build and inspect the result. Messages explain decisions, not private model reasoning.</p>
  <p>Try the local herd and fleet examples for separate named objects. Normal designs target up to 1,000 pieces and 32,768 occupied cells. Advanced designs allow up to 8,192 pieces and 262,144 cells; large builds may be slow. Decorative studs are sampled above 8,192 per model or blueprint; all brick bodies remain present and selectable.</p>
  <p>Models are stylized original geometry. Connected bricks do not imply real-world clutch, stability, or flight. Saves stay in this browser.</p>`));
$('#settings').addEventListener('click', () => {
  dialog('Choose how the team plans', `
    <p><strong>GitHub Copilot cloud planner (default)</strong> — one CLI planning invocation per explicit submission proposes custom geometry for your brief, within workspace and count limits. All five agents execute locally, not as separate LLMs.</p>
    <p>Your brief is sent through the authenticated Copilot CLI to GitHub's model service. No agent tools are allowed. The app does not automatically retry or fall back to a template on failure, but the CLI may retry internally and subscription usage can differ. The app does not know the model’s dollar cost. Default limit: 12 CLI invocations per UTC day per server process; restarting resets this counter. This is not a monetary budget or a production billing control.</p>
    <p id="planner-status" role="status">${esc(plannerMessage)}</p>
    <p>Install the Copilot CLI, run <code>copilot login</code>, and start the server with <code>BRICKLAB_COPILOT=1 npm run dev</code>. Pressing <strong>Send brief to Copilot</strong> consents to sending that brief. Selecting a mode or loading the page sends no brief; readiness does not verify login, subscription, or live access. Do not enter personal information.</p>
    <button id="refresh-status" class="button outline">Retry status</button>
    <button id="choose-copilot" class="button primary">Use Copilot planning</button>
    <hr><p><strong>Local AI (Ollama)</strong> — optional original custom planning on the <strong>BrickLab server host</strong>, not automatically on this browser's device. In a Codespace it runs on that remote host. Configure Ollama with <code>OLLAMA_NO_CLOUD=1</code> and a downloaded local model first. Loopback alone does not prove offline operation; remote model metadata is rejected, but the configured service must be trusted.</p>
    <p id="local-planner-status" role="status">${esc(localPlanner.message)}</p>
    <p>Start BrickLab with <code>BRICKLAB_LOCAL_AI=1 BRICKLAB_LOCAL_MODEL=YOUR_MODEL</code>. No automatic installs, model downloads, cloud fallback or template fallback. Initial downloads need network access; planning needs device-dependent memory and compute.</p>
    <button id="choose-local-ai" class="button outline">Use Local AI</button>
    <hr><p><strong>Offline templates</strong> — explicitly choose deterministic stegosaurus, brachiosaurus, explorer and cargo presets. This is not open-ended AI. Runs offline after loading; no model calls. Host charges may still apply.</p>
    <button id="choose-local" class="button outline">Use offline templates</button>
    <hr><p><strong>Three model decisions via GitHub Actions</strong> — the included <code>ai-mission.yml</code> workflow calls one coordinator model, then two builder models concurrently. Each chooses a real task priority. PlanBot and CheckBot remain local rule-based agents, making five crew members, not five model calls. Download its <code>ai-mission.json</code> artifact and use <strong>Load build / AI mission</strong> below to watch the resulting team execute.</p>
    <p>This workflow needs repository access and GitHub Models availability. It has not been live-verified in this environment. It uses three bounded requests, no additional model keys, and no model tools. Do not enter personal information in workflow inputs.</p>
    <p>Mode changes apply to the next plan. Existing builds are not sent anywhere.</p>`);
  $('#choose-local').addEventListener('click', () => { mode = 'local'; clearNotice(); updateMode(); $<HTMLDialogElement>('#info-dialog').close(); });
  $('#choose-copilot').addEventListener('click', () => { mode = 'copilot'; clearNotice(); updateMode(); $<HTMLDialogElement>('#info-dialog').close(); if (!copilotEnabled) notice(plannerMessage); });
  $('#choose-local-ai').addEventListener('click', () => { mode = 'local-ai'; clearNotice(); updateMode(); $<HTMLDialogElement>('#info-dialog').close(); if (localPlanner.state !== 'configured') notice(localPlanner.message); });
  $('#refresh-status').addEventListener('click', () => { void refreshStatus(true); });
});

setInterval(() => {
  if (!running || !team || planning) return;
  replaying = false;
  team.step(speed);
  if (team.status === 'complete' || team.status === 'damaged') running = false;
  render();
  save();
}, 180);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && team) { running = false; team.status = 'paused'; render(); save(); }
});
window.addEventListener('beforeunload', save);
restore();
render();
function updateMode() {
  $('#mode-label').textContent = mode === 'local' ? 'Offline templates · rule-based agents' : mode === 'local-ai' ? 'Local AI · server-host model' : 'Copilot cloud planning · custom designs';
  $('#brief-help').textContent = mode === 'local'
    ? 'Offline template mode builds dinosaur and spaceship templates only; other ideas may be mapped to a template.'
    : mode === 'local-ai'
      ? 'Plan with Local AI sends this brief to the configured Ollama on the BrickLab server host, not automatically your device. Requires a trusted local-only service; no cloud fallback.'
      : 'Send brief to Copilot sends your instructions to GitHub and may consume quota. No request until you press it. Describe any static brick design; do not enter personal information.';
  $('#plan').innerHTML = `${mode === 'local' ? 'Make a plan' : mode === 'local-ai' ? 'Plan with Local AI' : 'Send brief to Copilot'} ${icon('arrow')}`;
  brief.placeholder = mode === 'local' ? 'Describe a dinosaur or spaceship template…' : 'Describe your brick design…';
}
async function refreshStatus(inDialog = false) {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error(`Server status returned ${response.status}`);
    const data = await response.json();
    apiKey = typeof data.sessionKey === 'string' ? data.sessionKey : '';
    copilotEnabled = data.copilot === true;
    plannerState = typeof data.planner?.state === 'string' ? data.planner.state : 'unavailable';
    plannerMessage = typeof data.planner?.message === 'string' ? data.planner.message : 'Planner status unavailable.';
    if (data.localPlanner && typeof data.localPlanner.message === 'string')
      localPlanner = { enabled: data.localPlanner.enabled === true, state: String(data.localPlanner.state), message: data.localPlanner.message };
    if (!inDialog && mode === 'copilot' && !copilotEnabled) notice(plannerMessage);
  } catch (error) {
    copilotEnabled = false;
    plannerState = 'unavailable';
    plannerMessage = `Local server status unavailable: ${error instanceof Error ? error.message : 'unknown error'}. Rule-based building still works.`;
    if (!inDialog && mode !== 'local') notice(plannerMessage);
  }
  if (inDialog) {
    const status = document.querySelector<HTMLElement>('#planner-status');
    if (status) status.textContent = plannerMessage;
    const localStatus = document.querySelector<HTMLElement>('#local-planner-status');
    if (localStatus) localStatus.textContent = localPlanner.message;
  }
}
updateMode();
void refreshStatus();
