# Changelog

## 2026-05-13 (v0.2.2)

- Fixed the macOS menu bar icon by using a real resized PNG app icon instead of the SVG template image that could render as an invisible zero-width status item.

## 2026-05-13 (v0.2.1)

- Added hourly update checks with a small in-app `新版本` / `NEW` badge on the settings button.
- Added terminal update support from Settings and the tray menu, including `git pull`, dependency sync, build, and automatic relaunch after success.
- Added Simplified Chinese / English UI switching, with first-run language detection from the user's system language.
- Added release-page access in Settings and localized update status copy across the renderer, tray, and notifications.
- Moved achievement copy and UI localization out of the main renderer file to keep the app easier to maintain.
- Fixed desktop tree pointer handling so it only follows the cursor while actively dragging, and restored double-click manager opening.
- Updated the macOS tray icon to use a template-style menu bar icon that better matches system sizing.
- Refined the compact full-number badge spacing and text sizing for large token totals.
- Added the `1 token = 1 XP` help tip beside the tree level title.

## 2026-05-13

- Added a full achievement system with persistent unlock state, rarity levels, category filters, status filters, locked-state hints, and detail modals.
- Added achievement unlock feedback for the desktop pet, including a separate toast window that follows the pet position and avoids covering the tree.
- Added a `NEW` state for newly unlocked achievements so users are guided to open the detail view and read the reward copy.
- Reworked the achievement page into a collection view with summary stats, category navigation, high-rarity showcase chips, and compact source-list-style achievement rows.
- Added hidden-achievement behavior: locked hidden achievements hide their name and condition until unlocked.
- Added achievement detail copy separation: card rows show achievement conditions, while detail views reveal the flavor text after unlock.
- Refined achievement visual design to match the main dashboard: dark panels, green progress language, rarity-colored markers, clearer text contrast, and a custom in-panel scrollbar.
- Added click-through details for high-rarity showcase chips.
- Removed the duplicate hidden status filter and kept hidden achievements as their own category.
- Cleaned dashboard copy and token-source separators, replacing stray separator text with proper dot separators.

## 2026-05-11

- Moved pet lock and scale controls into the settings panel, keeping the main dashboard focused on the tree and live stats.
- Added a pet-window context menu for opening the manager, locking the pet, changing scale, configuring badge faces, choosing k/m units, and hiding the pet.
- Changed source contribution defaults to Today, added Today/Total switching, and applied the same scope to expanded per-agent model breakdowns.
- Refined the 3D level badge: smoother flip motion, hover-to-flip with immediate return on pointer leave, 2.5s timed auto flips, and no badge flip during level-up.
- Reworked the 7-day chart tooltip into an in-app hover card and avoided unnecessary chart DOM rebuilds to prevent flicker.
- Corrected 7-day chart bar semantics so bar height follows XP (`input + output`) while cache read/write remain separately visible.
- Reduced misleading minimum bar heights so small daily values preserve visible proportion differences.
- Clarified the product display model around growth XP versus cache/token traffic during OpenClaw comparison work.

## 2026-05-09

- Unified the product name as Vibe Tree and connected the app icon for system surfaces.
- Improved incremental token ingestion so historical cumulative usage is not counted as new XP on startup.
- Slowed growth pacing by raising level and stage thresholds.
- Added LEVEL UP feedback and a 3D level badge with hover, level-up, and timed flip behavior.
- Added configurable badge faces for level, total token, and token/s, with k/m total unit options.
- Moved preferences into a gear-triggered settings panel instead of showing configuration on the main dashboard.
- Combined source monitoring and contribution stats into one row per agent.
- Added expandable per-agent model breakdowns.
- Enhanced the 7-day chart: all sources show agent share, while individual agents show input, output, cache hit, and cache write.
- Removed manual feeding from the main product UI.
