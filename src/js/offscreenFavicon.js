// src/js/offscreenFavicon.js
'use strict';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'buildFaviconMetaData') {
    buildFaviconMetaData(request.url, request.timeout)
      .then(faviconMetaData => {
        sendResponse({ success: true, data: faviconMetaData });
      })
      .catch(error => {
        sendResponse({ success: false, error: String(error) });
      });
    return true; // Indicates that the response is sent asynchronously
  } else if (request.action === 'createImageFingerprint') {
    createImageFingerprint(request.dataUrl)
      .then(fingerprintDataUrl => {
        sendResponse({ success: true, data: fingerprintDataUrl });
      })
      .catch(error => {
        sendResponse({ success: false, error: String(error) });
      });
    return true; // Indicates that the response is sent asynchronously
  }
});

// This function is adapted from the original gsFavicon.js
// It contains the DOM-dependent logic.
function buildFaviconMetaData(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    let imageLoaded = false;

    img.onload = () => {
      imageLoaded = true;

      let canvas;
      let context;
      canvas = document.createElement('canvas'); // DOM operation
      canvas.width = img.width;
      canvas.height = img.height;
      context = canvas.getContext('2d');
      context.drawImage(img, 0, 0);

      let imageData;
      try {
        imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      } catch (e) {
        reject(
          new Error(
            `Failed to getImageData for ${url}. Error: ${String(e)}`
          )
        );
        return;
      }

      const origDataArray = imageData.data;
      const normalisedDataArray = new Uint8ClampedArray(origDataArray);
      const transparentDataArray = new Uint8ClampedArray(origDataArray);

      let r, g, b, a;
      let fuzzy = 0.1;
      let light = 0;
      let dark = 0;
      let maxAlpha = 0;

      for (let x = 0; x < origDataArray.length; x += 4) {
        r = origDataArray[x];
        g = origDataArray[x + 1];
        b = origDataArray[x + 2];
        a = origDataArray[x + 3];

        let localMaxRgb = Math.max(Math.max(r, g), b);
        if (localMaxRgb < 128 || a < 128) dark++;
        else light++;
        maxAlpha = Math.max(a, maxAlpha);
      }

      if (maxAlpha === 0) {
        reject(
          new Error(
            `Aborting favicon generation as image is completely transparent. url: ${url}`
          )
        );
        return;
      }

      const darkLightDiff = (light - dark) / (canvas.width * canvas.height);
      const isDark = darkLightDiff + fuzzy < 0;
      const normaliserMultiple = 1 / (maxAlpha / 255);

      for (let x = 0; x < origDataArray.length; x += 4) {
        a = origDataArray[x + 3];
        normalisedDataArray[x + 3] = parseInt(a * normaliserMultiple, 10);
      }
      for (let x = 0; x < normalisedDataArray.length; x += 4) {
        a = normalisedDataArray[x + 3];
        transparentDataArray[x + 3] = parseInt(a * 0.5, 10);
      }

      imageData.data.set(normalisedDataArray);
      context.putImageData(imageData, 0, 0);
      const normalisedDataUrl = canvas.toDataURL('image/png');

      imageData.data.set(transparentDataArray);
      context.putImageData(imageData, 0, 0);
      const transparentDataUrl = canvas.toDataURL('image/png');

      const faviconMetaData = {
        favIconUrl: url,
        isDark,
        normalisedDataUrl,
        transparentDataUrl,
      };
      resolve(faviconMetaData);
    };

    img.onerror = () => {
      imageLoaded = true; // consider it "loaded" to prevent timeout rejection if onerror fires first
      reject(new Error(`Failed to load image (onerror) from: ${url}`));
    };
    
    img.src = url;

    const timer = setTimeout(() => {
      if (!imageLoaded) {
        // Important: if img.onerror fired, imageLoaded would be true.
        // This timeout handles cases where neither onload nor onerror fire (e.g. network issue, invalid URL that doesn't trigger onerror quickly)
        reject(new Error(`Image load timed out for: ${url}`));
      }
    }, timeout);
    
    img.onload = () => { // This needs to be before img.src for certain edge cases, but also clear timeout here
        clearTimeout(timer); // Clear the timeout if the image loads successfully
        imageLoaded = true;
        // ... rest of the onload logic from before
        let canvas;
        let context;
        canvas = document.createElement('canvas'); // DOM operation
        canvas.width = img.width;
        canvas.height = img.height;
        context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);

        let imageData;
        try {
          imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        } catch (e) {
          reject(
            new Error(
              `Failed to getImageData for ${url}. Error: ${String(e)}`
            )
          );
          return;
        }

        const origDataArray = imageData.data;
        const normalisedDataArray = new Uint8ClampedArray(origDataArray);
        const transparentDataArray = new Uint8ClampedArray(origDataArray);

        let r, g, b, a;
        let fuzzy = 0.1;
        let light = 0;
        let dark = 0;
        let maxAlpha = 0;

        for (let x = 0; x < origDataArray.length; x += 4) {
          r = origDataArray[x];
          g = origDataArray[x + 1];
          b = origDataArray[x + 2];
          a = origDataArray[x + 3];

          let localMaxRgb = Math.max(Math.max(r, g), b);
          if (localMaxRgb < 128 || a < 128) dark++;
          else light++;
          maxAlpha = Math.max(a, maxAlpha);
        }

        if (maxAlpha === 0) {
          reject(
            new Error(
              `Aborting favicon generation as image is completely transparent. url: ${url}`
            )
          );
          return;
        }

        const darkLightDiff = (light - dark) / (canvas.width * canvas.height);
        const isDark = darkLightDiff + fuzzy < 0;
        const normaliserMultiple = 1 / (maxAlpha / 255);

        for (let x = 0; x < origDataArray.length; x += 4) {
          a = origDataArray[x + 3];
          normalisedDataArray[x + 3] = parseInt(a * normaliserMultiple, 10);
        }
        for (let x = 0; x < normalisedDataArray.length; x += 4) {
          a = normalisedDataArray[x + 3];
          transparentDataArray[x + 3] = parseInt(a * 0.5, 10);
        }

        imageData.data.set(normalisedDataArray);
        context.putImageData(imageData, 0, 0);
        const normalisedDataUrl = canvas.toDataURL('image/png');

        imageData.data.set(transparentDataArray);
        context.putImageData(imageData, 0, 0);
        const transparentDataUrl = canvas.toDataURL('image/png');

        const faviconMetaData = {
          favIconUrl: url,
          isDark,
          normalisedDataUrl,
          transparentDataUrl,
        };
        resolve(faviconMetaData);
    };
  });
}


// This function is adapted from the original gsFavicon.js
function createImageFingerprint(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async function() {
      const canvas = document.createElement('canvas'); // DOM Operation
      const context = canvas.getContext('2d');
      const threshold = 80;

      canvas.width = 16;
      canvas.height = 16;
      context.drawImage(img, 0, 0, 16, 16);

      const imageData = context.getImageData(0, 0, 16, 16);
      for (var i = 0; i < imageData.data.length; i += 4) {
        var luma = Math.floor(
          imageData.data[i] * 0.3 +
            imageData.data[i + 1] * 0.59 +
            imageData.data[i + 2] * 0.11
        );
        imageData.data[i] = imageData.data[i + 1] = imageData.data[i + 2] =
          luma > threshold ? 255 : 0;
        imageData.data[i + 3] = 255;
      }
      context.putImageData(imageData, 0, 0);
      const fingerprintDataUrl = canvas.toDataURL('image/png');
      resolve(fingerprintDataUrl);
    };
    img.onerror = () => {
      reject(new Error(`Failed to load image for fingerprinting from: ${dataUrl.substring(0, 100)}...`));
    };
    img.src = dataUrl;
  });
}
