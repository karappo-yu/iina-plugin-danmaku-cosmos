# Native WebKit animation regression

Issue [#47](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos/issues/47) exposes WebKit [bug 318856](https://bugs.webkit.org/show_bug.cgi?id=318856): canceled CSSAnimation wrappers can retain their timeline, effect and target DOM after renderer disposal.

The macOS test loads the actual bundled engine and overlay in an independent WKWebView. It observes only animation wrappers that the engine's normal lifetime check already exposes, plays three batches of 200 scrolling comments, clears each renderer, and forces GC. A normal object WeakRef verifies that GC ran. The original bundle on the affected system leaves 200, 400 and 600 old animations alive; the fixed bundle must leave zero each time.

Run from the plugin checkout with the system Swift compiler:

```sh
swiftc test/native/animation-retention.swift -o /tmp/danmaku-animation-test
/tmp/danmaku-animation-test "$PWD"
```

The small test window must remain visible so WebKit can execute rAF. Exit 0 means all three batches passed, 1 means an assertion failed, and 77 means the system lacks the testing GC selector. The private selector is confined to this diagnostic application; it is not used by the shipped plugin and does not collect another application's WebContent process.
