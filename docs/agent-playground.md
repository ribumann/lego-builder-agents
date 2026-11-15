# Agent playground

The optional playground is a separate, local educational simulation. Its six roles
use deterministic application tools, not six language models. It never requests a
provider, uses the microphone, uploads an image, or changes the main workshop's
plans, saves, or provider settings.

## What to try

Open **The agent playground**. Use **One step** to inspect each handoff, or
**Build a new robot** to play automatically. Selecting an agent pauses playback.
Selecting a tool call pauses and replays the exact recorded workshop state;
**Return to live build** restores the latest state.

- **Robot:** the detail builder deliberately places one eye too low. Independent
  inspection detects the actual coordinate mismatch, the repair lead moves it,
  and only a second inspection can approve completion.
- **Missing brick:** an unavailable arm blocks its entire task without partial
  placement. The player can ask the coordinator to build independent head and
  detail tasks first, then supply the missing brick and resume.
- **Impossible plan:** a circular dependency prevents all placement. Removing
  the bad instruction does not authorize construction until the verifier checks
  the revised graph.

The inspector separates callable **Tools**, shared operational **Context**, and
opt-in **Memory**. Tool inputs and outputs are structured data, not hidden model
reasoning. Recorded snapshots preserve inventory and dependencies as they were
at that action, even after a later correction.

## Remembering a repair

After a successfully inspected repair, **Remember this repair** stores one
versioned rule in `bricklab-agent-playground-memory-v1` in this browser's
local storage. No lesson is saved automatically. The next new lab build explicitly
recalls that rule before building and aligns the eyes correctly, avoiding repair.
This changes application behavior; it does not train a model.

**Forget saved lesson** removes only that key and affects future builds. It does
not rewrite the history of the current build. Storage failures are disclosed;
the game still runs without persistent memory. A malformed lesson can be
explicitly cleared from the Memory tab.

## Mounting

```ts
import { mountAgentPlayground } from './agent-playground';

const playground = mountAgentPlayground(hostElement, { language });
playground.setLanguage(language);
// When the host is removed:
playground.dispose();
```

The module imports its scoped stylesheet. The handle supports the application's
six languages. Its disclosure starts closed, playback starts only after user
action, closing it stops playback, and disposal removes its timer and listeners.
Keyboard tabs support Left/Right/Home/End. Reduced-motion preferences disable
transitions. No React migration or additional runtime dependency is needed.
