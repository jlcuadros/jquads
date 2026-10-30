import UIKit
import Capacitor
import WebKit
import ObjectiveC

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // jquads: before the web view exists, make every file the app serves cross-origin isolated.
        CrossOriginIsolation.install()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// MARK: - jquads: cross-origin isolation (store release, 2026-10-30)

/**
 * Stockfish runs with several threads, which needs SharedArrayBuffer, which browsers only give to
 * "cross-origin isolated" pages: served with the headers
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 * On the web Cloudflare adds them (public/_headers). In this app the files are served by Capacitor's
 * WebViewAssetHandler (scheme capacitor://), which doesn't add them and can't be replaced (the bridge
 * creates it in a final method) nor patched (Capacitor 8 comes precompiled through Swift Package Manager).
 * So, at launch, its `webView(_:start:)` is wrapped: the scheme task it receives is a proxy that adds
 * both headers to every HTTP response before passing it on to WebKit.
 */
enum CrossOriginIsolation {
    static let headers = [
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
    ]

    static func install() {
        let selector = #selector(WKURLSchemeHandler.webView(_:start:))
        guard let handlerClass = NSClassFromString("CAPWebViewAssetHandler"),
              let method = class_getInstanceMethod(handlerClass, selector) else {
            assertionFailure("Capacitor's asset handler not found: the page won't be cross-origin isolated")
            return
        }
        typealias Start = @convention(c) (AnyObject, Selector, WKWebView, WKURLSchemeTask) -> Void
        let original = unsafeBitCast(method_getImplementation(method), to: Start.self)
        let wrapped: @convention(block) (AnyObject, WKWebView, WKURLSchemeTask) -> Void = { handler, webView, task in
            original(handler, selector, webView, IsolatingSchemeTask(task))
        }
        method_setImplementation(method, imp_implementationWithBlock(wrapped))
    }
}

/// A scheme task that forwards everything to WebKit's, adding the isolation headers to HTTP responses.
final class IsolatingSchemeTask: NSObject, WKURLSchemeTask {
    private let inner: WKURLSchemeTask

    init(_ inner: WKURLSchemeTask) {
        self.inner = inner
    }

    var request: URLRequest { inner.request }

    func didReceive(_ response: URLResponse) {
        guard let http = response as? HTTPURLResponse, let url = http.url else {
            inner.didReceive(response) // not HTTP (Capacitor's media responses): unchanged
            return
        }
        var fields = (http.allHeaderFields as? [String: String]) ?? [:]
        fields.merge(CrossOriginIsolation.headers) { _, new in new }
        inner.didReceive(HTTPURLResponse(url: url, statusCode: http.statusCode, httpVersion: nil, headerFields: fields) ?? http)
    }

    func didReceive(_ data: Data) { inner.didReceive(data) }
    func didFinish() { inner.didFinish() }
    func didFailWithError(_ error: Error) { inner.didFailWithError(error) }
}
