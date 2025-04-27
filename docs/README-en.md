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

1. Visit the [Navigraph page on Chrome Web Store](https://chrome.google.com/webstore/detail/navigraph/[extension-id])
2. Click "Add to Chrome" button

### Developer Installation

1. Clone the repository `git clone https://github.com/wxy/Navigraph.git`
2. Install dependencies `npm install`
3. Build the extension `npm run build`
4. Open Chrome browser and navigate to `chrome://extensions/`
5. Enable "Developer mode"
6. Click "Load unpacked" and select the dist directory

## User Guide

1. After installing the extension, click the Navigraph icon in the toolbar
2. By default, the visualization of the current browsing session will be displayed
3. Use filtering tools to view specific types of navigation
4. Click on nodes to view page details or revisit the page
5. Use the session calendar to switch between browsing records from different dates

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