# BZSS Panel Development Guidelines

## Project Overview

BZSS Panel WebCore is a Node.js-based modular management system for Squad game servers. It handles server administration via RCON and UDP, processes game events (often via a companion Python log parser), and provides a Vue.js-based frontend interface.

## Architecture & Directory Structure

The project strictly adheres to a layered architecture. **Do not create a `src/` directory at the root level.**

- `core/`: System infrastructure (Config, Logger, EventBus, RconManager, WebServer, etc.). Core provides foundation but contains no specific gameplay rules.
- `modules/`: The invisible business capability layer (e.g., match-state, player-state, kill-manage). Modules subscribe to Core events, emit Module events, maintain state, and provide APIs to plugins and the Web layer. Modules **cannot** depend on Plugins.
- `plugins/`: Specific gameplay rules and extensions. **Plugins must not directly execute RCON commands or maintain global player state.** They must rely on APIs provided by `modules/`.
- `web-client/`: The primary Vue.js frontend application. **All new pages, components, and frontend logic must go here.**
- `web/`: Legacy Web Shell / Compatibility layer. **Do not add new business pages here.**
- `contracts/`: Reference contracts for creating new Core, Module, Plugin, or Web components.
- `docs/`: System documentation.

## Building and Running

Commands should be executed from the root directory (`D:\BZSS_Panel`):

- **Start Backend:** `npm start`
- **Start Frontend (Dev Mode):** `npm run client:dev`
- **Build Frontend (Production):** `npm run client:build`
- **Run Tests:** `npm run test` (Executes both Python unit tests and Node.js backend tests).

## Development Conventions

### Backend (Node.js)

- **Strict Delegation:** High-risk actions must use designated APIs. For example, player team switching must use `modules.teamBalance.requestSwitchTeam(...)`. All RCON commands ultimately flow through `core.rconManager.dispatchCommand(...)`.
- **Event Flow:** Python LogParser -> UDP -> `core.udpEventReceiver` -> Core Event -> `modules` -> Module Event -> `plugins` / Web.
- **Contracts:** Always consult the `contracts/` directory when creating new components to ensure structural compliance.

### Frontend (Vue.js / web-client)

- **UI Principles:** 
  - The `body` must not scroll; only internal content areas should scroll.
  - List and Detail areas should scroll independently.
  - Use Drawers for detail views.
  - High-risk operations must require Modal confirmation.
- **Components:** Reuse existing common UI components (e.g., `AppPage`, `AppCard`, `AppTable`, `AppDrawer`, `AppConfirmDialog`) rather than inventing new styles.
- **Routing & State:** Routing is defined in `web-client/src/app/router.ts`. Page categories (`core`, `plugin`, `system`, `debug`) and refresh policies (`realtime`, `polling`, `manual`) should be declared via routing metadata, not scattered throughout page components.
