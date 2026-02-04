# Failed Approaches - Do Not Repeat

## 1. `isVisible` Prop Approach for Preventing 429 Errors (2026-02-04)

### What Was Attempted
Added an `isVisible` prop through the component hierarchy to gate API calls when tabs are hidden:
- Added `isVisible` prop to `WebIDEPanel`, `XTerminal`, `CodingView`, `AppDetail`
- Passed `isVisible={isActive}` from `App.tsx` based on `tab.appId === selectedAppId`
- Components checked `isVisible` before making API calls

### Why It Failed
- **Broke the entire application** in multiple ways without obvious errors during testing
- The approach was fundamentally flawed because:
  1. It conflated "visibility" with "should make API calls" when these are different concerns
  2. The tab persistence architecture (rendering all tabs with CSS visibility) requires components to maintain their state regardless of visibility
  3. Stopping API calls for hidden tabs caused state synchronization issues
  4. The iframe-based VS Code Server and browser preview don't gracefully handle being "paused"

### What Should Have Been Done Instead
- Focus on the actual problem: rate limiting on the backend
- Consider debouncing/throttling API calls at the source
- Consider increasing rate limits for legitimate polling
- Consider using WebSockets instead of polling for status updates

### Lesson Learned
**NEVER try to "optimize" by preventing API calls based on tab visibility in a multi-tab architecture where components are always mounted.** The tab persistence feature requires all tabs to maintain their full state - trying to partially suspend them breaks everything.

---
