// Lossless IPC transport boundary for IINA WebViews.
// Payloads containing template syntax, curly quotes, or lone UTF-16 surrogates
// travel inside a URI-encoded JSON envelope; ordinary payloads stay plain objects.

function escapeLoneSurrogates(text) {
  return text.replace(/[\uD800-\uDFFF]/g, function (unit, index) {
    let code = unit.charCodeAt(0);
    let paired = code <= 0xDBFF
      ? text.charCodeAt(index + 1) >= 0xDC00 && text.charCodeAt(index + 1) <= 0xDFFF
      : text.charCodeAt(index - 1) >= 0xD800 && text.charCodeAt(index - 1) <= 0xDBFF;
    return paired ? unit : '\\u' + code.toString(16);
  });
}

function needsIPCEnvelope(value) {
  if (typeof value === 'string') {
    return /[`\u2018-\u201D]|\$\{/.test(value) || escapeLoneSurrogates(value) !== value;
  }
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some(function (key) {
    return needsIPCEnvelope(key) || needsIPCEnvelope(value[key]);
  });
}

function postSafeMessage(target, key, data) {
  let payload = data === undefined ? {} : data;
  if (needsIPCEnvelope(payload)) {
    // Older JavaScriptCore versions may stringify lone surrogates literally.
    // JSON Unicode escapes preserve the original code units and are URI-safe.
    let json = escapeLoneSurrogates(JSON.stringify(payload));
    payload = { __encoded: encodeURIComponent(json) };
  }
  target.postMessage(key, payload);
}

module.exports = {
  escapeLoneSurrogates: escapeLoneSurrogates,
  needsIPCEnvelope: needsIPCEnvelope,
  postSafeMessage: postSafeMessage
};
