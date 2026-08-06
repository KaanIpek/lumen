require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'LumenAds'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/KaanIpek/lumen'
  s.author = 'RLD Games'
  s.source = { :git => 'https://github.com/KaanIpek/lumen.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  # 11.x on purpose: 12 renamed GADRewardedAd to RewardedAd and the rest of the
  # GAD-prefixed API with it. Declaring it HERE is the difference that matters —
  # a top-level Podfile pin was ignored, because the plugin that owns the
  # dependency is the one that resolves it. That cost two builds.
  s.dependency 'Google-Mobile-Ads-SDK', '~> 11.0'
  s.swift_version = '5.1'
end
