/*global gsUtils, gsIndexedDb, chrome */
// eslint-disable-next-line no-unused-vars
var gsFavicon = (function() {
  'use strict';

  const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

  const GOOGLE_S2_URL = 'https://www.google.com/s2/favicons?sz=32&domain_url='; // Using 32px for better quality
  const FALLBACK_DEFAULT_FAVICON_META = { // Renamed and updated
    favIconUrl: 'img/chromeDefaultFavicon.png', // Placeholder, will be processed
    isDark: true, // Assuming default is dark, can be refined by processing the actual default icon
    // These will be populated by processing the actual default icon in initAsPromised
    normalisedDataUrl: '', 
    transparentDataUrl: '',
  };

  const _defaultFaviconFingerprintById = {};
  let _processedDefaultFaviconMeta; // Renamed
  let creatingOffscreenDocument = null;


  async function hasOffscreenDocument() {
    if (chrome.runtime.getContexts) { // Check if getContexts is available (MV3)
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
        });
        return !!contexts && contexts.length > 0;
    }
    return false; // Fallback for environments where getContexts isn't available (e.g. older Chrome versions or non-MV3)
  }

  async function createOffscreenDocument() {
    if (creatingOffscreenDocument) {
      await creatingOffscreenDocument;
      return;
    }
    if (!(await hasOffscreenDocument())) {
      creatingOffscreenDocument = chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.CANVAS_CONTEXT_CREATION, chrome.offscreen.Reason.DOM_PARSER], // DOM_SCRAPING might be too broad.
        justification: 'Processing favicons using Image and Canvas',
      });
      await creatingOffscreenDocument;
      creatingOffscreenDocument = null;
    }
  }

  async function sendMessageToOffscreenDocument(action, payload) {
    await createOffscreenDocument(); // Ensure document exists
    try {
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen', // Optional: helps target if multiple message listeners
        action: action,
        ...payload,
      });
      if (response && response.success) {
        return response.data;
      } else {
        const errorMessage = response && response.error ? response.error : 'Unknown error in offscreen document.';
        console.warn(`Offscreen document error for action ${action}:`, errorMessage);
        throw new Error(`Offscreen: ${errorMessage}`);
      }
    } catch (e) {
        // Handle cases where the offscreen document might have been closed or an error occurred
        console.error(`Error sending message to offscreen document for action ${action}:`, e);
        // Attempt to close and recreate the document if it seems to be an issue with the document itself
        if (e.message.includes("Could not establish connection") || e.message.includes("Target context invalidated")) {
            try {
                await chrome.offscreen.closeDocument();
            } catch (closeError) {
                // Ignore errors during close, might already be closed or in a bad state
            }
            // Retry sending the message once after attempting to recreate.
            // This avoids an infinite loop if recreation also fails.
            await createOffscreenDocument();
             const retryResponse = await chrome.runtime.sendMessage({
                target: 'offscreen',
                action: action,
                ...payload,
            });
            if (retryResponse && retryResponse.success) {
                return retryResponse.data;
            } else {
                 const retryErrorMessage = retryResponse && retryResponse.error ? retryResponse.error : 'Unknown error after retry.';
                 throw new Error(`Offscreen (after retry): ${retryErrorMessage}`);
            }
        }
        throw e; // Re-throw original error if not a connection issue or if retry failed
    }
  }


  async function initAsPromised() {
    // Process the actual default icon to populate FALLBACK_DEFAULT_FAVICON_META
    try {
        const defaultIconPath = chrome.runtime.getURL(FALLBACK_DEFAULT_FAVICON_META.favIconUrl);
        const processedMeta = await buildFaviconMetaData(defaultIconPath);
        if (processedMeta) {
            FALLBACK_DEFAULT_FAVICON_META.normalisedDataUrl = processedMeta.normalisedDataUrl;
            FALLBACK_DEFAULT_FAVICON_META.transparentDataUrl = processedMeta.transparentDataUrl;
            FALLBACK_DEFAULT_FAVICON_META.isDark = processedMeta.isDark; // Update isDark based on actual processing
        }
    } catch (e) {
        gsUtils.warning('gsFavicon', `Failed to process default favicon: ${e}. Using hardcoded fallback values.`);
        // Fallback to hardcoded values if processing fails (already set partially)
        FALLBACK_DEFAULT_FAVICON_META.normalisedDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYklEQVQ4T2NkoBAwIuuPior6j8O8xmXLljVgk8MwYNmyZdgMfcjAwLAAmyFEGfDv3z9FJiamA9gMIcoAkKsiIiIUsBlClAHofkf2JkED0DWDAnrUgOEfBsRkTpzpgBjN6GoA24V1Efr1zoAAAAAASUVORK5CYII=';
        FALLBACK_DEFAULT_FAVICON_META.transparentDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaUlEQVQ4T2NkoBAwIuuPioqqx2YeExPTwSVLlhzAJodhwLJlyxrRDWVkZPzIyMh4AZshRBnAxsY28ffv3wnYDCHKAJCrEhISBLAZQpQB6H5H9iZBA9A1gwJ61IDhHwbEZE6c6YAYzehqAAmQeBHM42eMAAAAAElFTkSuQmCC';
    }
    _processedDefaultFaviconMeta = FALLBACK_DEFAULT_FAVICON_META;
    await addFaviconDefaults(); // For other default-like icons (e.g. suspendy icon)
    gsUtils.log('gsFavicon', 'init successful');
  }

  async function addFaviconDefaults() {
    // These are icons that, if detected, should be treated as "no real favicon"
    const defaultIconUrls = [
      // chrome.runtime.getURL('img/chromeDefaultFavicon.png'), // This is now the primary _processedDefaultFaviconMeta
      chrome.runtime.getURL('img/ic_suspendy_16x16.png'),
      // Add any other icons that represent a "default" or "missing" state
    ];

    for (const iconUrl of defaultIconUrls) {
      try {
        const faviconMeta = await addDefaultFaviconMeta(iconUrl);
        if (faviconMeta) {
          gsUtils.log('gsFavicon', `Successfully built default-like faviconMeta for url: ${iconUrl}`);
        } else {
          gsUtils.warning('gsFavicon', `Failed to build default-like faviconMeta for url: ${iconUrl}`);
        }
      } catch (e) {
         gsUtils.warning('gsFavicon', `Error processing default-like icon ${iconUrl}: ${e}`);
      }
    }
  }

  async function addDefaultFaviconMeta(url) {
    let faviconMeta;
    try {
      faviconMeta = await gsUtils.executeWithRetries(
        buildFaviconMetaData, 
        [url],
        2, 
        100 
      );
    } catch (e) {
      gsUtils.warning('gsFavicon', `addDefaultFaviconMeta failed for ${url}: ${e}`);
      return null; 
    }
    if (faviconMeta) { 
        await addFaviconMetaToDefaultFingerprints(faviconMeta, url);
    }
    return faviconMeta;
  }

  async function addFaviconMetaToDefaultFingerprints(faviconMeta, id) {
    if (!faviconMeta || !faviconMeta.normalisedDataUrl || !faviconMeta.transparentDataUrl) {
        gsUtils.warning('gsFavicon', `Skipping fingerprint for ${id} due to missing dataUrl in faviconMeta.`);
        return;
    }
    try {
        const normFingerprint = await createImageFingerprint(faviconMeta.normalisedDataUrl);
        if (normFingerprint) _defaultFaviconFingerprintById[`norm_${id}`] = normFingerprint;

        const transFingerprint = await createImageFingerprint(faviconMeta.transparentDataUrl);
        if (transFingerprint) _defaultFaviconFingerprintById[`trans_${id}`] = transFingerprint;

    } catch (e) {
        gsUtils.warning('gsFavicon', `Failed to create fingerprint for ${id}: ${e}`);
    }
  }

  async function getFaviconMetaData(tab) {
    if (!tab || !tab.url) return _processedDefaultFaviconMeta;
    if (gsUtils.isFileTab(tab)) {
      return _processedDefaultFaviconMeta;
    }

    let originalUrl = tab.url;
    if (gsUtils.isSuspendedTab(tab)) {
      originalUrl = gsUtils.getOriginalUrl(tab.url);
      if (!originalUrl) return _processedDefaultFaviconMeta; // Cannot determine original URL
    }

    let faviconMeta = await getCachedFaviconMetaData(originalUrl);
    if (faviconMeta) {
      return faviconMeta;
    }

    // 1. Try tab.favIconUrl directly
    if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://') && tab.favIconUrl !== chrome.runtime.getURL('img/ic_suspendy_16x16.png')) {
      gsUtils.log(tab.id, `Attempting to build favicon from tab.favIconUrl: ${tab.favIconUrl}`);
      faviconMeta = await buildFaviconMetaFromTabFavIconUrl(tab.favIconUrl);
      if (faviconMeta) {
        gsUtils.log(tab.id, 'Built faviconMeta from tab.favIconUrl', faviconMeta);
        await saveFaviconMetaDataToCache(originalUrl, faviconMeta);
        return faviconMeta;
      }
    }
    
    // 2. Try Google S2 Service as a fallback
    gsUtils.log(tab.id, `Falling back to Google S2 service for: ${originalUrl}`);
    const s2Url = GOOGLE_S2_URL + encodeURIComponent(originalUrl);
    try {
      faviconMeta = await buildFaviconMetaData(s2Url);
      if (await isFaviconMetaValid(faviconMeta)) { // Validate to avoid caching generic Google icons
        gsUtils.log(tab.id, 'Built faviconMeta from Google S2 service', faviconMeta);
        await saveFaviconMetaDataToCache(originalUrl, faviconMeta);
        return faviconMeta;
      } else {
        gsUtils.log(tab.id, 'Google S2 service returned an invalid or default-like icon.');
      }
    } catch (e) {
      gsUtils.warning('gsFavicon', `Google S2 service failed for ${originalUrl}: ${e}`);
    }

    gsUtils.log(tab.id, 'Failed to build faviconMeta from all sources. Using default icon.');
    return _processedDefaultFaviconMeta;
  }

  // This function is now effectively a wrapper around buildFaviconMetaData if needed,
  // or can be removed if direct calls to buildFaviconMetaData with tab.favIconUrl are sufficient.
  // For now, keeping its structure but it directly calls buildFaviconMetaData.
  async function buildFaviconMetaFromTabFavIconUrl(favIconUrl) {
    try {
      const faviconMeta = await buildFaviconMetaData(favIconUrl); 
      if (await isFaviconMetaValid(faviconMeta)) { // Ensure it's not a default-like icon
          return faviconMeta;
      }
    } catch (e) {
      gsUtils.warning('gsFavicon', `buildFaviconMetaFromTabFavIconUrl failed for ${favIconUrl}: ${e}`);
    }
    return null;
  }
  
  // Removed buildFaviconMetaFromChromeFaviconCache as chrome://favicon is no longer used.

  async function getCachedFaviconMetaData(url) {
    if (!url) return null;
    const fullUrl = gsUtils.getRootUrl(url, true, false);
    let faviconMetaData = await gsIndexedDb.fetchFaviconMeta(fullUrl);
    if (!faviconMetaData) {
      const rootUrl = gsUtils.getRootUrl(url, false, false);
      faviconMetaData = await gsIndexedDb.fetchFaviconMeta(rootUrl);
    }
    return faviconMetaData || null;
  }

  async function saveFaviconMetaDataToCache(url, faviconMeta) {
     if (!faviconMeta || typeof faviconMeta !== 'object' || Object.keys(faviconMeta).length === 0) {
        gsUtils.warning('gsFavicon', `Attempted to save empty or invalid faviconMeta for ${url}. Skipping.`);
        return;
    }
    const fullUrl = gsUtils.getRootUrl(url, true, false);
    const rootUrl = gsUtils.getRootUrl(url, false, false);
    gsUtils.log(
      'gsFavicon',
      'Saving favicon cache entry for: ' + fullUrl,
      faviconMeta
    );
    await gsIndexedDb.addFaviconMeta(fullUrl, Object.assign({}, faviconMeta));
    await gsIndexedDb.addFaviconMeta(rootUrl, Object.assign({}, faviconMeta));
  }


  async function isFaviconMetaValid(faviconMeta) {
    if (
      !faviconMeta ||
      !faviconMeta.normalisedDataUrl || // check for actual data existence
      faviconMeta.normalisedDataUrl === 'data:,' ||
      !faviconMeta.transparentDataUrl || // check for actual data existence
      faviconMeta.transparentDataUrl === 'data:,'
    ) {
      return false;
    }
    
    let normalisedFingerprint, transparentFingerprint;
    try {
        normalisedFingerprint = await createImageFingerprint(
            faviconMeta.normalisedDataUrl
        );
        transparentFingerprint = await createImageFingerprint(
            faviconMeta.transparentDataUrl
        );
    } catch (e) {
        gsUtils.warning('gsFavicon', `Fingerprint creation failed during validation: ${e}`);
        return false; // Cannot validate if fingerprinting fails
    }


    for (let id of Object.keys(_defaultFaviconFingerprintById)) {
      const defaultFaviconFingerprint = _defaultFaviconFingerprintById[id];
      if (
        normalisedFingerprint === defaultFaviconFingerprint ||
        transparentFingerprint === defaultFaviconFingerprint
      ) {
        gsUtils.log(
          'gsFavicon',
          'FaviconMeta not valid as it matches fingerprint of default favicon: ' +
            id,
          faviconMeta
        );
        return false;
      }
    }
    return true;
  }

  // Turns the img into a 16x16 black and white dataUrl using offscreen document
  async function createImageFingerprint(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
        gsUtils.warning('gsFavicon', `Invalid dataUrl provided for createImageFingerprint: ${String(dataUrl).substring(0,100)}`);
        throw new Error('Invalid dataUrl for createImageFingerprint');
    }
    return sendMessageToOffscreenDocument('createImageFingerprint', { dataUrl });
  }

  // Sends URL to offscreen document for processing
  async function buildFaviconMetaData(url, timeout = 5000) {
     if (!url || typeof url !== 'string' ) {
        gsUtils.warning('gsFavicon', `Invalid URL provided for buildFaviconMetaData: ${url}`);
        throw new Error('Invalid URL for buildFaviconMetaData');
    }
    return sendMessageToOffscreenDocument('buildFaviconMetaData', { url, timeout });
  }

  return {
    initAsPromised,
    getFaviconMetaData,
    generateChromeFavIconUrlFromUrl,
    buildFaviconMetaFromChromeFaviconCache, // Retain for direct calls if needed, now uses offscreen
    saveFaviconMetaDataToCache,
  };
})();
