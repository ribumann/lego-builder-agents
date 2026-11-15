import './style.css';
import { AGENTS, EXAMPLES, Team, allBricks, createPlan, parseBrief, restoreSnapshot, validateSpec, loadAIMission,
  type AgentId, type Brick, type World } from './engine';
import { Workbench } from './scene';
import { worldExample } from './world-examples';
import { appendScene, restoreSceneAppend, snapshotSceneAppend } from './scene-append';
import { agentInsights } from './agent-insights';
import { mountAgentPlayground } from './agent-playground';
import { elapsedText, getLanguage, languages, planningDescription, setLanguage, translate, translateActivity, translateCheckDetail, translateInterface, translateTaskName, type Language } from './i18n';
import { createVoiceInput, type VoiceUpdate } from './voice-input';
import { voiceLabels } from './voice-labels';
import { createPlanningImageInput } from './planning-image-input';
import { resolveSceneSize } from './scene-size.mjs';
import { acquireAzurePlanningToken } from './azure-auth';

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
    cutaway: '<path d="M4 20V4h10l6 8-6 8H4zm5-1V5m4 14V5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
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
    <div class="top-actions"><span class="local-status"><i></i> Five agents. Your ideas.</span><label class="language-picker"><span>Language</span><select id="language" aria-label="Language"><option value="en">English</option><option value="de">Deutsch</option><option value="fr">Français</option><option value="it">Italiano</option><option value="es">Español</option><option value="pt">Português</option></select></label><button id="guide" class="button subtle">${icon('help')} How to play</button></div>
  </header>
  <main>
    <div class="world-bar">
      <div class="world-tabs" role="group" aria-label="Choose your building world">
        <button id="jurassic" class="world-tab active" aria-pressed="true">${icon('leaf')} Jurassic valley</button>
        <button id="space" class="world-tab" aria-pressed="false">${icon('rocket')} Space dock</button>
      </div>
      <div class="mission-mode"><span class="mode-dot"></span><span id="mode-label">Local rule-based agents</span><button id="settings" class="text-button">Change mode</button></div>
    </div>
    <nav class="mission-path" aria-label="Mission steps">
      <a class="mission-step current" data-phase="brief" aria-current="step" href="#brief-form"><b>1</b><span><strong>Imagine it</strong><small>Give your team a clear brief.</small></span></a>
      <a class="mission-step" data-phase="plan" href="#team-panel"><b>2</b><span><strong>Meet the plan</strong><small>See who does what, and why.</small></span></a>
      <a class="mission-step" data-phase="build" href="#stage"><b>3</b><span><strong>Watch them build</strong><small>Follow the teamwork live.</small></span></a>
      <a class="mission-step" data-phase="learn" href="#discovery"><b>4</b><span><strong>Test & discover</strong><small>Hide bricks. Learn to repair.</small></span></a>
    </nav>
    <div class="workshop">
      <aside class="mission-panel">
        <div class="mission-heading"><span class="mission-icon">${icon('leaf')}</span><span id="mission-number">Mission: Jurassic</span></div>
        <h1 id="mission-title">A little prehistoric.<br> A lot of possibility.</h1>
        <p id="mission-intro">You dream it. Five agents team up to build it, one brick at a time.</p>
        <div class="field-note"><span>${icon('star')}</span><p id="field-note">An agent does more than answer. It observes, chooses an action, and checks what happened.</p></div>
        <button id="demo" class="button demo-button">${icon('play')} Run an offline demo</button>
        <div id="save-status" class="save-status">Your workshop saves on this device.</div>
      </aside>
      <section class="stage" id="stage" tabindex="-1" aria-label="3D construction workbench">
        <div class="stage-heading"><span class="stage-tag"><i></i><span id="stage-status">Ready for your imagination</span></span><span id="scene-coordinates">JURASSIC / BUILD SITE A</span></div>
        <div id="canvas-host"></div>
        <div id="scene-error" class="scene-error" hidden></div>
        <div class="stage-tools" role="group" aria-label="Workbench view controls">
          <button id="blueprint" class="tool-button" aria-label="Toggle blueprint" aria-pressed="true" title="Blueprint">${icon('scan')}</button>
          <button id="explode" class="tool-button" aria-label="Toggle exploded view" aria-pressed="false" title="Exploded view">${icon('cube')}</button>
          <button id="interior-view" class="tool-button" aria-label="Toggle cutaway view" aria-pressed="false" title="Cutaway view">${icon('cutaway')}</button>
          <button id="camera" class="tool-button" aria-label="Reset camera" title="Reset camera">${icon('reset')}</button>
        </div>
        <div class="scene-caption" id="scene-caption"><strong>A big idea starts with a small brief.</strong><span>The translucent bricks are a preview, not an agent-built result.</span></div>
        <div id="brick-info" class="brick-info" hidden></div>
        <div class="stage-footer"><span>Drag to orbit <span class="separator">/</span> Scroll to zoom <span class="separator">/</span> Tap a brick to inspect</span><span class="scale-label">LEGO-style · original geometry</span></div>
      </section>
      <aside class="team-panel" id="team-panel" tabindex="-1">
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
          <div class="crew-prompts"><button type="button" class="text-button" id="ask-roles">Who does what?</button> <button type="button" class="text-button" id="ask-wait">Why wait?</button> <button type="button" class="text-button" id="ask-interior">How can a model be hollow?</button></div>
          <div id="crew-answer" role="status">Choose a question above or ask in English.</div>
        </div>
      </aside>
    </div>
    <section class="control-deck" aria-label="Build controls">
      <form id="brief-form" class="brief-form" tabindex="-1">
        <div class="brief-label"><label for="brief">What shall we build?</label><button type="button" id="inspire" class="text-button">Try an idea ${icon('star')}</button></div>
        <fieldset class="scene-action"><legend>Plan destination</legend><label><input type="radio" name="scene-action" value="replace" checked> Replace scene</label><label><input type="radio" name="scene-action" value="add"> Add to scene</label></fieldset>
        <div class="scene-size">
          <label for="scene-size">Approximate size of new build</label>
          <select id="scene-size" aria-describedby="scene-size-help scene-size-status">
            <option value="100">100</option><option value="500">500</option><option value="1000" selected>1,000</option>
            <option value="2000">2,000</option><option value="3000">3,000</option><option value="5000">5,000</option>
            <option value="8192">Max (up to 8,192)</option>
          </select>
          <small id="scene-size-help">AI planning only. A rough target for this build or addition, not a guarantee. Large builds may be slow.</small>
          <small id="scene-size-status" role="status"></small>
        </div>
        <label class="interior-option"><input id="hollow-interior" type="checkbox" aria-describedby="interior-help"><span><strong>Try a hollow interior</strong><small id="interior-help">Custom planning only. It asks for an empty space and usable opening when the design supports it; geometry remains model-generated.</small></span></label>
        <div class="brief-input" id="brief-composer">
          <button id="image-choose" class="composer-tool" type="button" aria-label="Choose image">${icon('plus')}</button>
          <textarea id="brief" rows="1" maxlength="1000" aria-describedby="brief-help" placeholder="Describe your dinosaur…"></textarea>
          <button id="voice-entry" class="composer-tool" type="button" aria-label="Optional voice input" aria-expanded="false" aria-controls="voice-panel">${icon('mic')}</button>
        </div>
        <div id="image-input"></div>
        <section id="voice-panel" class="voice-panel" aria-labelledby="voice-title" hidden>
          <h3 id="voice-title">Optional voice input</h3>
          <p id="voice-permission"></p>
          <div class="voice-controls">
            <button id="voice-start" class="button outline" type="button">Allow and record</button>
            <button id="voice-stop" class="button outline" type="button" disabled>Stop and transcribe</button>
            <button id="voice-cancel" class="text-button" type="button">Cancel voice input</button>
          </div>
          <p id="voice-status" class="voice-status" role="status" aria-live="polite" aria-atomic="true">Ready for voice input</p>
          <div id="voice-activity" class="voice-activity" hidden>
            <progress id="voice-progress" aria-labelledby="voice-status" aria-describedby="voice-progress-help"></progress>
            <span id="voice-progress-value" aria-hidden="true"></span>
            <p id="voice-progress-help"></p>
          </div>
          <div id="voice-review" hidden>
            <label id="voice-transcript-label" for="voice-transcript">Review and edit the transcription</label>
            <textarea id="voice-transcript" rows="3" aria-describedby="voice-review-help voice-count voice-length-warning"></textarea>
            <div class="voice-meta"><p id="voice-review-help">Review and edit the text before planning. It stays separate until you choose to use it.</p><p id="voice-count">0 / 1,000 characters</p></div>
            <p id="voice-length-warning" class="voice-warning" role="status" hidden></p>
            <div id="voice-pending" class="voice-pending" hidden><p id="voice-pending-note"></p><p id="voice-pending-text"></p><button id="voice-use-pending" class="button outline" type="button">Replace with new transcription</button> <button id="voice-discard-pending" class="button outline" type="button">Discard new transcription</button></div>
            <button id="voice-apply" class="button outline voice-apply" type="button" disabled>Use transcription in brief</button>
          </div>
        </section>
        <div class="composer-footer">
          <details id="media-privacy" class="media-privacy"><summary>Media & privacy</summary>
            <div id="image-privacy"></div><p id="voice-disclosure"></p><p id="voice-language"></p>
            <p>If a Copilot image helper crashes, private temporary files may remain. Unconfirmed cleanup locks planning; the server operator must verify processes and files before restarting.</p>
          </details>
          <button id="plan" class="button primary" type="submit">Make a plan ${icon('arrow')}</button>
        </div>
        <p id="brief-help">Name the object, body color, and a special feature. Clearer instructions help your team.</p>
        <p id="language-note">Offline templates recognize the translated guide examples and limited English keywords. Use the translated crew question buttons, or ask in English. Your brief, model output and external error details are not translated. Names created by local examples stay in the language selected when created.</p>
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
    <section class="discovery" id="discovery" tabindex="-1" aria-label="Learn and experiment">
      <div class="discovery-intro"><h2>Don’t just watch.<br>Be the scientist.</h2><p>Great agents check their work.<br>Great directors ask questions.</p></div>
      <div class="inspection"><div class="section-title"><h3>Build inspection</h3><span id="inspection-result">Waiting for a build</span></div><div id="checks"></div></div>
      <div class="experiments"><h3>Try a little what-if</h3><p>Remove about a third of the bricks. Watch the team compare reality with its plan and repair the gaps.</p><div class="experiment-actions"><button id="damage" class="button outline" disabled>Hide bricks</button><button id="repair" class="button outline" disabled>Ask team to repair</button></div><div class="replay-row"><label for="replay">Build replay</label><input id="replay" type="range" min="0" max="1" value="1" disabled aria-label="Replay placed bricks"/><button id="live-view" class="text-button">Live</button></div><span id="replay-label">Finish a build to explore its timeline.</span></div>
    </section>
    <details id="agent-insights" class="agent-insights">
      <summary>Extended agent insights</summary>
      <p>This read-only view shows local program state and recorded actions, not hidden model reasoning. Opening it makes no model request.</p>
      <div class="insight-context">
        <section><h3>Shared memory</h3><p>The crew shares one plan, placed brick identities and a task board. The retained event log holds up to 120 actions, not a model conversation.</p><dl id="insight-state"></dl></section>
        <section><h3>Context and tools</h3><p>Each builder reads its assigned tasks and prerequisites. A dependency-ready task is eligible work, not permission to build while paused or damaged.</p><p><code>step</code> / <code>inspect</code> / <code>damage</code> / <code>repair</code></p><p>These are bounded application functions. They place planned bricks, check the scene, simulate damage and reopen missing-brick tasks. Local agents cannot browse, run shell commands or invent extra tools.</p><p>The brief, scene and retained actions can be saved on this browser or exported. This panel sends no data and adds no private agent memory.</p></section>
      </div>
      <div id="insight-agents"></div>
      <p>Planning source is saved attribution, not independent proof. Counts are bricks and tasks, not model tokens. Connectivity checks do not prove physical stability.</p>
    </details>
    <div id="agent-playground-host"></div>
    <section class="learning-strip"><span class="learning-symbol">${icon('help')}</span><div><h3 id="quiz-title">Quick thought: what makes this a team of agents?</h3><div id="quiz-options"><button data-answer="wrong">They all use the same color</button><button data-answer="right">They choose actions and share progress</button><button data-answer="wrong">They build without any plan</button></div><p id="quiz-feedback" role="status">Make a prediction, then watch the crew.</p></div><div class="file-actions"><button id="herd-example" class="button outline">Load local Jurassic herd</button><button id="fleet-example" class="button outline">Load local space fleet</button><button id="export" class="button outline" disabled>${icon('download')} Save build file</button><button id="import" class="button outline">Load build / AI mission</button><input id="import-file" type="file" accept=".json,application/json" hidden aria-label="Choose a build or AI mission JSON file"/></div></section>
    <footer><span>BrickLab <span class="footer-dot">·</span> A hands-on introduction to agentic teamwork.</span><span>Independent educational demo. Not affiliated with the LEGO Group.</span></footer>
  </main>
  <dialog id="info-dialog" aria-labelledby="dialog-title"><div class="dialog-heading"><h2 id="dialog-title">Welcome to the workshop</h2><button id="close-dialog" class="tool-button" aria-label="Close dialog">×</button></div><div id="dialog-body"></div></dialog>
  <dialog id="planning-dialog" aria-labelledby="planning-title" aria-describedby="planning-description">
    <h2 id="planning-title">Planning in progress</h2>
    <p id="planning-description">One Copilot request is running. An estimate is unavailable; the maximum wait is 300 seconds.</p>
    <p id="planning-elapsed">Elapsed: 0 seconds</p>
    <p id="planning-reminder" role="status" hidden>Still planning. Abort now or continue waiting for this same request.</p>
    <div class="planning-actions"><button id="abort-planning" class="button outline" type="button">Abort planning</button><button id="continue-planning" class="button primary" type="button" hidden>Continue waiting</button></div>
  </dialog>
`;

let noticeSource = '';
let answerSource: { id: AgentId; response: string } | undefined;
let sceneErrorDetail = '';
let voiceUpdate: VoiceUpdate = { state: 'idle' };
let voiceTranscriptAtStart = '';
let voiceTranscriptRevision = 0;
let voiceRevisionAtStart = 0;
let pendingVoiceTranscript: string | null = null;
let voicePanelOpen = false;
let voiceReviewAvailable = false;
let voiceInput: ReturnType<typeof createVoiceInput> | undefined;
let imageInput: ReturnType<typeof createPlanningImageInput> | undefined;
const refreshVoiceUI = () => {
  const focused = document.activeElement;
  const labels = voiceLabels[getLanguage()];
  const transcript = $<HTMLTextAreaElement>('#voice-transcript');
  const active = ['requesting', 'recording', 'processing'].includes(voiceUpdate.state);
  const start = $<HTMLButtonElement>('#voice-start');
  const stop = $<HTMLButtonElement>('#voice-stop');
  const apply = $<HTMLButtonElement>('#voice-apply');
  const entry = $<HTMLButtonElement>('#voice-entry');
  const tooLong = transcript.value.length > 1000;
  start.disabled = active || pendingVoiceTranscript !== null;
  start.hidden = active;
  stop.disabled = voiceUpdate.state !== 'recording';
  stop.hidden = voiceUpdate.state !== 'recording';
  entry.disabled = voiceUpdate.state === 'requesting' || voiceUpdate.state === 'processing';
  entry.classList.toggle('recording', voiceUpdate.state === 'recording');
  entry.innerHTML = icon(voiceUpdate.state === 'recording' ? 'stop' : 'mic');
  entry.setAttribute('aria-label', voiceUpdate.state === 'recording' ? labels.stop : labels.title);
  entry.setAttribute('title', voiceUpdate.state === 'recording' ? labels.stop : labels.title);
  entry.setAttribute('aria-expanded', String(voicePanelOpen || active));
  $('#voice-panel').hidden = !voicePanelOpen && !active;
  $('#voice-permission').hidden = active;
  $('#voice-review').hidden = !voiceReviewAvailable;
  if ((start.hidden && focused === start) || (stop.hidden && focused === stop) || (entry.disabled && focused === entry))
    (voiceUpdate.state === 'recording' ? stop : $('#voice-cancel')).focus();
  apply.disabled = active || !transcript.value.trim() || tooLong;
  const progress = voiceUpdate.state === 'processing' ? voiceUpdate.progress : undefined;
  const statusText = `${progress ? labels.progress[progress.stage] : labels.states[voiceUpdate.state]}${voiceUpdate.error ? `: ${labels.errors[voiceUpdate.error]}` : ''}`;
  if ($('#voice-status').textContent !== statusText) $('#voice-status').textContent = statusText;
  $('#voice-activity').hidden = voiceUpdate.state !== 'processing';
  const progressBar = $<HTMLProgressElement>('#voice-progress');
  const loaded = progress?.loaded;
  const total = progress?.total;
  const fraction = progress?.stage === 'downloading' && typeof loaded === 'number' && typeof total === 'number'
    && Number.isFinite(loaded) && Number.isFinite(total) && total > 0 && loaded >= 0 && loaded <= total
    ? loaded / total : undefined;
  progressBar.max = 1;
  if (fraction !== undefined) progressBar.value = fraction;
  else progressBar.removeAttribute('value');
  $('#voice-progress-value').textContent = fraction !== undefined
    ? new Intl.NumberFormat(getLanguage(), { style: 'percent', maximumFractionDigits: 0 }).format(progressBar.value) : '';
  $('#voice-progress-help').textContent = progress?.stage === 'downloading' ? labels.downloadHelp
    : progress?.stage === 'loading' ? labels.loadingHelp : labels.processingHelp;
  $('#voice-count').textContent = labels.count.replace('{count}', String(transcript.value.length));
  const warning = $<HTMLParagraphElement>('#voice-length-warning');
  warning.textContent = tooLong ? labels.tooLong.replace('{count}', String(transcript.value.length)) : '';
  warning.hidden = !tooLong;
  $('#voice-pending').hidden = pendingVoiceTranscript === null;
  $('#voice-pending-note').textContent = pendingVoiceTranscript === null ? '' : labels.pending;
  $('#voice-pending-text').textContent = pendingVoiceTranscript ?? '';
};
const applyVoiceLabels = () => {
  const labels = voiceLabels[getLanguage()];
  $('#voice-title').textContent = labels.title;
  $('#voice-disclosure').textContent = `${labels.disclosure} ${labels.runtime}`;
  $('#voice-permission').textContent = labels.permission;
  $('#voice-language').textContent = labels.language;
  $('#voice-start').textContent = labels.start;
  $('#voice-stop').textContent = labels.stop;
  $('#voice-cancel').textContent = labels.cancel;
  $('#voice-transcript-label').textContent = labels.transcript;
  $('#voice-review-help').textContent = labels.review;
  $('#voice-use-pending').textContent = labels.replace;
  $('#voice-discard-pending').textContent = labels.discard;
  $('#voice-apply').textContent = labels.apply;
  refreshVoiceUI();
};
try {
  const savedLanguage = localStorage.getItem('bricklab-language');
  if (languages.some(language => language === savedLanguage)) setLanguage(savedLanguage as Language);
} catch { /* The interface still works when browser storage is unavailable. */ }
const languageSelect = $<HTMLSelectElement>('#language');
const applyLanguage = () => {
  document.documentElement.lang = getLanguage();
  languageSelect.value = getLanguage();
  translateInterface(app);
  playground.setLanguage(getLanguage());
  applyVoiceLabels();
  imageInput?.refresh();
  if (noticeSource) $('#notice').textContent = translateActivity(noticeSource);
  if (answerSource) $('#crew-answer').textContent = `${AGENTS[answerSource.id].name}: ${translate(answerSource.response)}`;
  if (sceneErrorDetail) $('#scene-error').textContent = `${translate('3D is unavailable:')} ${translate(sceneErrorDetail)}. ${translate('You can still build using the task board and text inspection below.')}`;
  const statuses = [['#planner-status', plannerMessage], ['#local-planner-status', localPlanner.message],
    ['#azure-planner-status', azurePlanner.message], ['#compatible-planner-status', compatiblePlanner.message]] as const;
  for (const [selector, message] of statuses) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.textContent = translateActivity(message);
  }
};
languageSelect.addEventListener('change', () => {
  const selected = languageSelect.value;
  if (!languages.some(language => language === selected)) return;
  setLanguage(selected as Language);
  try { localStorage.setItem('bricklab-language', selected); }
  catch { notice('Could not save your language on this device.'); }
  applyLanguage();
  updateSceneSize();
  lastEventCount = -1;
  render();
});
const languageObserver = new MutationObserver(() => translateInterface(app));
languageObserver.observe(app, { subtree: true, childList: true, characterData: true, attributes: true,
  attributeFilter: ['aria-label', 'title', 'placeholder'] });
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
let hasSceneAppend = false;
let activeBrief = '';
let running = false;
let speed = 1;
let lastEventCount = -1;
let eventRevision = 0;
let showGhost = true;
let exploded = false;
let interiorView = false;
let mode: 'local' | 'copilot' | 'local-ai' | 'azure' | 'compatible' = 'copilot';
let modeChosen = false;
let hosted = false;
let apiKey = '';
let copilotEnabled = false;
let copilotImagesEnabled = false;
let azureImagesEnabled = false;
let plannerState = 'unavailable';
let plannerMessage = 'Checking the local planner…';
let localPlanner = { enabled: false, state: 'off', message: 'Local AI is off. Configure Ollama on the BrickLab server host, then restart with BRICKLAB_LOCAL_AI=1 and BRICKLAB_LOCAL_MODEL set.' };
let azurePlanner = { enabled: false, state: 'off', authentication: 'entra', message: 'Azure planning is unavailable on this server.' };
let publicAllowance = '';
let compatiblePlanner = { enabled: false, state: 'off', message: 'Compatible AI is off.' };
let planning = false;
let planningController: AbortController | null = null;
let replaying = false;
let examples = 0;
let scene: Workbench | undefined;
let storageWarningShown = false;
let quizWon = false;
const playground = mountAgentPlayground($('#agent-playground-host'), { language: getLanguage() });
applyLanguage();
const brief = $<HTMLTextAreaElement>('#brief');
brief.value = translate(EXAMPLES.jurassic[0]);
function updateSceneSize() {
  const status = $('#scene-size-status');
  if (mode === 'local') {
    status.textContent = translate('Offline templates do not use this target.');
    return;
  }
  try {
    const result = resolveSceneSize(brief.value, Number($<HTMLSelectElement>('#scene-size').value));
    const prefix = result.source === 'brief' ? 'Target from brief:' : 'Target from selection:';
    status.textContent = `${translate(prefix)} ${new Intl.NumberFormat(getLanguage()).format(result.target)} ${translate('bricks')}`;
  } catch {
    status.textContent = translate('Requested brick count must be between 1 and 8192.');
  }
}
brief.addEventListener('input', updateSceneSize);
$<HTMLSelectElement>('#scene-size').addEventListener('change', updateSceneSize);
imageInput = createPlanningImageInput({
  container: $('#image-input'), chooser: $<HTMLButtonElement>('#image-choose'), privacy: $('#image-privacy'),
  target: () => mode === 'local' ? 'local' : hosted && mode !== 'azure' ? 'hosted' : mode,
  copilotImages: () => copilotImagesEnabled, azureImages: () => azureImagesEnabled,
});
const voiceTranscript = $<HTMLTextAreaElement>('#voice-transcript');
voiceInput = createVoiceInput(
  update => { voiceUpdate = update; refreshVoiceUI(); },
  text => {
    voiceReviewAvailable = true;
    if (!voiceTranscriptAtStart && voiceTranscriptRevision === voiceRevisionAtStart) voiceTranscript.value = text;
    else pendingVoiceTranscript = text;
    refreshVoiceUI();
  },
);
voiceTranscript.addEventListener('input', () => { voiceTranscriptRevision++; refreshVoiceUI(); });
$('#voice-entry').addEventListener('click', () => {
  if (voiceUpdate.state === 'recording') { voiceInput?.stop(); return; }
  voicePanelOpen = true;
  refreshVoiceUI();
  $('#voice-start').focus();
});
$('#voice-start').addEventListener('click', () => {
  voiceTranscriptAtStart = voiceTranscript.value;
  voiceRevisionAtStart = voiceTranscriptRevision;
  void voiceInput?.start(true, getLanguage());
});
$('#voice-stop').addEventListener('click', () => voiceInput?.stop());
$('#voice-cancel').addEventListener('click', () => {
  voiceInput?.cancel();
  voicePanelOpen = false;
  refreshVoiceUI();
  $('#voice-entry').focus();
});
$('#voice-use-pending').addEventListener('click', () => {
  if (pendingVoiceTranscript === null) return;
  voiceTranscript.value = pendingVoiceTranscript;
  pendingVoiceTranscript = null;
  refreshVoiceUI();
  voiceTranscript.focus();
});
$('#voice-discard-pending').addEventListener('click', () => {
  pendingVoiceTranscript = null;
  refreshVoiceUI();
  voiceTranscript.focus();
});
$('#voice-apply').addEventListener('click', () => {
  if (!voiceTranscript.value.trim() || voiceTranscript.value.length > 1000) return;
  brief.value = voiceTranscript.value;
  updateSceneSize();
  voicePanelOpen = false;
  refreshVoiceUI();
  brief.focus();
});
const notice = (message: string) => { noticeSource = message; $('#notice').textContent = translateActivity(message); $('#notice').hidden = false; };
const clearNotice = () => { noticeSource = ''; $('#notice').hidden = true; };
const setButton = (id: string, disabled: boolean) => { $<HTMLButtonElement>(id).disabled = disabled; };
const statusNames: Record<string, string> = {
  planned: 'Plan ready. You’re the director.', building: 'Teamwork in progress', paused: 'Paused. Take a closer look.',
  complete: 'Mission complete. Beautiful teamwork!', damaged: 'Inspection found a problem.',
};
try {
  scene = new Workbench($('#canvas-host'), (brick: Brick) => {
    const info = $('#brick-info');
    info.hidden = false;
    const part = team?.plan.spec.model === 'custom' ? brick.part : translate(brick.part);
    info.textContent = `${brick.object ? `${brick.object} · ` : ''}${part} · ${translate('placed by')} ${AGENTS[brick.agent].name} · ${translate('grid')} (${brick.x}, ${brick.y}, ${brick.z}) · ${brick.width ?? 1} × ${brick.height ?? 1} × ${brick.depth ?? 1} ${translate('cells')}`;
    setTimeout(() => { info.hidden = true; }, 5000);
  });
} catch (error) {
  $('#scene-error').hidden = false;
  sceneErrorDetail = error instanceof Error ? error.message : 'WebGL is not supported';
  $('#scene-error').textContent = `${translate('3D is unavailable:')} ${translate(sceneErrorDetail)}. ${translate('You can still build using the task board and text inspection below.')}`;
}

function save() {
  if (!team) return;
  let payload;
  try {
    payload = JSON.stringify(hasSceneAppend ? snapshotSceneAppend(team, activeBrief) : team.snapshot(activeBrief));
  } catch (error) {
    $('#save-status').textContent = 'Could not prepare the build for saving.';
    notice(`Could not prepare the build for saving: ${error instanceof Error ? error.message : 'invalid scene'}.`);
    return;
  }
  try {
    localStorage.setItem(`bricklab-${world}`, payload);
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
  updateSceneSize();
  const total = team ? allBricks(team.plan).length : 0;
  const count = team?.bricks.size ?? 0;
  const percent = total ? Math.round(count / total * 100) : 0;
  $('#brick-count').innerHTML = `${count} <span>/ ${total || '—'} ${esc(translate('bricks'))}</span>`;
  $('#progress-value').textContent = `${percent}%`;
  $<HTMLProgressElement>('#progress').value = percent;
  $('#stage-status').textContent = planning ? 'Planning your custom design…' : team ? statusNames[team.status] : 'Ready for your imagination';
  const status = team?.status;
  const canRun = !!team && !['complete', 'damaged'].includes(team.status) && !planning;
  setButton('#run', !canRun);
  setButton('#step', !canRun || running);
  setButton('#damage', status !== 'complete');
  setButton('#repair', status !== 'damaged');
  setButton('#export', !count);
  setButton('#plan', planning);
  setButton('#interior-view', !scene);
  setButton('#demo', planning);
  setButton('#herd-example', planning);
  setButton('#fleet-example', planning);
  setButton('#jurassic', planning);
  setButton('#space', planning);
  document.querySelectorAll<HTMLInputElement>('input[name="scene-action"]').forEach(input => { input.disabled = planning; });
  $<HTMLInputElement>('#hollow-interior').disabled = planning || mode === 'local';
  $<HTMLSelectElement>('#scene-size').disabled = planning || mode === 'local';
  $('#run').innerHTML = running ? `${icon('pause')} Pause build` : `${icon('play')} ${team && count ? 'Continue build' : 'Start building'}`;
  $('#task-count').textContent = team ? `${team.completedTasks}/${team.plan.tasks.length}` : '0';
  $('#transport-note').textContent = planning ? 'One bounded planning request. No template fallback; the crew executes locally.'
    : running ? `${speed}× ${translate('playback')} · ${translate('Both builders observe the shared board each turn.')}`
    : status === 'complete' ? 'Try the repair challenge below, or change your brief.'
    : status === 'damaged' ? 'The inspector noticed a problem. Ask the team to repair it.'
    : team ? 'Review the task board, then start building.' : 'Make a plan, then give your crew the go-ahead.';
  $('#scene-caption').hidden = !!team && count > 0;
  if (!team) {
    $('#scene-caption').innerHTML = `<strong>${esc(translate('A big idea starts with a small brief.'))}</strong><span>${esc(translate('The translucent bricks are a preview, not an agent-built result.'))}</span>`;
  }
  if (team && !count) {
    const name = team.plan.spec.design?.name ?? `${translate(team.plan.spec.color)} ${translate(team.plan.spec.model)}`;
    $('#scene-caption').innerHTML = `<strong>${esc(name)}. ${esc(translate('Your idea, their teamwork.'))}</strong><span>${esc(translate('Blueprint ready'))} · ${total} ${esc(translate('bricks'))} · ${team.plan.tasks.length} ${esc(translate('delegated tasks'))}</span>`;
  }
  const phase = !team ? 'brief' : status === 'planned' ? 'plan' : ['complete','damaged'].includes(status!) ? 'learn' : 'build';
  document.querySelectorAll<HTMLAnchorElement>('.mission-step').forEach(el => {
    const current = el.dataset.phase === phase;
    el.classList.toggle('current', current);
    if (current) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
  for (const id of Object.keys(AGENTS) as AgentId[]) {
    const text = id === 'build' ? planning ? 'Waiting' : running ? 'Checking' : team ? 'Watching' : 'Ready'
      : id === 'plan' ? team ? 'Reviewed' : 'Ready'
      : id === 'check' ? status === 'complete' ? 'Passed' : status === 'damaged' ? 'Problem found' : team ? 'Waiting' : 'Ready'
      : running && team?.readyTask(id) ? 'Building'
      : status === 'complete' ? 'Done' : team ? 'Waiting' : 'Ready';
    $(`#${id}-state`).textContent = text;
    $(`#${id}-state`).classList.toggle('working', text === 'Building');
  }
  const revision = (team?.events.length ?? 0) + eventRevision;
  const objectNames = team?.plan.spec.design?.objects?.map(object => object.name);
  if (revision !== lastEventCount) {
    lastEventCount = revision;
    const events = team?.events.slice().reverse() ?? [
      { agent: 'build' as const, kind: 'plan', message: 'Hello, director! Describe any brick design. I’ll split it into jobs for our crew.', tick: 0 },
      { agent: 'plan' as const, kind: 'observe', message: 'I review the task dependencies and check whether the planned bricks connect.', tick: 0 },
      { agent: 'frame' as const, kind: 'observe', message: 'I build the body and structure. I’ll tell DetailBot when a supporting part is ready.', tick: 0 },
      { agent: 'detail' as const, kind: 'observe', message: 'I assemble supports and finishing touches after their foundations are ready. We share one task board.', tick: 0 },
      { agent: 'check' as const, kind: 'observe', message: 'I inspect the finished model and check for missing bricks.', tick: 0 },
    ];
    $('#event-list').innerHTML = events.map(e => `<article class="event ${e.agent}"><div><strong>${AGENTS[e.agent].name}</strong><span>${esc(translate(e.kind))} · ${esc(translate('turn'))} ${e.tick}</span></div><p>${esc(translateActivity(e.message, !!team && team.plan.spec.model !== 'custom', objectNames))}</p></article>`).join('');
  }
  $('#task-list').innerHTML = team ? team.plan.tasks.map(task => {
    const done = team!.taskDone(task);
    const placed = task.bricks.filter(b => team!.bricks.has(b.id)).length;
    const waiting = task.depends.some(id => !team!.taskDone(team!.plan.tasks.find(t => t.id === id)!));
    const taskName = (label: string) => translateTaskName(label, team!.plan.spec.model !== 'custom', objectNames);
    return `<article class="task ${done ? 'done' : ''}"><span class="task-dot ${task.agent}">${done ? '✓' : placed ? '↗' : '·'}</span><div><strong>${esc(taskName(task.label))}</strong><small>${AGENTS[task.agent].name} · ${placed}/${task.bricks.length}</small><small>${waiting ? `${esc(translate('Waits for:'))} ${task.depends.map(id => esc(taskName(team!.plan.tasks.find(t => t.id === id)?.label ?? id))).join(', ')}` : esc(translate(done ? 'Shared board updated' : 'Dependencies ready'))}</small></div></article>`;
  }).join('') : `<p class="empty-note">${esc(translate('Make a plan to see the delegated jobs and their dependencies here.'))}</p>`;
  const checks = team?.checks ?? [];
  $('#checks').innerHTML = checks.length ? checks.map(c => `<div class="check ${c.pass ? 'passed' : ''}"><span>${c.pass ? '✓' : '·'}</span><div><strong>${esc(translate(c.label))}</strong><small>${esc(translateCheckDetail(c.detail, team?.plan.spec.design?.objects?.map(object => object.name)))}</small></div></div>`).join('')
    : '<p class="empty-note">CheckBot will compare the finished build with the plan, connectivity, and brick budget. Templates also check symmetry.</p>';
  $('#inspection-result').textContent = team ? `${checks.filter(c => c.pass).length}/${checks.length} ${translate('checks')}` : 'Waiting for a build';
  const replay = $<HTMLInputElement>('#replay');
  replay.disabled = status !== 'complete' && status !== 'damaged';
  replay.max = String(Math.max(1, count));
  if (!replaying) replay.value = String(count || 1);
  if (replaying && team) $('#replay-label').textContent = `${translate('Replay:')} ${replay.value} / ${count} ${translate('placed bricks. Your saved build is unchanged.')}`;
  if (status === 'complete' && !replaying) $('#replay-label').textContent = 'Scrub through the actual order bricks were placed.';
  if (!replaying) scene?.sync(team ? [...team.bricks.values()] : []);
  renderInsights();
}

function renderInsights() {
  if (!$<HTMLDetailsElement>('#agent-insights').open) return;
  const text = (value: string) => esc(translate(value));
  if (!team) {
    $('#insight-state').innerHTML = `<dt>${text('Current brief')}</dt><dd>${text('No plan loaded')}</dd>`;
    $('#insight-agents').innerHTML = '';
    return;
  }
  const view = agentInsights(team);
  const sourceNames = {
    local: 'Local rule-based agents', copilot: 'Copilot cloud planning · custom designs', 'local-ai': 'Local AI · server-host model',
    azure: 'Azure Foundry planning · custom designs', compatible: 'Compatible AI · custom designs', 'github-models': 'Imported model decisions',
  } as const;
  $('#insight-state').innerHTML = [
    ['Current brief', activeBrief],
    ['Planning source', translate(sourceNames[view.source])],
    ['Placed / planned bricks', `${view.placed} / ${view.planned}`],
    ['Not currently placed', String(view.missing)],
    ['Completed / total tasks', `${view.completedTasks} / ${view.totalTasks}`],
    ['Dependency links', String(view.dependencies)],
  ].map(([label, value]) => `<dt>${text(label)}</dt><dd>${esc(value)}</dd>`).join('');
  const actions: Record<AgentId, string> = {
    build: 'Coordinates ready work and reports completion.',
    plan: 'Checks the graph before construction and prerequisites at each handoff.',
    frame: 'Places assigned structural bricks.',
    detail: 'Assembles assigned supports and details.',
    check: 'Inspects identities and connectivity; identifies missing bricks for repair.',
  };
  const taskName = (label: string) => esc(translateTaskName(label, team!.plan.spec.model !== 'custom', team!.plan.spec.design?.objects?.map(object => object.name)));
  $('#insight-agents').innerHTML = `<table><caption>${text('Local agents: context and recorded actions')}</caption><thead><tr><th scope="col">${text('Agent and available actions')}</th><th scope="col">${text('Latest recorded action')}</th></tr></thead><tbody>${view.agents.map(agent => {
    const event = agent.lastAction;
    const task = agent.id === 'frame' || agent.id === 'detail'
      ? `<p>${text('Completed / total tasks')}: ${agent.completed} / ${agent.tasks}</p><p>${agent.ready
        ? `${text('Dependency-ready task')}: ${taskName(agent.ready.label)}`
        : text(agent.completed === agent.tasks ? 'No pending assigned tasks' : 'Waiting for prerequisites')}</p>` : '';
    return `<tr data-insight-agent="${agent.id}"><th scope="row">${AGENTS[agent.id].name}<small>${text(AGENTS[agent.id].role)}</small><p>${text(actions[agent.id])}</p>${task}</th><td>${event
      ? `<small>${text('turn')} ${event.tick} · ${text(event.kind)}</small><p>${esc(translateActivity(event.message, team!.plan.spec.model !== 'custom', team!.plan.spec.design?.objects?.map(object => object.name)))}</p>`
      : text('No action in the retained log')}</td></tr>`;
  }).join('')}</tbody></table>`;
}
$('#agent-insights').addEventListener('toggle', renderInsights);

function startPlanningWait(controller: AbortController, provider: 'Azure Foundry' | 'Copilot' | 'Compatible AI' | 'Local AI', planningBrief: string, image = false) {
  const modal = $<HTMLDialogElement>('#planning-dialog');
  const started = Date.now();
  const maximum = provider === 'Local AI' ? 90 : 300;
  let nextReminder = 100;
  let timeout = false;
  const update = () => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    $('#planning-elapsed').textContent = elapsedText(elapsed);
    if (elapsed >= maximum) {
      timeout = true;
      controller.abort();
    } else if (elapsed >= nextReminder) {
      $('#planning-reminder').hidden = false;
      $('#continue-planning').hidden = false;
    }
  };
  $('#planning-reminder').hidden = true;
  $('#continue-planning').hidden = true;
  $('#planning-elapsed').textContent = elapsedText(0);
  $('#planning-description').textContent = planningDescription(provider, planningBrief, image);
  const abort = () => controller.abort();
  const cancel = (event: Event) => { event.preventDefault(); abort(); };
  const continueWaiting = () => {
    nextReminder = Math.floor((Date.now() - started) / 100_000 + 1) * 100;
    $('#planning-reminder').hidden = true;
    $('#continue-planning').hidden = true;
  };
  $('#abort-planning').addEventListener('click', abort);
  $('#continue-planning').addEventListener('click', continueWaiting);
  modal.addEventListener('cancel', cancel);
  modal.showModal();
  const timer = window.setInterval(update, 1000);
  return {
    timedOut: () => timeout,
    close: () => {
      window.clearInterval(timer);
      $('#abort-planning').removeEventListener('click', abort);
      $('#continue-planning').removeEventListener('click', continueWaiting);
      modal.removeEventListener('cancel', cancel);
      if (modal.open) modal.close();
    },
  };
}

async function planningResponse(response: Response): Promise<{ spec?: unknown; error?: string }> {
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json();
  if (!response.body) throw new Error('Planning response has no stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', size = 0;
  let result: { spec?: unknown; error?: string } | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    if (result) throw new Error('Planning stream continued after its result.');
    const event: unknown = JSON.parse(line);
    if (!event || typeof event !== 'object' || !('type' in event)) throw new Error('Invalid planning stream event.');
    if (event.type === 'waiting') return;
    if (event.type === 'correcting') {
      $('#planning-description').textContent = translate('Correcting the generated design once. The same submission, deadline and daily allowance apply; transport failures are not retried.');
      return;
    }
    if (event.type === 'result' && 'spec' in event) result = { spec: event.spec };
    else if (event.type === 'error' && 'error' in event && typeof event.error === 'string') result = { error: event.error };
    else throw new Error('Invalid planning stream event.');
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new Error('Planning response is too large.');
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
    }
    buffer += decoder.decode();
    consume(buffer);
    if (!result) throw new Error('Planning stream ended without a result.');
    return result;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function makePlan(demo = false) {
  if (planning) return;
  const planningBrief = brief.value;
  const adding = !demo && $<HTMLInputElement>('input[name="scene-action"]:checked').value === 'add';
  running = false;
  if (team?.status === 'building') team.status = 'paused';
  replaying = false;
  clearNotice();
  const controller = new AbortController();
  planningController = controller;
  let wait: ReturnType<typeof startPlanningWait> | undefined;
  try {
    if (!planningBrief.trim() || planningBrief.length > 1000) throw new Error('Give the team a brief of 1–1,000 characters.');
    if (adding && !team) throw new Error('There is no scene to add to. Choose Replace scene to start one.');
    const selectedSize = Number($<HTMLSelectElement>('#scene-size').value);
    const planningSize = mode !== 'local' ? resolveSceneSize(planningBrief, selectedSize) : undefined;
    planning = true; render();
    const image = demo ? undefined : await imageInput?.take();
    controller.signal.throwIfAborted();
    let spec;
    let source: 'local' | 'copilot' | 'local-ai' | 'azure' | 'compatible' = 'local';
    const assumptions: string[] = [];
    if (mode !== 'local') {
      const planningKey = await refreshStatus();
      controller.signal.throwIfAborted();
      if (!planningKey) throw new Error('Server status is not ready. Retry status in Change mode before planning.');
      const localAI = mode === 'local-ai';
      const azure = mode === 'azure';
      const compatible = mode === 'compatible';
      if (compatible ? !compatiblePlanner.enabled || compatiblePlanner.state !== 'configured' : azure ? !azurePlanner.enabled || azurePlanner.state !== 'configured'
        : localAI ? !localPlanner.enabled || localPlanner.state !== 'configured' : !copilotEnabled && plannerState !== 'needs-auth')
        throw new Error(compatible ? compatiblePlanner.message : azure ? azurePlanner.message : localAI ? localPlanner.message : plannerMessage);
      const azureAccessToken = azure && azurePlanner.authentication !== 'anonymous' ? await acquireAzurePlanningToken() : undefined;
      controller.signal.throwIfAborted();
      if (image && azure && !azureImagesEnabled) throw new Error('Azure image planning is unavailable on this server.');
      wait = startPlanningWait(controller, compatible ? 'Compatible AI' : azure ? 'Azure Foundry' : localAI ? 'Local AI' : 'Copilot', planningBrief, !!image);
      const response = await fetch(compatible ? '/api/compatible-plan' : azure ? '/api/azure-plan' : localAI ? '/api/local-plan' : '/api/plan', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bricklab-Key': planningKey,
          Accept: 'application/x-ndjson',
          ...(azureAccessToken ? { Authorization: `Bearer ${azureAccessToken}` } : {}) },
        body: JSON.stringify({ world, brief: planningBrief,
          sceneSize: selectedSize,
          ...($<HTMLInputElement>('#hollow-interior').checked ? { hollowInterior: true } : {}),
          ...(image ? { image, imageConsent: true } : {}) }), signal: controller.signal });
      const data = await planningResponse(response);
      if (controller.signal.aborted) throw new DOMException('Planning aborted.', 'AbortError');
      if (!response.ok || data.error) {
        await refreshStatus();
        throw new Error(data.error || 'Planning request failed.');
      }
      spec = validateSpec(data.spec, world);
      if (spec.model !== 'custom') throw new Error('The planner returned a template instead of custom geometry. No new build, retry or template fallback was made.');
      source = compatible ? 'compatible' : azure ? 'azure' : localAI ? 'local-ai' : 'copilot';
      assumptions.push(`${compatible ? 'Compatible AI' : azure ? 'Azure Foundry' : localAI ? 'Local AI' : 'Copilot'} proposed a custom brick design. The five local agents execute and inspect it; they are not separate language models.`);
      assumptions.push(`${translate('Approximate planning target:')} ${planningSize!.target} ${translate('bricks')}; ${translate('Selected size:')} ${selectedSize}. ${translate('A rough target, not an exact output guarantee.')}`);
    } else {
      const parsed = parseBrief(world, planningBrief);
      spec = parsed.spec;
      assumptions.push(...parsed.assumptions);
      assumptions.push('Offline template mode reads a small vocabulary, not arbitrary language. Species, body color, long tail, wide wings, and budget are supported.');
    }
    const plan = createPlan(spec, assumptions, source);
    if (adding && team) {
      const appended = appendScene(team, plan, translate('Appended scene'), translate);
      team = appended.team;
      hasSceneAppend = true;
      notice(`Added to the scene at grid offset (${appended.offset.x}, ${appended.offset.z}). Existing bricks remain in place.`);
    } else {
      team = new Team(plan);
      hasSceneAppend = false;
    }
    activeBrief = planningBrief;
    eventRevision += 1000;
    scene?.setBlueprint(allBricks(team.plan));
    scene?.sync([...team.bricks.values()]);
    scene?.setInteriorView(interiorView);
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
    notice(planningController?.signal.aborted
      ? wait?.timedOut() ? mode === 'local-ai'
        ? 'Planning reached the 90-second limit. No new build was started.'
        : 'Planning reached the 300-second limit. No new build was started.'
        : 'Planning aborted. No new build was started.'
      : error instanceof Error ? error.message : 'Planning failed. No new build was started.');
  } finally { wait?.close(); planningController = null; planning = false; render(); if (hosted) void refreshStatus(); }
}
function updateSpeed() {
  $('#speed').innerHTML = `${icon('fast')}<span>${speed}×</span>`;
  $('#speed').setAttribute('aria-label', `Fast-forward speed, currently ${speed} times`);
}
function restore() {
  try {
    const raw = localStorage.getItem(`bricklab-${world}`);
    if (raw) {
      const data: unknown = JSON.parse(raw);
      const appended = !!data && typeof data === 'object' && 'sceneAppend' in data;
      const restored = appended ? restoreSceneAppend(data) : restoreSnapshot(data);
      team = restored.team;
      hasSceneAppend = appended;
      brief.value = restored.prompt;
      activeBrief = restored.prompt;
      scene?.setBlueprint(allBricks(team.plan));
      $('#save-status').textContent = 'Previous build restored from this device.';
    } else {
      team = null;
      hasSceneAppend = false;
      activeBrief = '';
      brief.value = translate(EXAMPLES[world][0]);
      preview();
    }
  } catch (error) {
    team = null;
    hasSceneAppend = false;
    brief.value = translate(EXAMPLES[world][0]);
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
$('#inspire').addEventListener('click', () => { brief.value = translate(EXAMPLES[world][++examples % EXAMPLES[world].length]); updateSceneSize(); brief.focus(); });
$('#demo').addEventListener('click', () => { mode = 'local'; modeChosen = true; updateMode(); brief.value = translate(EXAMPLES[world][0]); void makePlan(true); });
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
$('#interior-view').addEventListener('click', () => {
  interiorView = !interiorView;
  scene?.setInteriorView(interiorView);
  $('#interior-view').setAttribute('aria-pressed', String(interiorView));
});
$('#camera').addEventListener('click', () => scene?.resetCamera());
$('#damage').addEventListener('click', () => { replaying = false; team?.damage(); eventRevision++; render(); save(); });
$('#repair').addEventListener('click', () => { replaying = false; team?.repair(); running = team?.status === 'building'; eventRevision++; render(); save(); });
$('#replay').addEventListener('input', () => {
  if (!team) return;
  replaying = true;
  const count = Number($<HTMLInputElement>('#replay').value);
  scene?.sync([...team.bricks.values()].slice(0, count));
  scene?.showBlueprint(false);
  render();
});
$('#live-view').addEventListener('click', () => { replaying = false; scene?.showBlueprint(showGhost); render(); });
function selectBoardTab(tab: 'live' | 'tasks') {
  $('#event-list').hidden = tab !== 'live';
  $('#task-list').hidden = tab !== 'tasks';
  for (const id of ['live', 'tasks']) { $(`#tab-${id}`).classList.toggle('active', tab === id); $(`#tab-${id}`).setAttribute('aria-pressed', String(tab === id)); }
}
for (const tab of ['live', 'tasks'] as const) $(`#tab-${tab}`).addEventListener('click', () => selectBoardTab(tab));
document.querySelectorAll<HTMLAnchorElement>('.mission-step').forEach(step => step.addEventListener('click', () => {
  if (step.dataset.phase === 'plan') selectBoardTab('tasks');
}));
function answer(question: string, agent?: AgentId) {
  const q = question.toLowerCase();
  const id = agent ?? (/checkbot|inspect|quality/.test(q) ? 'check' : /planbot|dependencies/.test(q) ? 'plan' : /detail|wait|finish/.test(q) ? 'detail' : /frame|structure/.test(q) ? 'frame' : 'build');
  const responses: Record<AgentId, string> = {
    build: 'I turn your goal into tasks and coordinate the crew. A language model is optional here: our local agents follow explicit rules.',
    plan: 'I review the task graph for missing dependencies and cycles before the build starts, and warn if the planned bricks are disconnected.',
    frame: 'I check the shared board, choose a ready structure task, and place bricks. I tell DetailBot when each supporting part is ready. I do not need a new instruction for every brick.',
    detail: 'I build assigned supports and details after their prerequisites are ready. Feet wait for legs; eyes wait for a head. We share the task board.',
    check: 'I inspect the completed build against its plan, connectivity and budget. If bricks are missing, I identify them so their owners can repair the build.',
  };
  let response = responses[id];
  if (/who.*what/.test(q)) response = 'BuildBot coordinates, PlanBot checks dependencies, FrameBot and DetailBot build, and CheckBot inspects and directs repairs.';
  else if (/cost|money|price/.test(q)) response = hosted
    ? `The hosted demo uses a shared daily request allowance; it does not display a per-request dollar estimate. ${translate('One submission may use two model requests to correct an invalid design; the daily allowance counts submissions.')}${publicAllowance ? ` ${publicAllowance}` : ''}`
    : `${translate('Offline templates make no model calls. Local AI uses server compute. Model and hosting charges may apply; no dollar estimate is available.')} ${translate('One submission may use two model requests to correct an invalid design; the daily allowance counts submissions.')}`;
  else if (/hollow|interior|cavity/.test(q)) response = 'The hollow-interior preference asks custom planning to leave an empty space and a usable opening when the design supports it. Use Cutaway view to inspect the cross-section. It is a preference, not a guarantee.';
  else if (/repair|missing|broken/.test(q)) response = 'We compare the actual brick grid with the planned grid. The specialist who owns a missing brick reopens that task and replaces it. That is an observe–act–check loop.';
  else if (/prompt|brief|change|color/.test(q)) response = 'Try a body color, species or ship type, and one feature. For example: “purple brachiosaurus” or “blue explorer with wide wings.” Then make a new plan. Unspecified choices are shown as assumptions.';
  else if (/why.*plan|plan.*why/.test(q)) response = 'A shared plan tells each specialist what to do and which parts must exist first. Without dependencies, an agent could add eyes before there is a head!';
  else if (/\b(real|ai|model|llm)\b/.test(q)) response = 'In local mode all five agents follow rules, not language models. A selected cloud or local model can interpret the brief; all five agents still work locally. Our messages explain program decisions, not hidden model thoughts.';
  else if (!agent && !/who|what|job|help|team|wait|frame|detail|build|structure|planbot|checkbot|inspect|quality|dependencies/.test(q)) response = 'I’m a local teaching guide, not an open-ended chat model. Ask about our jobs, dependencies, the brief, repair, AI mode, or cost.';
  answerSource = { id, response };
  $('#crew-answer').textContent = `${AGENTS[id].name}: ${translate(response)}`;
}
$('#ask-roles').addEventListener('click', () => answer('Who does what?'));
$('#ask-wait').addEventListener('click', () => answer('', 'detail'));
$('#ask-interior').addEventListener('click', () => answer('How can a model be hollow?'));
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
  const payload = { ...(hasSceneAppend ? snapshotSceneAppend(team, activeBrief) : team.snapshot(activeBrief)), explanation: 'Original stylized brick grid. Not official LEGO instructions or a physical stability guarantee.', source: team.plan.source };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  link.download = `bricklab-${team.plan.spec.model}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
});
function loadWorldExample(exampleWorld: World) {
  if (planning) return;
  try {
    const plan = createPlan(worldExample(exampleWorld, translate), ['This themed world is a deterministic local example, not a model result.'], 'local');
    const example = new Team(plan);
    mode = 'local'; modeChosen = true; updateMode();
    if (world !== plan.spec.world) switchWorld(plan.spec.world);
    running = false; replaying = false;
    team = example;
    hasSceneAppend = false;
    activeBrief = translate(exampleWorld === 'jurassic' ? 'Original local Jurassic herd example' : 'Original local space fleet example');
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
    const appended = !!data && typeof data === 'object' && 'sceneAppend' in data;
    const loaded = isMission ? loadAIMission(data) : appended ? restoreSceneAppend(data) : restoreSnapshot(data);
    if (loaded.team.plan.spec.world !== world) switchWorld(loaded.team.plan.spec.world);
    running = false;
    replaying = false;
    team = loaded.team;
    hasSceneAppend = appended && !isMission;
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
  <ol><li><strong>Imagine:</strong> name the species or ship type, body color, and a feature.</li><li><strong>Plan:</strong> BuildBot delegates jobs. Open the task board to inspect dependencies and handoffs.</li><li><strong>Build:</strong> approve the plan, pause, step one turn, or fast-forward at 4× and 16×. Choose <strong>Add to scene</strong> to grow the build without replacing it.</li><li><strong>Experiment:</strong> hide about a third of the bricks, ask for a repair, or replay the placement timeline. Repair cannot fix a disconnected blueprint.</li></ol>
  <p>Try a purple brachiosaurus, a green stegosaurus with a long tail, or a white cargo ship; add a second object and compare the team’s handoffs. With a configured AI planner, try a lighthouse or a space station with a visiting ship.</p>
  <p>${esc(translate('Try the hollow-interior preference with custom planning, then use Cutaway view to inspect the cross-section. It is a preference, not a guarantee; connectivity checks do not prove physical stability.'))}</p>
  <details><summary>Planning choices and privacy</summary>
    <p>${hosted ? 'The hosted demo sends your brief and any image you explicitly consent to share to Azure when you choose Plan. No visitor sign-in is required. Voice transcription runs in your browser; only text you review and apply to the brief is sent with a later planning request. No input is sent on page load or while selecting media.' : 'Cloud Copilot planning is the default: describe any static brick design, not just these themes. Pressing Send brief to Copilot sends the brief to GitHub and may consume quota.'} No model request happens on load.</p>
    <p>Explicit offline template mode supports <strong>stegosaurus and brachiosaurus</strong>, both from the Jurassic, and explorer/cargo ships. Body colors: green, orange, blue, purple, red, white. Features: long tail, wide wings. You can add “budget 500 bricks”. Other requests may not change these templates. Guided demos and local examples use no model calls.</p>
    <p>Additional offline template body colors: black, yellow, gray, brown and pink.</p>
    <p>Copilot and optional Local AI must return custom geometry; template responses fail visibly. Five local agents coordinate, verify, build and inspect the result. Messages explain decisions, not private model reasoning.</p>
  </details>
  <details><summary>Timing and design limits</summary>
    <p>${hosted ? 'Hosted Azure planning can take up to 300 seconds. You can abort the request while it is running.' : 'Copilot planning shows elapsed time and a rough study-based estimate, and offers abort or continued waiting at 100 and 200 seconds; the same request stops after at most 300 seconds. Azure planning can take up to 300 seconds.'} Local AI has a separate 90-second limit.</p>
    <p>Try the local herd and fleet examples for separate named objects. Normal designs target up to 1,000 pieces and 32,768 occupied cells. Advanced designs allow up to 8,192 pieces and 262,144 cells; large builds may be slow. Decorative studs are sampled above 8,192 per model or blueprint; all brick bodies remain present and selectable.</p>
    <p>Models are stylized original geometry. Connected bricks do not imply real-world clutch, stability, or flight. Saves stay in this browser.</p>
  </details>`));
$('#settings').addEventListener('click', () => {
  dialog('Choose how the team plans', `
    ${hosted || azurePlanner.enabled ? `<p><strong>${hosted ? 'Hosted Azure demo' : 'Azure Foundry planner'}</strong> — a separate service from GitHub Copilot. ${hosted ? 'No visitor sign-in is required. Pressing Plan sends your brief and any explicitly consented image to Azure. Audio stays in the browser; only reviewed text you apply to the brief is included. No input is sent on page load or when selecting media.' : 'Private Azure planning requires Entra sign-in. An explicit planning action sends the brief to Azure. No model request happens on load. Do not enter personal information.'}</p>
    <p id="azure-planner-status" role="status">${esc(translate(azurePlanner.message))}</p>
    <p>${esc(translate('One submission may use two model requests to correct an invalid design; the daily allowance counts submissions.'))}</p>
    ${hosted && publicAllowance ? `<p id="public-allowance" role="status">${esc(publicAllowance)}</p>` : ''}
    <button id="choose-azure" class="button primary">Use Azure Foundry planning</button><hr>` : ''}
    ${!hosted ? `
    <p><strong>GitHub Copilot cloud planner (default)</strong> — one CLI planning invocation per explicit submission proposes custom geometry for your brief, within workspace and count limits. All five agents execute locally, not as separate LLMs.</p>
    <p>${esc(translate('Your brief is sent through the authenticated Copilot CLI to GitHub’s model service. No agent tools are allowed. The app does not know the model’s dollar cost. Local servers and Codespaces have no application daily request quota; provider subscription quotas still apply.'))}</p>
    <p>${esc(translate('Each planning submission allows one initial design and at most one correction of invalid geometry, using the same provider and deadline. Network, authentication, rate-limit and timeout failures are not replayed. No template fallback is used. Hosted allowance counts submissions, not model requests: 50 submissions can make up to 100 model requests per UTC day. Copilot CLI may retry internally.'))}</p>
    <p id="planner-status" role="status">${esc(translate(plannerMessage))}</p>
    <p>Install the Copilot CLI, run <code>copilot login</code>, and start the server with <code>BRICKLAB_COPILOT=1 npm run dev</code>. Pressing <strong>Send brief to Copilot</strong> consents to sending that brief. Selecting a mode or loading the page sends no brief; readiness does not verify login, subscription, or live access. Do not enter personal information.</p>
    <button id="choose-copilot" class="button primary">Use Copilot planning</button>
    <hr><p><strong>Local AI (Ollama)</strong> — optional original custom planning on the <strong>BrickLab server host</strong>, not automatically on this browser's device. In a Codespace it runs on that remote host. Configure Ollama with <code>OLLAMA_NO_CLOUD=1</code> and a downloaded local model first. Loopback alone does not prove offline operation; remote model metadata is rejected, but the configured service must be trusted.</p>
    <p id="local-planner-status" role="status">${esc(translate(localPlanner.message))}</p>
    <p>Start BrickLab with <code>BRICKLAB_LOCAL_AI=1 BRICKLAB_LOCAL_MODEL=YOUR_MODEL</code>. No automatic installs, model downloads, cloud fallback or template fallback. Initial downloads need network access; planning needs device-dependent memory and compute.</p>
    <button id="choose-local-ai" class="button outline">Use Local AI</button>
    <hr><p>Compatible AI is a separately configured server-side provider. An explicit planning request sends your brief to its configured service and may incur charges. Do not enter personal information. No request is sent on page load or mode selection.</p>
    <p id="compatible-planner-status" role="status">${esc(translateActivity(compatiblePlanner.message))}</p>
    <button id="choose-compatible" class="button outline">Use Compatible AI</button>` : ''}
    <hr><p><strong>Offline templates</strong> — explicitly choose deterministic stegosaurus, brachiosaurus, explorer and cargo presets. This is not open-ended AI. Runs offline after loading; no model calls.${hosted ? '' : ' Host charges may still apply.'}</p>
    <button id="choose-local" class="button outline">Use offline templates</button>
    <button id="refresh-status" class="button outline">Retry status</button>
    ${hosted ? '' : `
    <hr><p><strong>Three model decisions via GitHub Actions</strong> — the included <code>ai-mission.yml</code> workflow calls one coordinator model, then two builder models concurrently. Each chooses a real task priority. PlanBot and CheckBot remain local rule-based agents, making five crew members, not five model calls. Download its <code>ai-mission.json</code> artifact and use <strong>Load build / AI mission</strong> below to watch the resulting team execute.</p>
    <p>This workflow needs repository access and GitHub Models availability. It has not been live-verified in this environment. It uses three bounded requests, no additional model keys, and no model tools. Do not enter personal information in workflow inputs.</p>
    `}<p>Mode changes apply to the next plan. Existing builds are not sent anywhere.</p>`);
  $('#choose-local').addEventListener('click', () => { mode = 'local'; modeChosen = true; clearNotice(); updateMode(); $<HTMLDialogElement>('#info-dialog').close(); });
  document.querySelector<HTMLElement>('#choose-copilot')?.addEventListener('click', () => { mode = 'copilot'; modeChosen = true; clearNotice(); updateMode(); $<HTMLDialogElement>('#info-dialog').close(); if (!copilotEnabled) notice(plannerMessage); });
  document.querySelector<HTMLElement>('#choose-local-ai')?.addEventListener('click', () => { mode = 'local-ai'; modeChosen = true; clearNotice(); updateMode(); $<HTMLDialogElement>('#info-dialog').close(); if (localPlanner.state !== 'configured') notice(localPlanner.message); });
  document.querySelector<HTMLElement>('#choose-compatible')?.addEventListener('click', () => { mode = 'compatible'; modeChosen = true; clearNotice(); updateMode(); $<HTMLDialogElement>('#info-dialog').close(); if (!compatiblePlanner.enabled) notice(compatiblePlanner.message); });
  document.querySelector<HTMLElement>('#choose-azure')?.addEventListener('click', () => { mode = 'azure'; modeChosen = true; clearNotice(); updateMode(); $<HTMLDialogElement>('#info-dialog').close(); if (!azurePlanner.enabled) notice(azurePlanner.message); });
  document.querySelector<HTMLElement>('#refresh-status')?.addEventListener('click', () => { void refreshStatus(true); });
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
window.addEventListener('beforeunload', () => { planningController?.abort(); voiceInput?.cancel(); save(); });
window.addEventListener('pagehide', () => { planningController?.abort(); voiceInput?.cancel(); });
restore();
render();
function updateMode() {
  $<HTMLInputElement>('#hollow-interior').disabled = planning || mode === 'local';
  $<HTMLSelectElement>('#scene-size').disabled = planning || mode === 'local';
  updateSceneSize();
  imageInput?.refresh(true);
  $('#mode-label').textContent = mode === 'local' ? 'Offline templates · rule-based agents' : mode === 'local-ai' ? 'Local AI · server-host model' : mode === 'compatible' ? 'Compatible AI · custom designs' : mode === 'azure' ? 'Azure Foundry planning · custom designs' : 'Copilot cloud planning · custom designs';
  $('#brief-help').textContent = mode === 'local'
    ? 'Offline template mode builds dinosaur and spaceship templates only; other ideas may be mapped to a template.'
    : hosted
      ? `This hosted demo uses Azure Foundry. Voice transcription stays in your browser; only text you review and apply to the brief is sent when you press Plan. Any selected image is sent only with image consent and Plan.${publicAllowance ? ` ${publicAllowance}` : ''}`
    : mode === 'compatible'
      ? 'Plan with Compatible AI sends this brief to the configured service and may incur charges. No request until you press it. Do not enter personal information.'
    : mode === 'local-ai'
      ? 'Plan with Local AI sends this brief to the configured Ollama on the BrickLab server host, not automatically your device. Requires a trusted local-only service; no cloud fallback.'
      : mode === 'azure'
        ? `${hosted ? 'No visitor sign-in is required. ' : 'Private planning requires Entra sign-in. '}Pressing Plan with Azure Foundry sends your brief to Azure and may incur charges for the service owner. Do not enter personal information.${publicAllowance ? ` ${publicAllowance}` : ''}`
        : 'Send brief to Copilot sends your instructions to GitHub and may consume quota. No request until you press it. Describe any static brick design; do not enter personal information.';
  $('#plan').innerHTML = `${mode === 'local' ? 'Make a plan' : mode === 'compatible' ? 'Plan with Compatible AI' : mode === 'local-ai' ? 'Plan with Local AI' : mode === 'azure' ? 'Plan with Azure Foundry' : 'Send brief to Copilot'} ${icon('arrow')}`;
  brief.placeholder = mode === 'local' ? 'Describe a dinosaur or spaceship template…' : 'Describe your brick design…';
}
async function refreshStatus(inDialog = false) {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Server status returned ${response.status}`);
    const data = await response.json();
    apiKey = typeof data.sessionKey === 'string' ? data.sessionKey : '';
    copilotEnabled = data.copilot === true;
    copilotImagesEnabled = data.copilotImages === true && data.hosted !== true;
    plannerState = typeof data.planner?.state === 'string' ? data.planner.state : 'unavailable';
    plannerMessage = typeof data.planner?.message === 'string' ? data.planner.message : 'Planner status unavailable.';
    if (data.localPlanner && typeof data.localPlanner.message === 'string')
      localPlanner = { enabled: data.localPlanner.enabled === true, state: String(data.localPlanner.state), message: data.localPlanner.message };
    if (data.azurePlanner && typeof data.azurePlanner.message === 'string')
      azurePlanner = { enabled: data.azurePlanner.enabled === true, state: String(data.azurePlanner.state),
        authentication: data.azurePlanner.authentication === 'anonymous' ? 'anonymous' : 'entra', message: data.azurePlanner.message };
    azureImagesEnabled = data.azureImages === true;
    if (data.compatiblePlanner && typeof data.compatiblePlanner.message === 'string')
      compatiblePlanner = { enabled: data.compatiblePlanner.enabled === true, state: String(data.compatiblePlanner.state), message: data.compatiblePlanner.message };
    hosted = data.hosted === true;
    const allowance = data.publicAllowance;
    publicAllowance = hosted
      ? allowance && Number.isInteger(allowance.remaining) && Number.isInteger(allowance.limit)
        && allowance.limit > 0 && allowance.remaining >= 0 && allowance.remaining <= allowance.limit
        ? `${allowance.remaining} of ${allowance.limit} shared planning attempts remain today (UTC). Snapshot only; other visitors can use them.`
        : 'Shared daily planning count is currently unavailable.'
      : '';
    if (hosted && !modeChosen) { mode = 'azure'; updateMode(); }
    else if (mode === 'azure') updateMode();
    imageInput?.refresh();
    if (!inDialog && mode === 'azure' && !azurePlanner.enabled) notice(azurePlanner.message);
    else if (!inDialog && mode === 'copilot' && !copilotEnabled) notice(plannerMessage);
  } catch (error) {
    apiKey = '';
    copilotEnabled = false;
    copilotImagesEnabled = false;
    azureImagesEnabled = false;
    imageInput?.refresh(true);
    plannerState = 'unavailable';
    plannerMessage = `Local server status unavailable: ${error instanceof Error ? error.message : 'unknown error'}. Rule-based building still works.`;
    if (!inDialog && mode !== 'local') notice(plannerMessage);
  }
  if (inDialog) {
    const status = document.querySelector<HTMLElement>('#planner-status');
    if (status) status.textContent = translateActivity(plannerMessage);
    const localStatus = document.querySelector<HTMLElement>('#local-planner-status');
    if (localStatus) localStatus.textContent = translate(localPlanner.message);
    const azureStatus = document.querySelector<HTMLElement>('#azure-planner-status');
    if (azureStatus) azureStatus.textContent = translate(azurePlanner.message);
    const compatibleStatus = document.querySelector<HTMLElement>('#compatible-planner-status');
    if (compatibleStatus) compatibleStatus.textContent = translateActivity(compatiblePlanner.message);
  }
  return apiKey;
}
updateMode();
void refreshStatus();
