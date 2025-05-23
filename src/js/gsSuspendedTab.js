/*global tgs, gsFavicon, gsStorage, gsSession, gsUtils, gsIndexedDb, gsChrome, chrome */
// eslint-disable-next-line no-unused-vars
var gsSuspendedTab = (function() {
  'use strict';

  // Helper to send message to a specific suspended tab's content script (suspendedPage.js)
  async function sendMessageToSuspendedPage(tabId, action, payload) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { target: 'suspendedPage', action, payload });
      if (chrome.runtime.lastError) {
        gsUtils.warning(tabId, `Error sending message for action ${action}: ${chrome.runtime.lastError.message}`);
        return { success: false, error: chrome.runtime.lastError.message };
      }
      if (response && !response.success) {
         gsUtils.warning(tabId, `Suspended page returned error for action ${action}: ${response.error}`);
      }
      return response;
    } catch (e) {
      gsUtils.warning(tabId, `Exception sending message for action ${action}: ${e}`);
      return { success: false, error: e.toString() };
    }
  }

  async function initTab(tab, tabViewIgnored, { quickInit }) {
    // tabView is no longer used directly. Communication happens via messages.
    const suspendedUrl = tab.url;
    let title = gsUtils.getSuspendedTitle(suspendedUrl);
    if (title.indexOf('<') >= 0) {
      title = gsUtils.htmlEncode(title);
    }

    const faviconMeta = await gsFavicon.getFaviconMetaData(tab);
    
    if (quickInit) {
        // For quickInit, we might only send minimal info or skip if not strictly necessary
        // For now, let's assume quickInit means no complex updates to the suspended page itself,
        // as it's likely to be discarded or further processed by the background script.
        // If some basic state *must* be on the page even for quickInit, send that here.
        gsUtils.log(tab.id, 'gsSuspendedTab.initTab (quickInit) - skipping full page update.');
        return;
    }

    const options = await gsStorage.getSettings(); // gsStorage is now async
    const originalUrl = gsUtils.getOriginalUrl(suspendedUrl);
    const previewMode = options[gsStorage.SCREEN_CAPTURE];
    const previewUri = await getPreviewUri(suspendedUrl); // This uses gsIndexedDb (async)
    const theme = options[gsStorage.THEME];
    const isLowContrastFavicon = faviconMeta.isDark;
    const suspensionToggleHotkey = await tgs.getSuspensionToggleHotkey(); // tgs function might be async

    const suspendReasonInt = tgs.getTabStatePropForTabId(tab.id, tgs.STATE_SUSPEND_REASON);
    let suspendReason = null;
    if (suspendReasonInt === 3) {
      suspendReason = chrome.i18n.getMessage('js_suspended_low_memory');
    }
    const scrollPosition = gsUtils.getSuspendedScrollPosition(suspendedUrl);
    const updateAvailable = await gsStorage.getOption(gsStorage.UPDATE_AVAILABLE);


    const initPayload = {
      title,
      originalUrl,
      faviconMeta,
      theme,
      isLowContrastFavicon,
      suspensionToggleHotkey,
      suspendReason,
      previewMode,
      previewUri,
      scrollPosition,
      updateAvailable,
      // Any other parameters that were previously set directly on tabView.document or tabView.window
      // For example, gsSession.getSessionId() if it was used by the page.
      // However, setUnloadTabHandler and setUnsuspendTabHandlers were setting listeners on the page,
      // those will now be part of suspendedPage.js itself.
    };

    sendMessageToSuspendedPage(tab.id, 'initTab', initPayload);
    
    // The original setUnloadTabHandler was adding a listener to the suspended page's window.
    // This logic is now implicitly handled by the suspended page itself or not needed if
    // the service worker manages all state. For STATE_UNLOADED_URL, the SW can listen to
    // tab removal or updates. For now, we assume this specific handler is not directly translated.
    // tgs.setTabStatePropForTabId(tab.id, tgs.STATE_SCROLL_POS, scrollPosition); // This remains in SW
  }

  async function showNoConnectivityMessage(tabId) {
    // tabView is no longer passed. Send a message instead.
    sendMessageToSuspendedPage(tabId, 'showNoConnectivityMessage');
  }

  async function updateCommand(tabId, suspensionToggleHotkey) {
    // tabView is no longer passed. Send a message instead.
    sendMessageToSuspendedPage(tabId, 'updateCommand', { suspensionToggleHotkey });
  }

  async function updateTheme(tabId, theme, isLowContrastFavicon) {
    // tabView and tab are no longer passed directly for DOM manipulation.
    sendMessageToSuspendedPage(tabId, 'updateTheme', { theme, isLowContrastFavicon });
  }

  async function updatePreviewMode(tabId, suspendedTabUrl, previewMode) {
    // tabView and tab are no longer passed directly for DOM manipulation.
    const previewUri = await getPreviewUri(suspendedTabUrl); // Needs original URL if suspendedTabUrl is the chrome-extension:// one
    const scrollPosition = gsUtils.getSuspendedScrollPosition(suspendedTabUrl);
    sendMessageToSuspendedPage(tabId, 'updatePreviewMode', { previewMode, previewUri, scrollPosition });
  }


  // This function was originally for direct DOM manipulation.
  // It's now a helper for other functions that gather data.
  async function getPreviewUri(suspendedUrl) {
    const originalUrl = gsUtils.getOriginalUrl(suspendedUrl);
    const preview = await gsIndexedDb.fetchPreviewImage(originalUrl); // gsIndexedDb is async
    let previewUri = null;
    if (
      preview &&
      preview.img &&
      preview.img !== null &&
      preview.img !== 'data:,' &&
      preview.img.length > 10000
    ) {
      previewUri = preview.img;
    }
    return previewUri;
  }

  // Functions like showContents, setScrollPosition, setTitle, setUrl, setFaviconMeta,
  // setTheme, setReason, buildImagePreview, addWatermarkHandler, toggleImagePreviewVisibility,
  // setCommand, setUnloadTabHandler, setUnsuspendTabHandlers, buildUnsuspendTabHandler,
  // showUnsuspendAnimation, loadToastTemplate, cleanUrl were all direct DOM manipulators
  // or event setup functions for the suspended.html page. Their logic is now expected
  // to be within src/js/suspendedPage.js, triggered by messages.

  return {
    initTab,
    showNoConnectivityMessage, // now takes tabId
    updateCommand,             // now takes tabId
    updateTheme,               // now takes tabId
    updatePreviewMode,         // now takes tabId, suspendedTabUrl, previewMode
  };
})();
