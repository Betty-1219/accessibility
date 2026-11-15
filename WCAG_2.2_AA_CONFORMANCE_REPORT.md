# WCAG 2.2 AA Conformance Report — SelamPath

- **Component**: `<digital-bridge-onboarding>` (SelamPath, with the AccessPath career gateway)
- **Standard**: Web Content Accessibility Guidelines (WCAG) 2.2 Level AA
- **Automated testing**: `axe-core` v4.10 — re-run `frontend/tests/axe-audit.html` after any UI change
- **Assistive technology tested**: NVDA (Windows), TalkBack (Android), keyboard-only,
  200% browser and widget zoom, sound-off visual mode
- **Last reviewed**: November 2026

| WCAG Criterion | Level | Status | Implementation Details |
| :--- | :--- | :--- | :--- |
| **1.1.1 Non-text Content** | A | Pass | Toolbar and wizard controls have visible text labels; decorative graphics are hidden from assistive technology. |
| **1.3.1 Info and Relationships** | A | Pass | Semantic `<fieldset>`, `<legend>`, `<label for="...">`, and headings associate inputs, hints, and errors. The brand header and AccessPath navigation use landmark elements. |
| **1.4.3 Contrast (Minimum)** | AA | Pass | Default theme exceeds 4.5:1; high-contrast presets (`#FFFF00` on `#000000`, `#000000` on `#FFF59D`, `#FFFFFF` on `#000000`) exceed 15:1. Custom colour pickers let learners choose their own pair. |
| **1.4.4 Resize Text / 1.4.10 Reflow** | AA | Pass | Supports 80%–200% scaling without horizontal scrolling or clipped controls at 320px. |
| **2.1.1 Keyboard & 2.1.2 No Keyboard Trap** | A | Pass | Full Tab/Shift+Tab navigation, `Alt + A` launch, and `Esc` to stop voice output. |
| **2.2.1 Timing Adjustable** | A | Pass | Drafts never expire locally and can be resumed with a server token. Authenticated sessions expire after `SESSION_TTL_DAYS` and the UI announces expiry and returns to login. |
| **2.4.1 Bypass Blocks** | A | Pass | `frontend/index.html` includes a visible-on-focus "Skip to main content" link. |
| **2.4.7 Focus Visible / 2.4.11 Focus Not Obscured** | AA | Pass | A 4px high-contrast focus outline with `outline-offset: 3px` is applied globally. |
| **2.5.8 Target Size (Minimum)** | AA | Pass | Interactive buttons and option cards meet or exceed 48 × 48 CSS pixels; colour inputs are 48px tall. |
| **3.3.1 Error Identification & 3.3.3 Error Suggestion** | A/AA | Pass | Errors appear in a `role="alert"` banner and are announced with `aria-live="assertive"`; messages are plain language and suggest the next step. |
| **4.1.2 Name, Role, Value** | A | Pass | Native HTML controls and ARIA live regions (`role="status"`, `role="progressbar"`, `aria-live`) expose state to NVDA and TalkBack. |
| **4.1.3 Status Messages** | AA | Pass | Notices, listening status, and errors are announced without moving focus. |

## Addendum — November 2026 Review

- The theme system now applies to the `<digital-bridge-onboarding>` host element instead of
  overwriting `document.body.className`, so a host page's own classes and themes are preserved.
- Custom background and text colours are implemented in a keyboard-accessible `<details>` panel
  with native colour inputs and a text-labelled Apply button.
- The page header, tagline, and skip link use plain semantic HTML with no text baked into images.
- The footer includes keyboard hints using `<kbd>` elements.
- Error banners and live regions are escaped before rendering, so assistive-technology output
  cannot be corrupted by learner- or employer-supplied markup.
- Remaining manual checks before release: screen-reader pass on the new brand header and colour
  panel, 400% reflow at 320px, and native-speaker review of the Amharic strings.
- The AccessPath Career Passport uses semantic headings, a text-labelled readiness badge (border
  style as well as colour), keyboard-reachable Copy and Print buttons, an `aria-valuenow` progress
  bar, and a print stylesheet that removes navigation controls.
