// i18n dictionary for main-process OSD, menu items, and file dialog titles
// (sidebar UI strings live in sidebar/index.js).

const PLUGIN_I18N = {
  en: {
    render_failed: "Cannot render this danmaku file",
    ddp_auth_error: "DanDanPlay: authentication failed (403)",
    ddp_no_results: "No results found",
    menu_toggle: "Toggle Danmaku",
    menu_load_file: "Load Danmaku File…",
    menu_show_overlay: "Show Danmaku Overlay",
    menu_hide_overlay: "Hide Danmaku Overlay",
    choose_file_title: "Select Danmaku File",
    danmaku_on: "Danmaku enabled",
    danmaku_off: "Danmaku disabled",
    loaded: "Danmaku loaded: ",
    network_loaded: "Network danmaku loaded: ",
    queued: "Danmaku queued…",
    read_failed: "Cannot read danmaku file",
    read_failed_name: "Cannot read danmaku file: ",
    content_unavailable: "Danmaku content unavailable",
    seek_disable: "Danmaku: seek disabled",
    seek_enable: "Danmaku: seek enabled",
    jump: "Danmaku jump: ",
    network_skip_local: "Network resource — skipping local danmaku",
    ddp_no_match: "DanDanPlay: no match found",
    ddp_network_error: "DanDanPlay: network error",
    ddp_api_error: "DanDanPlay: API response error",
    ddp_no_comments: "DanDanPlay: no danmaku for this video",
    ddp_load_failed: "DanDanPlay: failed to load danmaku",
    cache_stale: " (old)",
    duration_mismatch: "Duration mismatch with danmaku file: offset set to {offset}s",
    duration_mismatch_no_offset: "Duration mismatch with danmaku file"
  },
  ja: {
    render_failed: "\u3053\u306e\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u63cf\u753b\u3067\u304d\u307e\u305b\u3093",
    ddp_auth_error: "\u5f3e\u5f3ePlay: \u8a8d\u8a3c\u306b\u5931\u6557\u3057\u307e\u3057\u305f (403)",
    ddp_no_results: "\u691c\u7d22\u7d50\u679c\u304c\u3042\u308a\u307e\u305b\u3093",
    menu_toggle: "\u30b3\u30e1\u30f3\u30c8\u8868\u793a\u3092\u5207\u308a\u66ff\u3048",
    menu_load_file: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u3080\u2026",
    menu_show_overlay: "\u30b3\u30e1\u30f3\u30c8\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u3092\u8868\u793a",
    menu_hide_overlay: "\u30b3\u30e1\u30f3\u30c8\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u3092\u96a0\u3059",
    choose_file_title: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u9078\u629e",
    danmaku_on: "\u30b3\u30e1\u30f3\u30c8\u30aa\u30f3",
    danmaku_off: "\u30b3\u30e1\u30f3\u30c8\u30aa\u30d5",
    loaded: "\u30b3\u30e1\u30f3\u30c8\u8aad\u307f\u8fbc\u307f\u5b8c\u4e86: ",
    network_loaded: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30b3\u30e1\u30f3\u30c8\u3092\u8aad\u307f\u8fbc\u307f\u307e\u3057\u305f: ",
    queued: "\u30b3\u30e1\u30f3\u30c8\u3092\u6e96\u5099\u4e2d\u2026",
    read_failed: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093",
    read_failed_name: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093: ",
    content_unavailable: "\u30b3\u30e1\u30f3\u30c8\u5185\u5bb9\u3092\u5229\u7528\u3067\u304d\u307e\u305b\u3093",
    seek_disable: "\u30b3\u30e1\u30f3\u30c8: \u30b7\u30fc\u30af\u7981\u6b62",
    seek_enable: "\u30b3\u30e1\u30f3\u30c8: \u30b7\u30fc\u30af\u8a31\u53ef",
    jump: "\u30b3\u30e1\u30f3\u30c8\u30b8\u30e3\u30f3\u30d7: ",
    network_skip_local: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30ea\u30bd\u30fc\u30b9\u306e\u305f\u3081\u30ed\u30fc\u30ab\u30eb\u30b3\u30e1\u30f3\u30c8\u3092\u30b9\u30ad\u30c3\u30d7",
    ddp_no_match: "\u5f3e\u5f3ePlay: \u4e00\u81f4\u3059\u308b\u7d50\u679c\u304c\u3042\u308a\u307e\u305b\u3093",
    ddp_network_error: "\u5f3e\u5f3ePlay: \u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30a8\u30e9\u30fc",
    ddp_api_error: "\u5f3e\u5f3ePlay: API\u5fdc\u7b54\u30a8\u30e9\u30fc",
    ddp_no_comments: "\u5f3e\u5f3ePlay: \u3053\u306e\u52d5\u753b\u306b\u30b3\u30e1\u30f3\u30c8\u304c\u3042\u308a\u307e\u305b\u3093",
    ddp_load_failed: "\u5f3e\u5f3ePlay: \u30b3\u30e1\u30f3\u30c8\u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f",
    cache_stale: " (\u65e7)",
    duration_mismatch: "\u52d5\u753b\u306e\u9577\u3055\u304c\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3068\u4e00\u81f4\u3057\u307e\u305b\u3093: \u30aa\u30d5\u30bb\u30c3\u30c8\u3092 {offset}s \u306b\u81ea\u52d5\u8abf\u6574",
    duration_mismatch_no_offset: "\u52d5\u753b\u306e\u9577\u3055\u304c\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3068\u4e00\u81f4\u3057\u307e\u305b\u3093"
  },
  zh: {
    render_failed: "\u65e0\u6cd5\u6e32\u67d3\u6b64\u5f39\u5e55\u6587\u4ef6",
    ddp_auth_error: "\u5f39\u5f39play: \u8eab\u4efd\u9a8c\u8bc1\u5931\u8d25 (403)",
    ddp_no_results: "\u672a\u627e\u5230\u641c\u7d22\u7ed3\u679c",
    menu_toggle: "\u5207\u6362\u5f39\u5e55\u663e\u793a",
    menu_load_file: "\u624b\u52a8\u52a0\u8f7d\u5f39\u5e55\u6587\u4ef6\u2026",
    menu_show_overlay: "\u663e\u793a\u5f39\u5e55\u8986\u76d6\u5c42",
    menu_hide_overlay: "\u9690\u85cf\u5f39\u5e55\u8986\u76d6\u5c42",
    choose_file_title: "\u9009\u62e9\u5f39\u5e55\u6587\u4ef6",
    danmaku_on: "\u5f39\u5e55\u5df2\u5f00\u542f",
    danmaku_off: "\u5f39\u5e55\u5df2\u5173\u95ed",
    loaded: "\u5df2\u52a0\u8f7d\u5f39\u5e55: ",
    network_loaded: "\u5df2\u52a0\u8f7d\u7f51\u7edc\u5f39\u5e55: ",
    queued: "\u5f39\u5e55\u6392\u961f\u4e2d\u2026",
    read_failed: "\u65e0\u6cd5\u8bfb\u53d6\u5f39\u5e55\u6587\u4ef6",
    read_failed_name: "\u65e0\u6cd5\u8bfb\u53d6\u5f39\u5e55\u6587\u4ef6: ",
    content_unavailable: "\u5f39\u5e55\u5185\u5bb9\u4e0d\u53ef\u7528",
    seek_disable: "\u5f39\u5e55\uff1a\u7981\u6b62\u8df3\u8f6c",
    seek_enable: "\u5f39\u5e55\uff1a\u5141\u8bb8\u8df3\u8f6c",
    jump: "\u5f39\u5e55\u8df3\u8f6c: ",
    network_skip_local: "\u7f51\u7edc\u8d44\u6e90\uff0c\u8df3\u8fc7\u672c\u5730\u5f39\u5e55\u52a0\u8f7d",
    ddp_no_match: "\u5f39\u5f39play: \u672a\u627e\u5230\u5339\u914d",
    ddp_network_error: "\u5f39\u5f39play: \u7f51\u7edc\u9519\u8bef",
    ddp_api_error: "\u5f39\u5f39play: API\u54cd\u5e94\u9519\u8bef",
    ddp_no_comments: "\u5f39\u5f39play: \u8be5\u89c6\u9891\u65e0\u5f39\u5e55",
    ddp_load_failed: "\u5f39\u5f39play: \u52a0\u8f7d\u5f39\u5e55\u5931\u8d25",
    cache_stale: " (\u65e7)",
    duration_mismatch: "\u89c6\u9891\u65f6\u957f\u4e0e\u5f39\u5e55\u6587\u4ef6\u4e0d\u4e00\u81f4: \u5df2\u81ea\u52a8\u8bbe\u7f6e\u504f\u79fb {offset} \u79d2",
    duration_mismatch_no_offset: "\u89c6\u9891\u65f6\u957f\u4e0e\u5f39\u5e55\u6587\u4ef6\u4e0d\u4e00\u81f4"
  }
};

function getPluginLang(utils) {
  try {
    let locs = utils && utils.preferredLocalizations();
    if (locs && locs.length) {
      let l = String(locs[0]).toLowerCase();
      if (l.indexOf('ja') === 0) return 'ja';
      if (l.indexOf('zh') === 0) return 'zh';
      return 'en';
    }
  } catch (e) {}
  // Fallback for IINA versions without preferredLocalizations().
  return 'zh';
}

function createTranslator(lang) {
  return function translate(key, vars) {
    let s = (PLUGIN_I18N[lang] && PLUGIN_I18N[lang][key]) || PLUGIN_I18N.en[key] || key;
    if (vars) {
      for (let k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.replace('{' + k + '}', String(vars[k]));
      }
    }
    return s;
  };
}

module.exports = {
  getPluginLang: getPluginLang,
  createTranslator: createTranslator
};
