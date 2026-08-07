require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'LumenStore'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/KaanIpek/lumen'
  s.author = 'RLD Games'
  s.source = { :git => 'https://github.com/KaanIpek/lumen.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  # Same floor as the ads plugin and for the same reason: this must be <= the
  # Podfile platform Capacitor generates, or CocoaPods refuses the pod. StoreKit 2
  # needs iOS 15, which is enforced with @available inside the source instead —
  # the app's own deployment target is already 15.
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
