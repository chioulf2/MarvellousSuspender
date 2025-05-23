/*global chrome, gsStorage, gsSession, gsUtils */ // Removed tgs
(function(global) {
  'use strict';

  // MV3: Direct background page access is not allowed.
  // Communication with background script (service worker) must use chrome.runtime.sendMessage.

  var globalActionElListener;

  // Helper to send messages to the background script
  async function sendMessageToBackground(action, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, payload }, response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }


  async function getTabStatus(retriesRemaining) { // Now async
    const response = await sendMessageToBackground('getActiveTabStatus');
    const status = response ? response.status : gsUtils.STATUS_UNKNOWN;

    if (
      status !== gsUtils.STATUS_UNKNOWN &&
      status !== gsUtils.STATUS_LOADING
    ) {
      return status;
    } else if (retriesRemaining === 0) {
      return status;
    } else {
      var timeout = 1000;
      // gsSession.isInitialising() needs to be fetched from background if still needed
      // For simplicity, let's assume it's not critical for retry timing here or handle it if error
      // const sessionState = await sendMessageToBackground('getSessionState'); // Example
      // if (sessionState && !sessionState.isInitialising) {
      //   retriesRemaining--;
      //   timeout = 200;
      // }
      // Simplified:
      retriesRemaining--;
      timeout = 200;

      await new Promise(resolve => setTimeout(resolve, timeout));
      return getTabStatus(retriesRemaining);
    }
  }

  async function getTabStatusAsPromise(retries, allowTransientStates) { // Now async
    let status = await getTabStatus(retries);
    if (
      !allowTransientStates &&
      (status === gsUtils.STATUS_UNKNOWN ||
        status === gsUtils.STATUS_LOADING)
    ) {
      status = 'error';
    }
    return status;
  }

  async function getSelectedTabsAsPromise() { // Remains mostly the same, chrome.tabs.query is fine
    return new Promise(function(resolve) {
      chrome.tabs.query(
        { highlighted: true, lastFocusedWindow: true },
        function(tabs) {
          resolve(tabs);
        }
      );
    });
  }

  // Main initialization logic
  (async function() {
    try {
      await gsUtils.documentReadyAndLocalisedAsPromised(document);
      const [initialTabStatus, selectedTabs] = await Promise.all([
        getTabStatusAsPromise(0, true),
        getSelectedTabsAsPromise(),
      ]);

      setSuspendSelectedVisibility(selectedTabs);
      await setStatus(initialTabStatus); // setStatus is now async
      await showPopupContents(); // showPopupContents is now async
      addClickHandlers(); // This will also need to handle async actions

      if (
        initialTabStatus === gsUtils.STATUS_UNKNOWN ||
        initialTabStatus === gsUtils.STATUS_LOADING
      ) {
        const finalTabStatus = await getTabStatusAsPromise(50, false);
        await setStatus(finalTabStatus);
      }
    } catch (e) {
      console.error("Error initializing popup:", e);
      // Display some error on the popup page itself
      const statusDetailEl = document.getElementById('statusDetail');
      if (statusDetailEl) {
        statusDetailEl.innerHTML = "Error loading popup. Please try again.";
      }
    }
  })();


  function setSuspendCurrentVisibility(tabStatus) {
    var suspendOneVisible = ![
        gsUtils.STATUS_SUSPENDED, // Can't suspend already suspended
        gsUtils.STATUS_SPECIAL, // Can't suspend special pages
        gsUtils.STATUS_BLOCKED_FILE, // Can't suspend blocked file pages (unless permission given)
        gsUtils.STATUS_UNKNOWN, // Don't show if status is unknown
        // gsUtils.STATUS_WHITELISTED, // Whitelisted tabs shouldn't be manually suspended from popup easily
      ].includes(tabStatus),
      whitelistVisible = ![
        gsUtils.STATUS_WHITELISTED, // Don't show "whitelist" if already whitelisted
        gsUtils.STATUS_SPECIAL,
        gsUtils.STATUS_BLOCKED_FILE,
        gsUtils.STATUS_UNKNOWN,
      ].includes(tabStatus),
      unsuspendVisible = [gsUtils.STATUS_SUSPENDED].includes(tabStatus); // Only show unsuspend for suspended tabs

    document.getElementById('suspendOne').style.display = suspendOneVisible ? 'block' : 'none';
    document.getElementById('whitelistPage').style.display = whitelistVisible ? 'block' : 'none';
    document.getElementById('whitelistDomain').style.display = whitelistVisible ? 'block' : 'none';
    document.getElementById('optsCurrent').style.display = (suspendOneVisible || whitelistVisible || unsuspendVisible) ? 'block' : 'none';
    document.getElementById('unsuspendOne').style.display = unsuspendVisible ? 'block' : 'none';
  }

  function setSuspendSelectedVisibility(selectedTabs) {
    if (selectedTabs && selectedTabs.length > 1) {
      document.getElementById('optsSelected').style.display = 'block';
    } else {
      document.getElementById('optsSelected').style.display = 'none';
    }
  }

  async function setStatus(status) { // Made async
    setSuspendCurrentVisibility(status);

    var statusDetail = '';
    if (status === gsUtils.STATUS_NORMAL || status === gsUtils.STATUS_ACTIVE) {
      statusDetail = `${chrome.i18n.getMessage('js_popup_normal')} <a href='#'>${chrome.i18n.getMessage('js_popup_normal_pause')}</a>`;
    } else if (status === gsUtils.STATUS_SUSPENDED) {
      statusDetail = chrome.i18n.getMessage('js_popup_suspended');
    } else if (status === gsUtils.STATUS_NEVER) {
      statusDetail = chrome.i18n.getMessage('js_popup_never');
    } else if (status === gsUtils.STATUS_SPECIAL) {
      statusDetail = chrome.i18n.getMessage('js_popup_special');
    } else if (status === gsUtils.STATUS_WHITELISTED) {
      statusDetail = `${chrome.i18n.getMessage('js_popup_whitelisted')} <a href='#'>${chrome.i18n.getMessage('js_popup_whitelisted_remove')}</a>`;
    } else if (status === gsUtils.STATUS_AUDIBLE) {
      statusDetail = chrome.i18n.getMessage('js_popup_audible');
    } else if (status === gsUtils.STATUS_FORMINPUT) {
      statusDetail = `${chrome.i18n.getMessage('js_popup_form_input')} <a href='#'>${chrome.i18n.getMessage('js_popup_form_input_unpause')}</a>`;
    } else if (status === gsUtils.STATUS_PINNED) {
      statusDetail = chrome.i18n.getMessage('js_popup_pinned');
    } else if (status === gsUtils.STATUS_TEMPWHITELIST) {
      statusDetail = `${chrome.i18n.getMessage('js_popup_temp_whitelist')} <a href='#'>${chrome.i18n.getMessage('js_popup_temp_whitelist_unpause')}</a>`;
    } else if (status === gsUtils.STATUS_NOCONNECTIVITY) {
      statusDetail = chrome.i18n.getMessage('js_popup_no_connectivity');
    } else if (status === gsUtils.STATUS_CHARGING) {
      statusDetail = chrome.i18n.getMessage('js_popup_charging');
    } else if (status === gsUtils.STATUS_BLOCKED_FILE) {
      statusDetail = `${chrome.i18n.getMessage('js_popup_blockedFile')} <a href='#'>${chrome.i18n.getMessage('js_popup_blockedFile_enable')}</a>`;
    } else if (status === gsUtils.STATUS_LOADING || status === gsUtils.STATUS_UNKNOWN) {
      // gsSession.isInitialising() would need to be fetched async if still relevant
      // const sessionState = await sendMessageToBackground('getSessionState');
      // statusDetail = (sessionState && sessionState.isInitialising) ? chrome.i18n.getMessage('js_popup_initialising') : chrome.i18n.getMessage('js_popup_unknown');
      statusDetail = chrome.i18n.getMessage('js_popup_unknown'); // Simplified
    } else if (status === 'error') {
      statusDetail = chrome.i18n.getMessage('js_popup_error');
    } else {
      gsUtils.warning('popup', 'Could not process tab status of: ' + status);
    }
    document.getElementById('statusDetail').innerHTML = statusDetail;

    document.getElementById('header').classList.remove('willSuspend', 'blockedFile');
    if (status === gsUtils.STATUS_NORMAL || status === gsUtils.STATUS_ACTIVE) {
      document.getElementById('header').classList.add('willSuspend');
    }
    if (status === gsUtils.STATUS_BLOCKED_FILE) {
      document.getElementById('header').classList.add('blockedFile');
    }

    var actionEl = document.querySelector('#statusDetail a'); // More specific selector
    if (actionEl) {
      let actionName = null;
      if (status === gsUtils.STATUS_NORMAL || status === gsUtils.STATUS_ACTIVE || status === gsUtils.STATUS_FORMINPUT || status === gsUtils.STATUS_TEMPWHITELIST) {
        actionName = 'requestToggleTempWhitelistStateOfHighlightedTab';
      } else if (status === gsUtils.STATUS_WHITELISTED) {
        actionName = 'unwhitelistHighlightedTab';
      } else if (status === gsUtils.STATUS_BLOCKED_FILE) {
        actionName = 'promptForFilePermissions';
      }
      // Note: gsUtils.STATUS_SUSPENDED also used requestToggleTempWhitelistStateOfHighlightedTab previously,
      // but the link was removed from its statusDetail string. If that's still desired, it needs to be added back.


      if (globalActionElListener) {
        actionEl.removeEventListener('click', globalActionElListener);
      }
      if (actionName) {
        globalActionElListener = async function(e) {
          e.preventDefault(); // Prevent default link behavior
          const response = await sendMessageToBackground(actionName);
          if (response && response.newStatus) {
            await setStatus(response.newStatus);
          }
          // window.close(); // Consider if window should close after action
        };
        actionEl.addEventListener('click', globalActionElListener);
      }
    }
  }

  async function showPopupContents() { // Made async
    const theme = await gsStorage.getOption(gsStorage.THEME); // await
    if (theme === 'dark') {
      document.body.classList.add('dark');
    }
  }

  function addClickHandlers() {
    // Helper for click handlers that send a message and close the window
    const createHandler = (action, payload = {}) => async (e) => {
      try {
        await sendMessageToBackground(action, payload);
      } catch (err) {
        console.error(`Error performing action ${action}:`, err);
        // Optionally display an error to the user in the popup
      }
      window.close();
    };
    
    const createStatusUpdateHandler = (action, payload = {}, newStatus) => async (e) => {
        try {
            await sendMessageToBackground(action, payload);
            await setStatus(newStatus); // Update status locally in popup
        } catch (err) {
            console.error(`Error performing action ${action}:`, err);
        }
        // window.close(); // Decide if window should close
    };


    document.getElementById('unsuspendOne').addEventListener('click', createHandler('unsuspendHighlightedTab'));
    document.getElementById('suspendOne').addEventListener('click', createHandler('suspendHighlightedTab'));
    document.getElementById('suspendAll').addEventListener('click', createHandler('suspendAllTabs', { force: false }));
    document.getElementById('unsuspendAll').addEventListener('click', createHandler('unsuspendAllTabs'));
    document.getElementById('suspendSelected').addEventListener('click', createHandler('suspendSelectedTabs'));
    document.getElementById('unsuspendSelected').addEventListener('click', createHandler('unsuspendSelectedTabs'));
    
    document.getElementById('whitelistDomain').addEventListener('click', createStatusUpdateHandler('whitelistHighlightedTab', { includePath: false }, gsUtils.STATUS_WHITELISTED));
    document.getElementById('whitelistPage').addEventListener('click', createStatusUpdateHandler('whitelistHighlightedTab', { includePath: true }, gsUtils.STATUS_WHITELISTED));

    document.getElementById('settingsLink').addEventListener('click', function(e) {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
      window.close();
    });
  }
})(this);
