// Lossless IPC transport boundary for IINA WebViews.
// Both WebViews decode the envelope with decodeURIComponent followed by JSON.parse.
// Leave ordinary JSON and Unicode literal, even when one field needs an envelope.

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

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
    return /[`\u2018-\u201D]|\$\{/.test(value) || loneSurrogate.test(value);
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
    let json = JSON.stringify(payload);
    if (loneSurrogate.test(json)) json = escapeLoneSurrogates(json);
    // A literal percent must also survive the receiver's single URI decode.
    payload = { __encoded: json.replace(/[%`\u2018-\u201D]|\$(?=\{)/g, encodeURIComponent) };
  }
  target.postMessage(key, payload);
}

module.exports = {
  needsIPCEnvelope: needsIPCEnvelope,
  postSafeMessage: postSafeMessage
};
