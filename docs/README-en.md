Navigraph: Visualize Your Browsing History
===

> Visualize your browsing paths and navigation history intuitively, helping you understand information flow and remember browsing trajectories.

## Key Features

- 📊 **Visualize Browsing History** - Display your web browsing trajectories as tree diagrams and relationship graphs
- 🗂️ **Session Management** - Automatically organize browsing activities into meaningful sessions
- 🔄 **Real-time Updates** - Dynamically update navigation graphs while browsing
- 🛡️ **Privacy Protection** - All data stored locally, never uploaded to the cloud
- 🌙 **Dark Mode** - Support for dark theme to protect your eyes

## Installation

### From Chrome Web Store

1. Visit the [Navigraph page on Chrome Web Store](https://chrome.google.com/webstore/detail/navigraph/jfjgdldpgmnhclffkkcnbhleijeopkhi)
2. Click "Add to Chrome" button

### Developer Installation

1. Clone the repository `git clone https://github.com/wxy/Navigraph.git`
2. Install dependencies `npm install`
3. Build the extension `npm run build`
4. Open Chrome browser and navigate to `chrome://extensions/`
5. Enable "Developer mode"
6. Click "Load unpacked" and select the `dist` directory

## User Guide

Navigraph provides an intuitive interface to help you visualize and analyze your browsing history. Below are detailed instructions:

### Basic Operations

1. Launch the extension: Click the Navigraph icon in your browser toolbar to open a new tab displaying your browsing history visualization.
2. View current session: By default, it shows your current ongoing browsing session.
3. Control panel: The left panel provides session switching and filtering functions.
4. View switching: The top toolbar allows you to switch between different visualization views.

### Visualization Views

Navigraph offers multiple ways to view your browsing history:

1. Tree view: Displays page navigation relationships in a hierarchical structure, clearly showing which page led to the next.
2. Timeline: Shows your browsing history in chronological order, helpful for understanding time distribution.

### Session Management

1. Automatic session division: The system automatically divides your browsing history into different sessions based on your browsing habits and time intervals.
2. Session calendar:
   - Click or hover your mouse to open the control panel on the right
   - Dates with records are marked with special colors
   - Click a date to view sessions for that day and load its browsing history
3. Workday mode: The system organizes sessions based on workdays, making it easy to distinguish between work and leisure browsing activities.

### Filtering

1. Type filtering: Use filtering tools to filter pages by navigation type (direct access, link clicks, form submissions, etc.).
2. Behavior filtering: Use filtering tools to filter pages by navigation behavior.
3. Status filtering: Choose to view only active pages or include closed pages.

### Node Interaction

1. View details:
   - Hover over nodes to display brief page information
   - Click on nodes to view complete page details (title, URL, access time, etc.)
2. Revisit: Click links in the node details panel to reopen the page
3. Node highlighting: Clicking a node highlights other directly related nodes
4. Drag and zoom:
   - Drag the view area to pan the entire chart
   - Use the mouse wheel to zoom in or out
   - Use two-finger gestures on touch devices to zoom

### Personalization

1. Theme switching: Switch between light/dark themes in the top toolbar
2. Layout adjustment: Adjust node spacing, connection line styles, and other visual parameters
3. Session settings:
   - Adjust the idle time threshold for automatically creating new sessions
   - Select session mode (daily/manual/activity-based)

### Data Management

1. Local data: All browsing history data is stored only on your device, ensuring privacy.
2. Export functionality: Export browsing history of selected sessions as JSON or CSV formats for data analysis.

### Common Use Cases

1. Find previously visited pages: Even if you've forgotten the URL or title, you can find previously browsed pages through visualization.
2. Analyze browsing habits: Understand your internet habits, frequently visited sites, and typical navigation paths.
3. Work research organization: Review all related pages visited during specific research or work sessions to help organize ideas and materials.

### Troubleshooting

1. View not updating: If current browsing activity is not showing in the graph, try refreshing the extension page.
2. Session identification issues: If session division does not meet expectations, adjust the idle time threshold in settings.

With this guide, you should be able to take full advantage of all Navigraph features to better manage and understand your web browsing history.

## Technical Architecture

Navigraph is designed with a modern browser extension architecture:

- **Frontend**: TypeScript, D3.js, CSS3
- **Storage**: IndexedDB, LocalStorage
- **Browser API**: Chrome Extensions API
- **Build Tools**: Webpack

## Contributing

We welcome all forms of contribution! If you would like to participate in this project:

1. Fork this repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

## Contact

If you have any questions or suggestions, please contact us through:

- Submit an Issue: [GitHub Issues](https://github.com/wxy/Navigraph/issues)