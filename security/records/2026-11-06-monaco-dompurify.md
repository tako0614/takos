# Monaco sanitizer dependency update

On 2026-11-06, the locked DOMPurify override and Monaco's guarded replacement
move from 3.4.12 to 3.4.17. This is a bounded dependency repair, not evidence
of a demonstrated exploit in the current Takos application or a deployment.

The [upstream advisory](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7)
lists 3.4.12 in the affected range and 3.4.17 as patched. The issue requires
template-safe sanitization, a DOM-returning mode, attached shadow-root input
and downstream template evaluation. Monaco 0.55.1's current caller accepts
an HTML string and does not enable `SAFE_FOR_TEMPLATES`. The application
Markdown renderer does not call DOMPurify. These inspected callers do not
establish a current application exploit, but the bundled dependency remains
worth repairing.

An isolated headless Chrome command exercised the actual old package with
`${safe_probe}` split around a disallowed object element in an attached
shadow root. Both direct and nested shadow roots retained the expression.
The same assertions pass with 3.4.17: the complete expression is removed.
Four additional delimiter/nesting variants and ordinary markup also pass;
those five already passed on the old package and are not additional REDs.
No template evaluator or script payload was executed.

The fixed browser cohort additionally imports the actual Monaco sanitizer
through the existing production Vite replacement plugin. Its trusted-HTML
and DOM-fragment entry points retain strong markup and remove JavaScript
URLs and event attributes. All nine fixed-cohort assertions pass. This is
local browser/library evidence, separate from portable CI and installed use.

The change retains the runtime exact-version check, the exactly-one Monaco
replacement requirement and the production bundle's exactly-one proof check.
The proof string advances with the package pin. The supported Bun install
changes only the DOMPurify override and lock entry/version/integrity; all
other dependency resolutions remain unchanged. The old dependency graph is
preserved, and the updated graph is installed separately.

No advisory is waived, no security validator rejection is relaxed, and the
historical 97-finding audit remains RED. This change does not claim a new
whole-graph audit, application exploitability proof or production readiness.
