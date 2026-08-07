//
//  The ObjC bridge. Capacitor discovers plugins through the ObjC runtime, so a
//  Swift class nobody registers here compiles, ships, and is simply absent when
//  JavaScript asks for it — the same failure that cost a build with Sign in with
//  Apple and again with the ads plugin.
//
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LumenStore, "LumenStore",
           CAP_PLUGIN_METHOD(products, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(purchase, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(restore, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(requestReview, CAPPluginReturnPromise);
)
