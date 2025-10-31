Navigraph: Visualizing Browsing History
===

> Intuitively visualize your browsing paths and web navigation history to understand the flow of information and help recall your browsing routes.

## Key Features

- 📊 **Browsing History Visualization** - Display web browsing paths using Tree and Waterfall diagrams
- 🗂️ **Session Management** - Automatically organize browsing activities into meaningful sessions
- 🔄 **Real-Time Updates** - Dynamically update navigation diagrams while browsing
- 🛡️ **Privacy Protection** - All data is stored locally and never uploaded to the cloud
- 🌙 **Dark Mode** - Supports dark themes to protect your eyes

<<<<<<< HEAD

=======
### Quick Start

1. Open the extension page (click the Navigraph icon in the toolbar).
2. Hover briefly or click the control panel handle on the right side of the page to open the sidebar. From the sidebar, you can select session dates, switch views, or filter nodes.
3. Use the status bar to switch views or toggle the visibility of hidden/closed nodes.
4. Click on nodes to view detailed information.

## User Guide (Overview)

### Installation

#### From Chrome Web Store

1. Visit the [Navigraph page on Chrome Web Store](https://chrome.google.com/webstore/detail/navigraph/jfjgdldpgmnhclffkkcnbhleijeopkhi)
2. Click "Add to Chrome"

#### From Edge Add-ons Store

1. Visit the [Navigraph page on Edge Add-ons Store](https://microsoftedge.microsoft.com/addons/detail/ibcpeknflplfaljendadfkhmflhfnhdh)
2. Click "Get" to install the extension
>>>>>>> c007809af331c0fe4fb45e1540565da910dce9a2

### Sidebar

The sidebar is primarily used for session selection and node filtering:

- View Switching: Switch the current view (Tree Diagram / Waterfall Diagram) from the top of the sidebar
- Session Calendar: Displays sessions by date and allows you to select and load session histories. If multiple sessions exist on the same day, they are displayed individually
- Filtering Controls: Filter results based on navigation types or actions (e.g., show only link clicks, form submissions, etc.)

Tip: The sidebar serves as the main entry point for switching data ranges or identifying analysis scopes. It is recommended to select a session first and then switch views.

### Status Bar

The status bar provides concise context and interactions within the interface:

<<<<<<< HEAD
1. Tree view: Displays page navigation relationships in a hierarchical structure, clearly showing which page led to the next.
2. Waterfall: Visualizes browsing events along a time axis, useful for seeing overlaps and durations.
=======
- Displays and switches the current view (Tree Diagram / Waterfall Diagram)
- Shows session statistics (e.g., number of nodes, session duration) and provides quick actions related to the view (e.g., toggling the visibility of hidden nodes)
- Click the date to quickly return to today's session
>>>>>>> c007809af331c0fe4fb45e1540565da910dce9a2

Explanation: The controls in the status bar are direct interaction entry points related to the current view. More complex filtering continues to be performed through the sidebar.

### View Interactions

Navigraph provides two complementary views: Tree Diagram and Waterfall Diagram.

#### Tree Diagram

Purpose: Display page navigation paths using hierarchical relationships, making it easy to analyze entry points and branches.

- Node Interaction: Hover to display brief information. Click to open the detail panel (including title, URL, access time, SPA request count, etc.)
- Zoom/Drag: In the Tree view, drag the canvas with the mouse to move it, and use the mouse wheel to scale the view (specific behavior may vary depending on the browser and settings)
- SPA Badge: Tree nodes feature subtle ring badges and numbers (if SPA requests exist) to indicate the number of SPA requests merged into the node.

#### Waterfall Diagram

Purpose: Display events/requests along a timeline, making it easy to identify overlaps and durations.

- Node Interaction: In the Waterfall Diagram, nodes within the same tab and time range are grouped into collapsible groups. Users can expand these groups to view items within. Collapsible groups are typically displayed in a drawer style and support internal scrolling
- Collapsible Groups: Grouped by tab (nodes in the same tab and time range are merged into the same group). After expansion, more items can be scrolled within the drawer
- Wheel and Drag: In the current implementation, the mouse wheel is primarily used to scroll vertically between lanes. Dragging is used to move the time window or adjust the observation window position
- SPA Badge: The mark at the top-right corner of nodes indicates the number of SPA requests merged into the node.

### Options Page (Settings)

The options page includes several preferences for adjusting the extension's behavior:

- Idle time threshold for session splitting (used to automatically split sessions)
- Session mode selection (e.g., daily / manual / activity-based)
- Language selection (used to force the localization language of the interface)

Explanation: Node filtering, visibility control, and more detailed filtering operations are provided by the filtering controls in the sidebar or controls within the view. The options page focuses on global behavior and localization settings.

### Troubleshooting (FAQ)

- View not updating: Refresh the extension page or try reloading the session.
- Session splitting issues: Adjust the idle time threshold in the options page to achieve a split more in line with expectations.

<<<<<<< HEAD
## Recent updates

Changes since v1.1.0:

- Replaced the "Timeline" view with a new "Waterfall" view.
- Show SPA request counts as a subtle badge on tree nodes.
- Redesigned the session root: circular node with a two-line date display.

## Developer & Technical Information

### Installation

#### From Chrome Web Store

1. Visit the [Navigraph page on Chrome Web Store](https://chrome.google.com/webstore/detail/navigraph/jfjgdldpgmnhclffkkcnbhleijeopkhi)
2. Click "Add to Chrome".

#### Developer / local build

1. Clone the repository: `git clone https://github.com/wxy/Navigraph.git`
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Load unpacked extension in Chrome (`chrome://extensions/`) and select the `dist` directory.

### Contributing

If you'd like to contribute:

1. Fork and create a feature branch (`git checkout -b feature/your-feature`).
2. Commit changes with clear messages and open a Pull Request.

### Issues & Contact

Report bugs or request features via GitHub Issues: https://github.com/wxy/Navigraph/issues

### License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

### Technical Architecture

- Frontend: TypeScript, D3.js, CSS3
- Storage: IndexedDB, LocalStorage
- Browser API: Chrome Extensions API
- Build Tools: Webpack
=======
## Data Management and Privacy

- Local Storage: All browsing history data is stored locally (IndexedDB / LocalStorage) and is never uploaded to the cloud.

## Recent Updates

Major changes since v1.1.0:

- Removed "Timeline" view and added a new "Waterfall" view. Displays events and lane assignments along a timeline
- Added SPA page request handling to the Tree Diagram: Displays SPA request counts in node details and features small ring badges on nodes to indicate the presence of SPA requests

## Developer and Technical Information

### Local Development and Build

1. Clone the repository: `git clone https://github.com/wxy/Navigraph.git`
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Load the unpacked extension in Chrome (`chrome://extensions/`) and select the `dist` directory

### Issues and Contact

Submit bugs or feature requests on GitHub Issues: https://github.com/wxy/Navigraph/issues

### Contribution Guidelines

If you'd like to contribute:

1. Fork the repository and create a feature branch (`git checkout -b feature/your-feature`)
2. Commit clear changes and open a pull request (PR)

If you find errors or inaccuracies in the languages used by this extension, submit a pull request including translation improvements!

### License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

### Tech Stack

- Frontend: TypeScript, D3.js, CSS3
- Storage: IndexedDB / LocalStorage
- Browser API: Chrome Extensions API
- Build Tool: Webpack
>>>>>>> c007809af331c0fe4fb45e1540565da910dce9a2
