// Manual macOS regression: swiftc test/native/animation-retention.swift -o /tmp/danmaku-animation-test
// /tmp/danmaku-animation-test "$PWD"
// The private GC selector is used only by this isolated test application.
import Cocoa
import WebKit

@MainActor final class AnimationRetentionTest: NSObject, WKNavigationDelegate {
  let root: URL
  var web: WKWebView!
  var window: NSWindow!
  var rows: [[String: Any]] = []

  init(root: URL) { self.root = root }

  func start() {
    let config = WKWebViewConfiguration()
    web = WKWebView(frame: CGRect(x: 0, y: 0, width: 640, height: 360), configuration: config)
    web.navigationDelegate = self
    window = NSWindow(contentRect: CGRect(x: 70, y: 70, width: 640, height: 360),
      styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "Danmaku animation retention regression"
    window.contentView = web
    window.orderFrontRegardless()
    let engine = root.appendingPathComponent("overlay/lib/niconicomments.min.js").absoluteString
    let overlay = root.appendingPathComponent("overlay/main.js").absoluteString
    let css = root.appendingPathComponent("overlay/index.css").absoluteString
    let html = """
      <meta charset="utf-8"><link rel="stylesheet" href="\(css)">
      <div id="danmaku-viewport"><canvas id="niconicomments-canvas"></canvas></div>
      <script>window.iina={listeners:{},onMessage(n,f){this.listeners[n]=f},postMessage(){},
        emit(n,d){this.listeners[n](d)}};</script>
      <script src="\(engine)"></script><script src="\(overlay)"></script>
      <script>
      window.animationRefs=[];window.seenAnimations=new WeakSet();
      const originalGetAnimations=Element.prototype.getAnimations;
      Element.prototype.getAnimations=function(...args){
        const animations=originalGetAnimations.apply(this,args);
        if(this.hasAttribute('data-dm-comment'))for(const animation of animations){
          if(!seenAnimations.has(animation)){seenAnimations.add(animation);animationRefs.push(new WeakRef(animation))}
        }
        return animations;
      };
      window.loadBatch=id=>{
        const comments=Array.from({length:200},(_,index)=>({id:index,no:index,vpos:0,
          content:'comment '+index,date:1700000000,date_usec:0,owner:false,premium:false,
          mail:['naka'],user_id:index+1,layer:-1,is_my_post:false}));
        iina.emit('load-danmaku',{loadId:id,comments,canvasMode:'css',
          playback:{enabled:true,time:0,paused:false,speed:1}});
      };
      window.gcState=()=>JSON.stringify({observed:animationRefs.length,
        alive:animationRefs.filter(ref=>ref.deref()).length,
        ordinaryAlive:!!ordinaryRef.deref(),nodes:document.querySelectorAll('[data-dm-comment]').length,
        rendererPresent:niconiComments!==null});
      </script>
      """
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("danmaku-animation-\(getpid()).html")
    try! html.write(to: file, atomically: true, encoding: .utf8)
    web.loadFileURL(file, allowingReadAccessTo: URL(fileURLWithPath: "/"))
  }

  func evaluate(_ source: String) async -> Any? {
    await withCheckedContinuation { continuation in
      web.evaluateJavaScript(source) { value, error in
        if let error = error { print("JavaScript error:", error) }
        continuation.resume(returning: value)
      }
    }
  }

  func wait(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1e9)) }

  func collect() async {
    web.configuration.processPool.perform(NSSelectorFromString("_garbageCollectJavaScriptObjectsForTesting"))
    await wait(0.3)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    Task {
      guard web.configuration.processPool.responds(to: NSSelectorFromString("_garbageCollectJavaScriptObjectsForTesting")) else {
        print("SKIP: this WebKit does not expose the test GC selector")
        exit(77)
      }
      var passed = true
      for cycle in 0..<3 {
        _ = await evaluate("loadBatch(\(cycle * 2 + 1))")
        await wait(5)
        _ = await evaluate("iina.emit('clear-danmaku',{clearId:\(cycle * 2 + 2)});window.ordinaryRef=new WeakRef({sentinel:1});void 0")
        await collect(); await collect()
        guard let text = await evaluate("gcState()") as? String,
          let data = text.data(using: .utf8),
          let row = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          print("FAIL: no usable GC result"); exit(1)
        }
        rows.append(row)
        print("Cycle \(cycle + 1):", text); fflush(stdout)
        passed = passed && row["observed"] as? Int == (cycle + 1) * 200 &&
          row["alive"] as? Int == 0 && row["ordinaryAlive"] as? Bool == false &&
          row["nodes"] as? Int == 0 && row["rendererPresent"] as? Bool == false
      }
      print(passed ? "PASS: exposed animation wrappers were collected" : "FAIL: animation wrappers survived cleanup")
      exit(passed ? 0 : 1)
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let rootPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath
MainActor.assumeIsolated {
  let test = AnimationRetentionTest(root: URL(fileURLWithPath: rootPath))
  test.start()
  app.run()
}
