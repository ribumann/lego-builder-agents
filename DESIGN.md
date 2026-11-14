# BrickLab visual system

## Direction
An interactive daylight science-museum workbench. The original 3D brick artifact leads, with a mission sheet on the left and a shared agent board on the right. This is an experience-led learning tool, not a chat product or marketing landing page.

## Palette and type
Ink `#23384c`, page `#f3f5f6`, paper `#ffffff`, action yellow `#ffd35a`, control blue `#254f75`. Jurassic mint `#cce6df` and space blue `#152b48` own the scene, rather than scattering themed accents across the interface. System sans stack: Avenir Next, Trebuchet MS, Arial. No external fonts or image services.

## Layout
Desktop: 260px mission / flexible 3D stage / 302px team. Brief and transport share a control deck beneath. Inspection, repair and reflection follow in reading order. At tablet widths the mission becomes a compact header; on phones the transport sits directly after the scene, followed by the team, brief and experiments.

## Components and state
Yellow approves a planning action or marks a pressed view tool. Blue controls playback. Plain task rows carry ownership, status and dependency text; team speech is a timestamped turn log, not chat bubbles. Agent colors: gold coordinator, violet plan verifier, blue structure, rose detail, green inspector. Never use color alone for status.

## Geometry and motion
Original stylized rectangular brick boxes. Large designs batch bodies and studs by color, sampling decorative studs above 8,192 per model or blueprint while retaining all selectable bodies. Each named object's face connectivity is checked independently; template designs also check mirrored sides. Neither check is physical LEGO instruction. On placement a brick descends into position. Reduced-motion mode removes that transition and camera damping. Robots indicate five team roles; their motion is illustrative, while the task board is authoritative.

## Content truth
Always distinguish default cloud Copilot planning, explicitly selected server-host Local AI, offline rule-based templates and imported three-model workflow decisions. No model request happens on load; planning actions disclose where the brief goes and never silently fall back. AI planning requires custom geometry. Explanations describe observable program decisions, not hidden model thoughts. No fabricated token costs, model results, official affiliation or physical safety claims.
