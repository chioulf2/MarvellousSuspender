// Script that runs inside suspended.html
'use strict';

// Global references (similar to how gsSuspendedTab.js might have used them via tabView)
const doc = document; // The document of suspended.html
const win = window;   // The window of suspended.html

// --- DOM Manipulation Functions (adapted from gsSuspendedTab.js) ---

function setTitle(title) {
  doc.title = title;
  const gsTitle = doc.getElementById('gsTitle');
  if (gsTitle) gsTitle.innerHTML = title;
  const gsTopBarTitle = doc.getElementById('gsTopBarTitle');
  if (gsTopBarTitle) gsTopBarTitle.innerHTML = title;
}

function setUrl(url) {
  const gsTopBarUrl = doc.getElementById('gsTopBarUrl');
  if (gsTopBarUrl) {
    gsTopBarUrl.innerHTML = cleanUrl(url);
    gsTopBarUrl.setAttribute('href', url);
    // Prevent click from unsuspending if it's just the link part
    gsTopBarUrl.onmousedown = function(e) { e.stopPropagation(); };
  }
}

function setFaviconMeta(faviconMeta) {
  if (!faviconMeta) return;
  const gsTopBarImg = doc.getElementById('gsTopBarImg');
  if (gsTopBarImg) gsTopBarImg.setAttribute('src', faviconMeta.normalisedDataUrl);
  
  const gsFavicon = doc.getElementById('gsFavicon');
  if (gsFavicon) gsFavicon.setAttribute('href', faviconMeta.transparentDataUrl);
}

function setTheme(theme, isLowContrastFavicon) {
  const body = doc.querySelector('body');
  if (theme === 'dark') {
    body.classList.add('dark');
  } else {
    body.classList.remove('dark');
  }

  const faviconWrap = doc.getElementById('faviconWrap');
  if (faviconWrap) {
    if (theme === 'dark' && isLowContrastFavicon) {
      faviconWrap.classList.add('faviconWrapLowContrast');
    } else {
      faviconWrap.classList.remove('faviconWrapLowContrast');
    }
  }
}

function setReason(reason) {
  let reasonMsgEl = doc.getElementById('reasonMsg');
  if (!reasonMsgEl) {
    const containerEl = doc.getElementById('suspendedMsg-instr');
    if (containerEl) {
        reasonMsgEl = doc.createElement('div');
        reasonMsgEl.setAttribute('id', 'reasonMsg');
        reasonMsgEl.classList.add('reasonMsg');
        containerEl.insertBefore(reasonMsgEl, containerEl.firstChild);
    }
  }
  if (reasonMsgEl) {
    reasonMsgEl.innerHTML = reason || '';
  }
}

function setCommand(command) {
  const hotkeyEl = doc.getElementById('hotkeyWrapper');
  if (hotkeyEl) {
    if (command) {
      hotkeyEl.innerHTML = `<span class="hotkeyCommand">(${command})</span>`;
    } else {
      // This needs chrome.i18n.getMessage, which is available in extension pages
      const reloadString = chrome.i18n.getMessage('js_suspended_hotkey_to_reload') || 'Set keyboard shortcut';
      hotkeyEl.innerHTML = `<a id='setKeyboardShortcut' href='#'>${reloadString}</a>`;
    }
  }
}

async function toggleImagePreviewVisibility(previewMode, previewUri) {
  const previewContainer = doc.getElementById('gsPreviewContainer');
  const suspendedMsg = doc.getElementById('suspendedMsg');
  const body = doc.body;

  if (!previewContainer && previewUri && previewMode && previewMode !== '0') {
    // Build it if it doesn't exist and is needed
    const previewEl = doc.createElement('div');
    previewEl.setAttribute('id', 'gsPreviewContainer');
    previewEl.classList.add('gsPreviewContainer');
    
    const previewTemplate = doc.getElementById('previewTemplate');
    if (previewTemplate) {
        previewEl.innerHTML = previewTemplate.innerHTML;
    }
    
    // Add unsuspend handler to preview (whole area)
    previewEl.onclick = handleUnsuspendRequest; 

    doc.body.appendChild(previewEl);
    
    const previewImgEl = doc.getElementById('gsPreviewImg');
    if (previewImgEl) {
        await new Promise((resolve) => {
            previewImgEl.onload = previewImgEl.onerror = resolve;
            previewImgEl.setAttribute('src', previewUri);
        });
    }
  } else if (!previewContainer) {
     // If no preview container and not creating one, ensure watermark handler is set
     addWatermarkHandler();
  }


  if (doc.getElementById('gsPreviewContainer')) { // Re-check if it was created
    const currentPreviewContainer = doc.getElementById('gsPreviewContainer'); // get it again
    currentPreviewContainer.style.display = (previewMode === '0' || !previewUri) ? 'none' : 'block';
    body.style.overflow = (previewMode === '2' && previewUri) ? 'auto' : 'hidden';
  }
  
  if (suspendedMsg) {
    suspendedMsg.style.display = (previewMode === '0' || !previewUri) ? 'flex' : 'none';
  }
  
  if (previewMode === '0' || !previewUri) {
    body.classList.remove('img-preview-mode');
  } else {
    body.classList.add('img-preview-mode');
  }
}


function showContents() {
  doc.querySelector('body').classList.remove('hide-initially');
}

function setScrollPosition(scrollPosition, previewMode) {
    const scrollPosAsInt = (scrollPosition && parseInt(scrollPosition)) || 0;
    const scrollImagePreview = previewMode === '2';
    let scrollToY = 0;
    if (scrollImagePreview && scrollPosAsInt > 15) {
        scrollToY = scrollPosAsInt + 151; // As per original logic
    }
    win.scrollTo(0, scrollToY);
}

function showNoConnectivityMessage() {
  let disconnectedNotice = doc.getElementById('disconnectedNotice');
  if (!disconnectedNotice) {
    const toastTemplate = doc.getElementById('toastTemplate');
    if (toastTemplate) {
        const toastEl = doc.createElement('div');
        toastEl.setAttribute('id', 'disconnectedNotice');
        toastEl.classList.add('toast-wrapper');
        toastEl.innerHTML = toastTemplate.innerHTML;
        // localiseHtml needs to be available or implemented here
        localiseHtml(toastEl); 
        doc.body.appendChild(toastEl);
        disconnectedNotice = toastEl;
    }
  }
  if (disconnectedNotice) {
    disconnectedNotice.style.display = 'none';
    setTimeout(function() {
      disconnectedNotice.style.display = 'block';
    }, 50);
  }
}

function showUnsuspendAnimation() {
  if (doc.body.classList.contains('img-preview-mode')) {
    const refreshSpinner = doc.getElementById('refreshSpinner');
    if (refreshSpinner) refreshSpinner.classList.add('spinner');
  } else {
    doc.body.classList.add('waking');
    const snoozyImg = doc.getElementById('snoozyImg');
    if (snoozyImg) snoozyImg.src = chrome.runtime.getURL('img/snoozy_tab_awake.svg');
    
    const snoozySpinner = doc.getElementById('snoozySpinner');
    if (snoozySpinner) snoozySpinner.classList.add('spinner');
  }
}

// --- Helper Functions (some may need to be self-contained) ---
function cleanUrl(urlStr) {
  if (!urlStr) return '';
  if (urlStr.indexOf('//') > 0) urlStr = urlStr.substring(urlStr.indexOf('//') + 2);
  let match = urlStr.match(/\/?[?#]+/);
  if (match) urlStr = urlStr.substring(0, match.index);
  match = urlStr.match(/\/$/);
  if (match) urlStr = urlStr.substring(0, match.index);
  return urlStr;
}

function localiseHtml(parentEl) {
  if (!chrome.i18n) return; // Guard against environments where this isn't available
  let replaceTagFunc = function(match, p1) {
    return p1 ? chrome.i18n.getMessage(p1) : '';
  };
  for (let el of parentEl.getElementsByTagName('*')) {
    if (el.hasAttribute('data-i18n')) {
      el.innerHTML = el
        .getAttribute('data-i18n')
        .replace(/__MSG_(\w+)__/g, replaceTagFunc)
        .replace(/\n/g, '<br />');
    }
    if (el.hasAttribute('data-i18n-tooltip')) {
      el.setAttribute(
        'data-i18n-tooltip',
        el
          .getAttribute('data-i18n-tooltip')
          .replace(/__MSG_(\w+)__/g, replaceTagFunc),
      );
    }
  }
}

// --- Event Handlers for suspended.html internal elements ---
function handleUnsuspendRequest(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    // Check if the click was on the "set keyboard shortcut" link
    if (event && event.target && event.target.id === 'setKeyboardShortcut') {
        chrome.runtime.sendMessage({ action: "openShortcutsPage" });
    } else if (event && event.which === 1) { // Left click
        showUnsuspendAnimation();
        // Send message to background to unsuspend this tab
        chrome.runtime.sendMessage({ action: "unsuspendTab" });
    }
}

function addWatermarkHandler() {
    const watermark = doc.querySelector('.watermark');
    if (watermark) {
        watermark.onclick = () => {
            chrome.runtime.sendMessage({ action: "openAboutPage" });
        };
    }
}

function setupEventHandlers() {
    const gsTopBarUrl = doc.getElementById('gsTopBarUrl');
    if (gsTopBarUrl) gsTopBarUrl.onclick = handleUnsuspendRequest;

    const gsTopBar = doc.getElementById('gsTopBar');
    if (gsTopBar) gsTopBar.onmousedown = handleUnsuspendRequest;
    
    const suspendedMsg = doc.getElementById('suspendedMsg');
    if (suspendedMsg) suspendedMsg.onclick = handleUnsuspendRequest;

    const tmsUpdateAvailable = doc.getElementById('tmsUpdateAvailable');
    if (tmsUpdateAvailable) {
        const gotoUpdatePage = doc.getElementById('gotoUpdatePage');
        if (gotoUpdatePage) {
            gotoUpdatePage.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                chrome.runtime.sendMessage({ action: "openUpdatePage" });
            };
        }
    }
    addWatermarkHandler();
}

// Initial setup when the page loads
function initPage(params) {
    setTitle(params.title);
    setUrl(params.originalUrl);
    setFaviconMeta(params.faviconMeta);
    setTheme(params.theme, params.isLowContrastFavicon);
    setCommand(params.suspensionToggleHotkey);
    setReason(params.suspendReason);
    toggleImagePreviewVisibility(params.previewMode, params.previewUri); // This is async
    showContents();
    setScrollPosition(params.scrollPosition, params.previewMode);

    // Localise the whole page after setting initial content
    localiseHtml(doc.documentElement);
    setupEventHandlers(); // Set up click handlers for unsuspending etc.

    // Update tmsUpdateAvailable visibility
    const tmsUpdateEl = doc.getElementById('tmsUpdateAvailable');
    if (tmsUpdateEl && params.updateAvailable) {
        tmsUpdateEl.style.display = 'block';
        tmsUpdateEl.style.paddingTop = '80px';
    } else if (tmsUpdateEl) {
        tmsUpdateEl.style.display = 'none';
    }
}


// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // It's good practice to check sender.id if messages could come from other extensions
  // For now, we assume messages are from our own service worker.
  if (message.target !== 'suspendedPage' && message.tabId !== undefined && message.tabId !== chrome.i18n.getMessage("@@extension_id")) {
    //This is not strictly needed as tabs.sendMessage is tab-specific, but as a safeguard.
    //However, if the message is broadcast via chrome.runtime.sendMessage to all extension contexts,
    //then this check is important. Let's assume for now that messages are targeted via tabs.sendMessage.
  }

  switch (message.action) {
    case 'initTab':
      // The payload for initTab will be comprehensive
      initPage(message.payload);
      sendResponse({ success: true, message: "Page initialized" });
      break;
    case 'showNoConnectivityMessage':
      showNoConnectivityMessage();
      sendResponse({ success: true });
      break;
    case 'updateCommand':
      setCommand(message.payload.suspensionToggleHotkey);
      sendResponse({ success: true });
      break;
    case 'updateTheme':
      setTheme(message.payload.theme, message.payload.isLowContrastFavicon);
      sendResponse({ success: true });
      break;
    case 'updatePreviewMode':
      // toggleImagePreviewVisibility is async
      toggleImagePreviewVisibility(message.payload.previewMode, message.payload.previewUri)
        .then(() => {
          setScrollPosition(message.payload.scrollPosition, message.payload.previewMode);
          sendResponse({ success: true });
        })
        .catch(e => sendResponse({ success: false, error: e.toString() }));
      return true; // Keep channel open for async response
    default:
      // console.warn("Unknown action received in suspendedPage.js:", message.action);
      sendResponse({ success: false, error: 'Unknown action' });
      break;
  }
  return false; // Default to synchronous response if not handled by async path
});

// Signal to service worker that the page is ready for initialization if needed,
// or the service worker can attempt to send initTab when it creates/updates the tab.
// For now, we'll rely on the service worker to initiate.
// console.log("suspendedPage.js loaded and listener attached.");
