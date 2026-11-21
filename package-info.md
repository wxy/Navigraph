### 单一用途

Navigraph serves a single, specific, and easily understandable purpose: to visualize users' browsing history and navigation paths in intuitive graph formats. It helps users understand their browsing patterns, recall previously visited pages, and visualize the relationships between different web pages they visit. This extension transforms the typically linear browsing history into meaningful visual representations, making it easier to retrace steps and understand information flow patterns.

### 需请求权限的理由

#### tabs

This permission is essential for Navigraph to track tab activities, detect when tabs are opened, closed, or updated. This allows the extension to create accurate visualizations of the user's browsing session by monitoring tab state changes.

#### webNavigation

This permission enables Navigraph to observe navigation events within tabs (such as page loads, form submissions, and redirects). These events are core to building the navigation tree as they represent the connections between different pages.

#### webRequest

This permission lets Navigraph observe main-frame redirect events to connect page navigation paths. It does not inspect request bodies or monitor subresource requests.

#### storage

This permission stores browsing history and sessions in the local browser profile (IndexedDB) and preferences in browser sync storage. Preferences may sync through the browser account; browsing history is not stored in sync storage.

#### alarms

This permission schedules periodic navigation maintenance and data-retention checks, including after the service worker wakes.

#### favicon

This permission retrieves website icons through the browser favicon API for browsing-history nodes.

#### host_permissions

This permission is necessary for Navigraph to capture navigation data across all websites the user visits. Without this permission, the extension could not build comprehensive navigation trees that represent the user's complete browsing history. Browsing history remains in the local browser profile; preferences may sync through the browser account.

### 数据使用和隐私

Navigraph processes browsing history locally in the user's browser profile. Preferences may sync through the browser account. Browsing history collected by the extension is:

1. Stored exclusively on the user's device using browser's built-in storage mechanisms
2. Never transmitted to any external servers or third parties
3. Accessible only to the user
4. Automatically managed with options to delete historical data

Users have complete control over their data, including the ability to view, filter, and delete browsing sessions at any time. The extension includes privacy-focused features like automatic session expiration and data retention controls.

### 安全考虑

Navigraph implements several security measures to protect user data:

1. Content scripts operate in isolated worlds to prevent interference with webpage JavaScript
2. Browsing-history processing occurs locally without external processing services
3. The extension adheres to Chrome's Manifest V3 security model
4. Regular code updates address potential security vulnerabilities

### 可用性和性能

Navigraph is designed to have minimal impact on browsing performance. The extension:

1. Uses efficient data structures for storing navigation information
2. Implements lazy loading for historical data
3. Throttles real-time updates to prevent performance degradation
4. Automatically manages memory usage by limiting session data size