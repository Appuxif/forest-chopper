# Research sources (retrieved 2026-10-31)

The skill is an independently written synthesis of the ideas below, tailored to Forest Chopper. They are **references, not bundled libraries or guaranteed installed dependencies**.

1. Agent Skills format, YAML frontmatter and progressive disclosure: https://agentskills.io/specification and https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx
2. EL4CTEO's modular Blender Agent Skills (MIT): https://github.com/EL4CTEO/blender-skills — notably `blender-core`, `blender-sculpting`, `blender-character-rigging`, `blender-animation`, `blender-asset-qa` and `blender-export-pipelines`.
3. ifBars Blender Agent Studio character workflow: https://github.com/ifBars/blender-agent-studio/blob/main/plugins/blender-agent-studio/skills/blender-character-workflow/SKILL.md — character contract, deformation and runtime QA.
4. RobLe3 cc-blender-skill: https://github.com/RobLe3/cc-blender-skill — tool-driven modeling, look-dev and iterative review.
5. majidmanzarpour blender-game-skills: https://github.com/majidmanzarpour/blender-game-skills — measured reference-to-asset, gated game-ready deliverables.
6. Blender MCP official project (Blender 5.1+ requirements, arbitrary code security): https://www.blender.org/lab/mcp-server/
7. Three.js SkeletonUtils clone for skinned avatars: https://threejs.org/docs/pages/module-SkeletonUtils

**Security / use:** Blender MCP can execute arbitrary Python code. Do not run untrusted third-party scripts or install unknown add-ons without review; perform destructive operations only on backups/isolated scenes. This skill does not install external components.
