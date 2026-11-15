import {
  AgentPlayground, PLAYGROUND_AGENTS, PLAYGROUND_TOOLS, ROBOT_BLUEPRINT,
  type PlaygroundAgent, type PlaygroundEvent, type PlaygroundScenario,
} from './agent-playground-engine';
import { PLAYGROUND_COPY, type PlaygroundLanguage } from './agent-playground-copy';
import './agent-playground.css';

const MEMORY_KEY = 'bricklab-agent-playground-memory-v1';
const AGENT_MARKS: Record<PlaygroundAgent, string> = {
  coordinator: '01', verifier: '02', structure: '03', detail: '04', inspector: '05', repair: '06',
};
let mountNumber = 0;
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);
const json = (value: unknown) => escape(JSON.stringify(value, null, 2));

export interface AgentPlaygroundHandle {
  setLanguage(language: PlaygroundLanguage): void;
  dispose(): void;
}

/** Mounts an isolated educational lab; never reads or changes the main workshop or provider settings. */
export function mountAgentPlayground(
  container: HTMLElement, options: { language?: PlaygroundLanguage } = {},
): AgentPlaygroundHandle {
  const prefix = `agent-lab-${++mountNumber}`;
  let language = options.language ?? 'en';
  let savedLesson = false;
  let memoryError = false;
  try {
    const stored = localStorage.getItem(MEMORY_KEY);
    if (stored !== null) {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed !== 'object' || parsed === null || !('lesson' in parsed)
        || parsed.lesson !== 'align-eyes' || !('version' in parsed) || parsed.version !== 1) {
        throw new Error('Unsupported playground memory');
      }
      savedLesson = true;
    }
  } catch (error) {
    console.warn('BrickLab playground memory could not be read.', error);
    memoryError = true;
  }
  let lab = new AgentPlayground('robot', savedLesson);
  let nextScenario: PlaygroundScenario = 'robot';
  let selectedAgent: PlaygroundAgent = 'coordinator';
  let selectedTab: 'tools' | 'context' | 'memory' = 'tools';
  let selectedEvent: number | null = null;
  let replay = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  container.innerHTML = `
    <details class="agent-lab" data-agent-playground>
      <summary><span class="lab-summary-mark" aria-hidden="true">6</span><strong data-copy="title"></strong><span aria-hidden="true">↗</span></summary>
      <div class="lab-body">
        <p class="lab-intro" data-copy="intro"></p>
        <div class="lab-toolbar">
          <label><span data-copy="scenario"></span><select data-lab-scenario>
            <option value="robot"></option><option value="missing"></option><option value="dependency"></option>
          </select></label>
          <button type="button" class="lab-primary" data-lab-action="start" data-copy="start"></button>
          <div class="lab-playback">
            <button type="button" data-lab-action="play"></button>
            <button type="button" data-lab-action="step" data-copy="step"></button>
          </div>
        </div>
        <p class="lab-status" role="status" aria-live="polite"></p>
        <div class="lab-grid">
          <section class="lab-workshop" aria-labelledby="${prefix}-workshop">
            <div class="lab-section-heading"><h3 id="${prefix}-workshop" data-copy="workshop"></h3><span data-lab-progress></span></div>
            <div class="lab-stage"></div>
            <div class="lab-intervention"></div>
          </section>
          <section class="lab-team" aria-labelledby="${prefix}-team">
            <h3 id="${prefix}-team" data-copy="team"></h3><div class="lab-agent-list"></div>
          </section>
          <section class="lab-conversation" aria-labelledby="${prefix}-conversation">
            <div class="lab-section-heading"><h3 id="${prefix}-conversation" data-copy="conversation"></h3>
              <button type="button" data-lab-action="live" data-copy="live" hidden></button></div>
            <p class="lab-hint" data-copy="hint"></p>
            <ol class="lab-log"></ol>
          </section>
          <section class="lab-inspector" aria-labelledby="${prefix}-inspector">
            <h3 id="${prefix}-inspector" data-copy="inspector"></h3>
            <div class="lab-agent-heading"></div>
            <div class="lab-tabs" role="tablist">
              ${(['tools', 'context', 'memory'] as const).map(tab => `<button type="button" role="tab" id="${prefix}-${tab}" aria-controls="${prefix}-panel" data-lab-tab="${tab}" data-copy="${tab}"></button>`).join('')}
            </div>
            <div class="lab-inspector-panel" id="${prefix}-panel" role="tabpanel" tabindex="0"></div>
            <div class="lab-tool-detail"></div>
          </section>
        </div>
      </div>
    </details>`;
  const root = container.querySelector<HTMLDetailsElement>('.agent-lab')!;
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

  function pause() {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }

  function advance() {
    replay = false;
    const event = lab.step();
    if (event) {
      selectedEvent = event.id;
      selectedAgent = event.agent;
    }
    if (lab.phase === 'complete' || lab.phase === 'blocked') pause();
    render();
  }

  function play() {
    if (timer !== undefined || lab.phase === 'blocked' || lab.phase === 'complete') return;
    timer = setInterval(advance, 900);
    advance();
  }

  function persistLesson(forget: boolean) {
    try {
      if (forget) localStorage.removeItem(MEMORY_KEY);
      else localStorage.setItem(MEMORY_KEY, JSON.stringify({ version: 1, lesson: 'align-eyes' }));
      savedLesson = !forget;
      memoryError = false;
    } catch (error) {
      console.warn('BrickLab playground memory could not be changed.', error);
      memoryError = true;
    }
    selectedTab = 'memory';
    render();
    get<HTMLButtonElement>('[data-lab-tab="memory"]').focus({ preventScroll: true });
  }

  function stage(event: PlaygroundEvent | undefined) {
    const copy = PLAYGROUND_COPY[language];
    const parts = event ? event.placed : [...lab.placed.values()];
    const byId = new Map(parts.map(part => [part.id, part]));
    const tasks = event?.tasks ?? lab.tasks;
    const task = tasks.find(item => item.id === event?.task);
    const lines = event?.tool === 'check_dependencies' && task
      ? task.depends.flatMap(id => {
        const from = ROBOT_BLUEPRINT.find(part => part.id === tasks.find(item => item.id === id)?.parts[0]);
        const to = ROBOT_BLUEPRINT.find(part => part.id === task.parts[0]);
        return from && to ? [`<line class="lab-dependency" x1="${from.x + from.width / 2}" y1="${from.y}" x2="${to.x + to.width / 2}" y2="${to.y + to.height}" marker-end="url(#${prefix}-arrow)"/>`] : [];
      }).join('') : '';
    const affected = new Set(event?.affected ?? []);
    const resultClass = event?.result === 'defect' || event?.result === 'cycle' || event?.result === 'missing'
      ? 'lab-error' : event?.result === 'repaired' ? 'lab-repaired' : '';
    get('.lab-stage').innerHTML = `
      <svg class="lab-robot" viewBox="0 0 320 338" role="img" aria-label="${escape(copy.workshop)} · ${parts.length}/${ROBOT_BLUEPRINT.length}">
        <defs><pattern id="${prefix}-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#719a90" stroke-opacity=".22"/></pattern>
        <marker id="${prefix}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#254f75"/></marker></defs>
        <rect width="320" height="338" fill="url(#${prefix}-grid)"/>
        <path d="M38 310H282" stroke="#567e72" stroke-width="2"/>
        ${ROBOT_BLUEPRINT.map(expected => {
          const part = byId.get(expected.id);
          const actual = part ?? expected;
          const highlight = affected.has(expected.id) ? `lab-affected ${resultClass}` : '';
          return `<g class="lab-part ${part ? 'lab-placed' : 'lab-ghost'} ${highlight}" data-part="${expected.id}" data-y="${actual.y}">
            <rect x="${actual.x}" y="${actual.y}" width="${actual.width}" height="${actual.height}" rx="3" fill="${part ? part.color : 'none'}"/>
            ${part && actual.width > 24 ? `<path d="M${actual.x + 8} ${actual.y + 8}h${actual.width - 16}" stroke="#fff" stroke-opacity=".38" stroke-width="3" stroke-linecap="round"/>` : ''}
          </g>`;
        }).join('')}
        ${lines}
      </svg>
      <p class="lab-stage-caption">${replay && event ? `${escape(copy.replay)} ${event.id}` : escape(copy.phases[lab.phase])}</p>`;
    get('[data-lab-progress]').textContent = `${parts.length} / ${ROBOT_BLUEPRINT.length}`;
  }

  function render() {
    if (disposed) return;
    const copy = PLAYGROUND_COPY[language];
    const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
      ? document.activeElement : null;
    const focusKey = active?.getAttribute('data-lab-agent') ? `[data-lab-agent="${active.dataset.labAgent}"]`
      : active?.getAttribute('data-lab-tab') ? `[data-lab-tab="${active.dataset.labTab}"]`
      : active?.getAttribute('data-lab-event') ? `[data-lab-event="${active.dataset.labEvent}"]`
      : active?.getAttribute('data-lab-action') ? `[data-lab-action="${active.dataset.labAction}"]` : null;
    for (const element of root.querySelectorAll<HTMLElement>('[data-copy]')) {
      const key = element.dataset.copy as keyof typeof copy;
      const value = copy[key];
      if (typeof value === 'string') element.textContent = value;
    }
    get('[role="tablist"]').setAttribute('aria-label', copy.inspector);
    const scenarioSelect = get<HTMLSelectElement>('[data-lab-scenario]');
    for (const option of scenarioSelect.options) option.textContent = copy.scenarios[option.value as PlaygroundScenario];
    scenarioSelect.value = nextScenario;
    get('[data-lab-action="play"]').textContent = timer !== undefined ? copy.pause : copy.run;
    get<HTMLButtonElement>('[data-lab-action="play"]').disabled = lab.phase === 'blocked' || lab.phase === 'complete';
    get<HTMLButtonElement>('[data-lab-action="step"]').disabled = timer !== undefined || lab.phase === 'blocked' || lab.phase === 'complete';
    get('[data-lab-action="live"]').hidden = !replay;
    const event = lab.events.find(item => item.id === selectedEvent);
    get('.lab-status').textContent = memoryError ? copy.memoryError : lab.phase === 'complete'
      ? lab.lessonApplied ? copy.completeLearned : savedLesson ? copy.saved : copy.complete
      : `${copy.phases[lab.phase]}${event && !replay ? ` · ${copy.results[event.result]}` : ''}`;
    stage(event);
    get('.lab-intervention').innerHTML = `
      ${lab.canReplan ? `<button type="button" data-lab-action="replan">${escape(copy.replan)}</button>` : ''}
      ${lab.scenario === 'missing' && lab.inventory.get('right-arm') === 0 && !lab.placed.has('right-arm')
        ? `<button type="button" data-lab-action="restock">${escape(copy.restock)}</button>` : ''}
      ${lab.blocker === 'dependency' ? `<button type="button" data-lab-action="revise">${escape(copy.revise)}</button>` : ''}
      ${lab.canRememberRepair() && !savedLesson && !memoryError ? `<button type="button" data-lab-action="remember">${escape(copy.remember)}</button>` : ''}`;
    get('.lab-agent-list').innerHTML = PLAYGROUND_AGENTS.map(agent => {
      const last = [...lab.events].reverse().find(item => item.agent === agent);
      return `<button type="button" class="lab-agent" data-lab-agent="${agent}" aria-pressed="${agent === selectedAgent}">
        <span class="lab-agent-mark lab-agent-${agent}" aria-hidden="true">${AGENT_MARKS[agent]}</span>
        <span><strong>${escape(copy.agentNames[agent])}</strong><small>${escape(last ? `${copy.lastAction} ${last.id}` : copy.waiting)}</small></span>
      </button>`;
    }).join('');
    const log = get<HTMLOListElement>('.lab-log');
    const oldScroll = log.scrollTop;
    const nearBottom = oldScroll + log.clientHeight >= log.scrollHeight - 40;
    log.innerHTML = lab.events.length ? lab.events.map(item => `<li>
      <button type="button" class="lab-event" data-lab-event="${item.id}" aria-pressed="${item.id === selectedEvent}">
        <span class="lab-event-who"><b>${escape(copy.agentNames[item.agent])}</b><span>${String(item.id).padStart(2, '0')}</span></span>
        <code>${item.tool}(${item.task ? `"${escape(item.task)}"` : '…'})</code>
        <span class="lab-event-result">${escape(copy.results[item.result])}</span>
      </button></li>`).join('') : `<li class="lab-empty">${escape(copy.empty)}</li>`;
    log.scrollTop = !replay && nearBottom ? log.scrollHeight : oldScroll;
    get('.lab-agent-heading').innerHTML = `<strong>${escape(copy.agentNames[selectedAgent])}</strong><p>${escape(copy.agentRoles[selectedAgent])}</p>`;
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-lab-tab]')) {
      const isSelected = tab.dataset.labTab === selectedTab;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
    }
    const panel = get('.lab-inspector-panel');
    panel.setAttribute('aria-labelledby', `${prefix}-${selectedTab}`);
    if (selectedTab === 'tools') {
      panel.innerHTML = `<ul class="lab-tool-list">${PLAYGROUND_TOOLS[selectedAgent].map(tool =>
        `<li><code>${tool}()</code><span>${escape(copy.toolLabels[tool])}</span></li>`).join('')}</ul>`;
    } else if (selectedTab === 'context') {
      const snapshot = event;
      const placed = snapshot?.placed ?? [...lab.placed.values()];
      const inventory = snapshot?.inventory ?? Object.fromEntries(lab.inventory);
      const assignments = (snapshot?.tasks ?? lab.tasks).filter(task => selectedAgent === 'coordinator'
        || selectedAgent === 'verifier' || selectedAgent === 'inspector' || selectedAgent === 'repair' || task.agent === selectedAgent);
      panel.innerHTML = `<p>${escape(copy.shared)}</p>
        <dl class="lab-context"><dt>${escape(copy.blueprint)}</dt><dd><code>robot-v1</code></dd>
        <dt>${escape(copy.progress)}</dt><dd>${placed.length} / ${ROBOT_BLUEPRINT.length}</dd></dl>
        <details><summary>${escape(copy.inventory)}</summary><pre>${json(inventory)}</pre></details>
        <details><summary>${escape(copy.assignment)}</summary><pre>${json(assignments.map(task => ({
          task: task.id, depends: task.depends, done: task.parts.every(id => placed.some(part => part.id === id)),
        })))}</pre></details>`;
    } else {
      panel.innerHTML = `<p>${escape(memoryError ? copy.memoryError : savedLesson ? copy.lesson : copy.noLesson)}</p>
        <p>${escape(lab.lessonApplied ? copy.recalled : copy.notRecalled)}</p><p class="lab-hint">${escape(copy.memoryNote)}</p>
        ${lab.canRememberRepair() && !savedLesson && !memoryError ? `<button type="button" data-lab-action="remember">${escape(copy.remember)}</button>` : ''}
        ${savedLesson || memoryError ? `<button type="button" data-lab-action="forget">${escape(copy.forget)}</button>` : ''}`;
    }
    get('.lab-tool-detail').innerHTML = event ? `
      <h4>${escape(copy.toolLabels[event.tool])} <span>· ${event.id}</span></h4>
      <p><strong>${escape(copy.agentNames[event.agent])}</strong></p>
      <p>${escape(copy.results[event.result])}</p>
      <details><summary>${escape(copy.input)} <code>${event.tool}()</code></summary><pre>${json(event.input)}</pre></details>
      <details><summary>${escape(copy.output)}</summary><pre>${json(event.output)}</pre></details>` : '';
    if (focusKey) root.querySelector<HTMLElement>(focusKey)?.focus({ preventScroll: true });
  }

  function click(event: MouseEvent) {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!button || !root.contains(button) || button.disabled) return;
    if (button.dataset.labAgent) {
      selectedAgent = button.dataset.labAgent as PlaygroundAgent;
      pause();
    } else if (button.dataset.labTab) {
      selectedTab = button.dataset.labTab as typeof selectedTab;
    } else if (button.dataset.labEvent) {
      pause();
      replay = true;
      selectedEvent = Number(button.dataset.labEvent);
      selectedAgent = lab.events.find(item => item.id === selectedEvent)!.agent;
    } else {
      switch (button.dataset.labAction) {
        case 'start':
          pause();
          lab = new AgentPlayground(nextScenario, savedLesson && !memoryError);
          selectedEvent = null;
          replay = false;
          play();
          return;
        case 'play': if (timer !== undefined) pause(); else { play(); return; } break;
        case 'step': advance(); return;
        case 'live': replay = false; selectedEvent = lab.events.at(-1)?.id ?? null; break;
        case 'remember': if (lab.canRememberRepair()) persistLesson(false); return;
        case 'forget': persistLesson(true); return;
        case 'replan':
        case 'restock':
        case 'revise': {
          pause();
          const result = button.dataset.labAction === 'replan' ? lab.replan()
            : button.dataset.labAction === 'restock' ? lab.restock() : lab.revisePlan();
          if (result) { selectedEvent = result.id; selectedAgent = result.agent; replay = false; }
          break;
        }
      }
    }
    render();
  }

  function change(event: Event) {
    if (event.target instanceof HTMLSelectElement && event.target.matches('[data-lab-scenario]')) {
      nextScenario = event.target.value as PlaygroundScenario;
    }
  }

  function keydown(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement) || !event.target.matches('[role="tab"]')) return;
    const tabs = ['tools', 'context', 'memory'] as const;
    const current = tabs.indexOf(selectedTab);
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectedTab = event.key === 'Home' ? 'tools' : event.key === 'End' ? 'memory'
      : tabs[(current + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    render();
    get<HTMLButtonElement>(`[data-lab-tab="${selectedTab}"]`).focus();
  }

  function toggle() {
    if (!root.open) { pause(); render(); }
  }
  function pagehide() { pause(); render(); }
  root.addEventListener('click', click);
  root.addEventListener('change', change);
  root.addEventListener('keydown', keydown);
  root.addEventListener('toggle', toggle);
  window.addEventListener('pagehide', pagehide);
  render();
  return {
    setLanguage(value) { language = value; render(); },
    dispose() {
      pause();
      disposed = true;
      root.removeEventListener('click', click);
      root.removeEventListener('change', change);
      root.removeEventListener('keydown', keydown);
      root.removeEventListener('toggle', toggle);
      window.removeEventListener('pagehide', pagehide);
      container.replaceChildren();
    },
  };
}
