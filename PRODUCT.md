# BrickLab

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Children aged 11-15 learning about AI agents, with a teacher or parent facilitating. Age range and workshop intent come from the reference post supplied by the user.

## Product Purpose
Demonstrate autonomous coordination by building original brick models, including dinosaur and spacecraft templates, in a Jurassic or space setting.

## Positioning
A visible coordinator works with a plan verifier, two builders sharing structure and detail work, and an inspection/repair lead; learners can inspect their shared task board, grow a scene, and observe verification and repair.

## Operating Context
Browser application with a Node server. Local and offline use require no Azure service. Public hosted operation and its paid planner require separately verified Azure protections and configuration.

## Capabilities and Constraints
- Default planning choice is cloud Copilot, with explicit server opt-in and per-brief submission; no model requests on load. Five-agent execution is transparent and deterministic, not five model conversations.
- The optional imported workflow has three model decisions, not five model calls: the plan verifier and quality inspector remain rule-based.
- Optional GitHub Copilot CLI planning uses the user's authenticated subscription, with explicit opt-in and a bounded request count. Actual model charges are unknown.
- Azure Foundry is a separate optional provider, not GitHub Copilot. Public hosted planning is disabled until edge abuse controls and transport behavior are verified. No personal Copilot credentials belong in a public deployment.
- Add to scene preserves existing work and provenance; additions must fit the combined validation limits and receive a collision-free local offset.
- Copilot and optional Local AI require custom static geometry for arbitrary briefs, including familiar subjects. Template responses fail explicitly without retries or fallback. Offline templates are a separate explicit choice.
- Optional Ollama runs on the BrickLab server host, not automatically the browser device. It requires a trusted local-only service with cloud disabled and a manually downloaded model. Numeric loopback, remote-model metadata checks and bounded requests protect the app boundary; metadata cannot prove service internals. No runtime/model downloads happen automatically.
- Deterministic local dinosaur-herd and spacecraft-fleet examples demonstrate named multi-object worlds without model calls. Normal designs target at most 1,000 pieces and 32,768 occupied cells; advanced designs allow up to 8,192 pieces and 262,144 cells within bounded coordinates. Performance varies by device.
- No required local models, downloaded brand assets or provisioned cloud infrastructure.
- Original brick geometry, not official LEGO assets or affiliation.
- Local persistence and downloadable builds; no accounts or public sharing.

## Evidence on Hand
User-provided text of a LinkedIn post describing BauBot coordinating HolzBot and SteinBot to build a Minecraft castle for 60 children aged 11-15. Its reported $0.022 model cost is not a benchmark for this application.

## Product Principles
- Make delegation, dependencies, observations, and repair visible.
- Let learners compare a vague brief with a precise one.
- Distinguish model reasoning from deterministic execution honestly.
- Keep cloud access optional and costs bounded by usage rather than invented estimates.

## Accessibility & Inclusion
Assumed requirements: keyboard-operable controls, reduced-motion support, readable contrast, and a text equivalent of the build state. Audience may include first-time AI users.
