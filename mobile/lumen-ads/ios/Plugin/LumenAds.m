//
//  The Objective-C bridge Capacitor needs to see a Swift plugin at runtime.
//
//  Without this file the class compiles, ships, and is simply not there when
//  JavaScript asks for it — Capacitor discovers plugins through the ObjC
//  runtime, and a Swift class nobody registered is invisible. That failure looks
//  exactly like a missing plugin, which is the same symptom that cost a build
//  earlier today with Sign in with Apple.
//
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LumenAds, "LumenAds",
           CAP_PLUGIN_METHOD(initialize, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(requestTracking, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(prepare, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(show, CAPPluginReturnPromise);
)
