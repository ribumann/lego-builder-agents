# BrickLab

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Children aged 11-15 learning about AI agents, with a teacher or parent facilitating. Age range and workshop intent come from the reference post supplied by the user.

## Product Purpose
Demonstrate autonomous coordination by building original brick models, including dinosaur and spacecraft templates, in a Jurassic or space setting.

## Positioning
A visible coordinator works with a plan verifier, two specialist builders, and a quality inspector; learners can inspect their shared task board, change the brief, and observe verification and repair.

## Operating Context
Local browser application with a local Node server. No Azure service is required. Source and CI may be stored in a private repository owned by ribumann.

## Capabilities and Constraints
- Default execution is a transparent, deterministic, rule-based agent simulation, not an LLM.
- The optional imported workflow has three model decisions, not five model calls: the plan verifier and quality inspector remain rule-based.
- Optional GitHub Copilot CLI planning uses the user's authenticated subscription, with explicit opt-in and a bounded request count. Actual model charges are unknown.
- Copilot may propose original static designs with mixed brick dimensions within bounded workspace, count and volume limits. Local planning remains template-based.
- Deterministic local dinosaur-herd and spacecraft-fleet examples demonstrate named multi-object worlds without model calls. Normal designs target at most 1,000 pieces and 32,768 occupied cells; advanced designs allow up to 8,192 pieces and 262,144 cells within bounded coordinates. Performance varies by device.
- No gated local models, downloaded brand assets, or paid cloud infrastructure.
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
