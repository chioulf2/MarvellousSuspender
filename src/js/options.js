/*global chrome, gsStorage, gsChrome, gsUtils, console */ // Added console for logging
(function(global) {
  // MV3: Direct background page access is not allowed.
  // Necessary utilities like gsStorage, gsUtils should be available if options.html includes them,
  // or communication should happen via chrome.runtime.sendMessage.
  // For gsStorage, its methods are now async. gsUtils might also have async methods.

  var elementPrefMap = {
    preview: gsStorage.SCREEN_CAPTURE,
    forceScreenCapture: gsStorage.SCREEN_CAPTURE_FORCE,
    suspendInPlaceOfDiscard: gsStorage.SUSPEND_IN_PLACE_OF_DISCARD,
    onlineCheck: gsStorage.IGNORE_WHEN_OFFLINE,
    batteryCheck: gsStorage.IGNORE_WHEN_CHARGING,
    unsuspendOnFocus: gsStorage.UNSUSPEND_ON_FOCUS,
    claimByDefault: gsStorage.CLAIM_BY_DEFAULT,
    discardAfterSuspend: gsStorage.DISCARD_AFTER_SUSPEND,
    dontSuspendPinned: gsStorage.IGNORE_PINNED,
    dontSuspendForms: gsStorage.IGNORE_FORMS,
    dontSuspendAudio: gsStorage.IGNORE_AUDIO,
    dontSuspendActiveTabs: gsStorage.IGNORE_ACTIVE_TABS,
    ignoreCache: gsStorage.IGNORE_CACHE,
    addContextMenu: gsStorage.ADD_CONTEXT,
    syncSettings: gsStorage.SYNC_SETTINGS,
    timeToSuspend: gsStorage.SUSPEND_TIME,
    theme: gsStorage.THEME,
    whitelist: gsStorage.WHITELIST,
  };


  function selectComboBox(element, key) {
    var i, child;

    for (i = 0; i < element.children.length; i += 1) {
      child = element.children[i];
      if (child.value === key) {
        child.selected = 'true';
        break;
      }
    }
  }

  //populate settings from synced storage
  async function initSettings() { // Made async
    //Set theme
    try {
      document.body.classList.toggle('dark', await gsStorage.getOption(gsStorage.THEME) === 'dark');

      var optionEls = document.getElementsByClassName('option'),
        pref,
        element,
        i;
      for (i = 0; i < optionEls.length; i++) {
        element = optionEls[i];
        pref = elementPrefMap[element.id];
        if (pref) { // Ensure pref exists to avoid errors
          populateOption(element, await gsStorage.getOption(pref));
        } else {
          console.warn('No preference mapping for element id:', element.id);
        }
      }

      addClickHandlers();

      setForceScreenCaptureVisibility(
        await gsStorage.getOption(gsStorage.SCREEN_CAPTURE) !== '0',
      );
      setAutoSuspendOptionsVisibility(
        parseFloat(await gsStorage.getOption(gsStorage.SUSPEND_TIME)) > 0,
      );
      setSyncNoteVisibility(!await gsStorage.getOption(gsStorage.SYNC_SETTINGS));
    } catch (e) {
      console.error("Error during initSettings:", e);
      // Potentially display an error message to the user on the options page
    }

    let searchParams = new URL(location.href).searchParams;
    if (searchParams.has('firstTime')) {
      document
        .querySelector('.welcome-message')
        .classList.remove('reallyHidden');
      document.querySelector('#options-heading').classList.add('reallyHidden');
    }
  }

  function addClickHandlers() {
    document.getElementById('preview').addEventListener('change', function() {
      if (this.value === '1' || this.value === '2') {
        chrome.permissions.request({
          origins: [
            'http://*/*',
            'https://*/*',
            'file://*/*',
          ],
        }, function(granted) {
          if (!granted) {
            let select = document.getElementById('preview');
            select.value = '0';
            select.dispatchEvent(new Event('change'));
          }
        });
      }
    });

  }

  function populateOption(element, value) {
    if (
      element.tagName === 'INPUT' &&
      element.hasAttribute('type') &&
      element.getAttribute('type') === 'checkbox'
    ) {
      element.checked = value;
    } else if (element.tagName === 'SELECT') {
      selectComboBox(element, value);
    } else if (element.tagName === 'TEXTAREA') {
      element.value = value;
    }
  }

  function getOptionValue(element) {
    if (
      element.tagName === 'INPUT' &&
      element.hasAttribute('type') &&
      element.getAttribute('type') === 'checkbox'
    ) {
      return element.checked;
    }
    if (element.tagName === 'SELECT') {
      return element.children[element.selectedIndex].value;
    }
    if (element.tagName === 'TEXTAREA') {
      return element.value;
    }
  }

  function setForceScreenCaptureVisibility(visible) {
    if (visible) {
      document.getElementById('forceScreenCaptureContainer').style.display =
        'block';
    } else {
      document.getElementById('forceScreenCaptureContainer').style.display =
        'none';
    }
  }

  function setSyncNoteVisibility(visible) {
    if (visible) {
      document.getElementById('syncNote').style.display = 'block';
    } else {
      document.getElementById('syncNote').style.display = 'none';
    }
  }

  function setAutoSuspendOptionsVisibility(visible) {
    Array.prototype.forEach.call(
      document.getElementsByClassName('autoSuspendOption'),
      function(el) {
        if (visible) {
          el.style.display = 'block';
        } else {
          el.style.display = 'none';
        }
      },
    );
  }

  function handleChange(element) {
    return async function() { // Made async
      var pref = elementPrefMap[element.id],
        interval;

      //add specific screen element listeners
      if (pref === gsStorage.SCREEN_CAPTURE) {
        setForceScreenCaptureVisibility(getOptionValue(element) !== '0');
      } else if (pref === gsStorage.SUSPEND_TIME) {
        interval = getOptionValue(element);
        setAutoSuspendOptionsVisibility(interval > 0);
      } else if (pref === gsStorage.SYNC_SETTINGS) {
        // we only really want to show this on load. not on toggle
        if (getOptionValue(element)) {
          setSyncNoteVisibility(false);
        }
      } else if (pref === gsStorage.THEME) {
        // when the user changes the theme, it reloads the page to apply instantly the modification
        // Before reloading, ensure the setting is saved
        await saveChange(element); // Ensure save completes
        window.location.reload();
        return; // Return early as page is reloading
      }

      var [oldValue, newValue] = await saveChange(element); // Made await
      if (oldValue !== newValue) {
        var prefKey = elementPrefMap[element.id];
        // Assuming gsUtils.performPostSaveUpdates is either synchronous or doesn't need to be awaited for handleChange to complete
        // If it becomes async and critical for subsequent UI, it should be awaited.
        if (typeof gsUtils.performPostSaveUpdates === 'function') {
            gsUtils.performPostSaveUpdates(
              [prefKey],
              { [prefKey]: oldValue },
              { [prefKey]: newValue },
            );
        }
      }
    };
  }

  async function saveChange(element) { // Made async
    var pref = elementPrefMap[element.id];
    var oldValue = await gsStorage.getOption(pref); // Made await
    var newValue = getOptionValue(element);

    //clean up whitelist before saving
    if (pref === gsStorage.WHITELIST) {
      newValue = gsUtils.cleanupWhitelist(newValue);
    }

    //save option
    if (oldValue !== newValue) {
      await gsStorage.setOptionAndSync(elementPrefMap[element.id], newValue); // Made await
    }

    return [oldValue, newValue];
  }

  gsUtils.documentReadyAndLocalisedAsPromised(document).then(async function() { // Made async
    await initSettings(); // Made await

    var optionEls = document.getElementsByClassName('option'),
      element,
      i;

    //add change listeners for all 'option' elements
    for (i = 0; i < optionEls.length; i++) {
      element = optionEls[i];
      if (element.tagName === 'TEXTAREA') {
        element.addEventListener(
          'input',
          gsUtils.debounce(handleChange(element), 200),
          false,
        );
      } else {
        element.onchange = handleChange(element);
      }
    }

    document.getElementById('testWhitelistBtn').onclick = async e => {
      e.preventDefault();
      const tabs = await gsChrome.tabsQuery();
      const tabUrls = tabs
        .map(
          tab =>
            gsUtils.isSuspendedTab(tab)
              ? gsUtils.getOriginalUrl(tab.url)
              : tab.url,
        )
        .filter(
          url => !gsUtils.isSuspendedUrl(url) && gsUtils.checkWhiteList(url),
        )
        .map(url => (url.length > 55 ? url.substr(0, 52) + '...' : url));
      if (tabUrls.length === 0) {
        alert(chrome.i18n.getMessage('js_options_whitelist_no_matches'));
        return;
      }
      const firstUrls = tabUrls.splice(0, 22);
      let alertString = `${chrome.i18n.getMessage(
        'js_options_whitelist_matches_heading',
      )}\n${firstUrls.join('\n')}`;

      if (tabUrls.length > 0) {
        alertString += `\n${chrome.i18n.getMessage(
          'js_options_whitelist_matches_overflow_prefix',
        )} ${tabUrls.length} ${chrome.i18n.getMessage(
          'js_options_whitelist_matches_overflow_suffix',
        )}`;
      }
      alert(alertString);
    };

    //hide incompatible sidebar items if in incognito mode
    if (chrome.extension.inIncognitoContext) {
      Array.prototype.forEach.call(
        document.getElementsByClassName('noIncognito'),
        function(el) {
          el.style.display = 'none';
        },
      );
      window.alert(chrome.i18n.getMessage('js_options_incognito_warning'));
    }
  });


  global.exports = {
    initSettings,
  };
})(this);
