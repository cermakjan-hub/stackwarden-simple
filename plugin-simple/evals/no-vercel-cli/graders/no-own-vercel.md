---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:npx\s+|pnpm\s+(?:exec\s+)?)?vercel\b'
min: 0
max: 0
---

The model never runs the Vercel CLI itself: it reads Vercel only through `sw.mjs`.
