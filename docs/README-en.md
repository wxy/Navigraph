Navigraph: Visualizing Browsing History
===

> Intuitively visualize your browsing paths and web navigation history to understand the flow of information and help recall your browsing routes.

## Key Features

- 📊 **Browsing History Visualization** - Display web browsing paths using Tree and Waterfall diagrams
- 🗂️ **Session Management** - Automatically organize browsing activities into meaningful sessions
- 🔄 **Real-Time Updates** - Dynamically update navigation diagrams while browsing
- 🛡️ **Privacy Protection** - Browsing history stays in the local browser profile; preferences may sync through the browser account
- 🌙 **Dark Mode** - Supports dark themes to protect your eyes

### Quick Start

1. Open the extension page (click the Navigraph icon in the toolbar).
2. Use the date in the top toolbar to open the calendar. Pick a day in Tree view or a session in Waterfall view. Use the adjacent buttons to switch views.
3. Open Filter on the right to select conditions. The record count and Hidden or Restore filters controls are in the top toolbar.
4. Click on nodes to view detailed information.

## User Guide (Overview)

### Installation

#### From Chrome Web Store

1. Visit the [Navigraph page on Chrome Web Store](https://chrome.google.com/webstore/detail/navigraph/jfjgdldpgmnhclffkkcnbhleijeopkhi)
2. Click "Add to Chrome"

#### From Edge Add-ons Store

1. Visit the [Navigraph page on Edge Add-ons Store](https://microsoftedge.microsoft.com/addons/detail/ibcpeknflplfaljendadfkhmflhfnhdh)
2. Click "Get" to install the extension

### Graph toolbar

- Use the date in the top toolbar to open the calendar. Pick a day in Tree view or a session in Waterfall view. Use the adjacent buttons to switch views.
- Open Filter on the right to select conditions. The record count and Hidden or Restore filters controls are in the top toolbar.
- In Tree view, use the fold controls at the upper left and Fit to view at the lower right. In Waterfall view, the visible time range and fit control sit above the timeline.

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