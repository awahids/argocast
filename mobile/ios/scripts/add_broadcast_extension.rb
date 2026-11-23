#!/usr/bin/env ruby
# Adds the "ArgocastBroadcast" Broadcast Upload Extension target to
# ios/Runner.xcodeproj and embeds it in the Runner app. Idempotent.
#
#   cd mobile/ios && ruby scripts/add_broadcast_extension.rb
#
# Needs the `xcodeproj` gem (ships with CocoaPods): gem install xcodeproj
require 'xcodeproj'

ROOT = File.expand_path('..', __dir__)
project_path = File.join(ROOT, 'Runner.xcodeproj')
project = Xcodeproj::Project.open(project_path)

NAME = 'ArgocastBroadcast'
runner = project.targets.find { |t| t.name == 'Runner' } or abort 'Runner target not found'

if project.targets.any? { |t| t.name == NAME }
  puts "#{NAME} target already present - nothing to do"
  exit 0
end

deployment = runner.build_configurations.first.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] || '15.0'
ext = project.new_target(:app_extension, NAME, :ios, deployment, nil, :swift)

# --- source files -----------------------------------------------------------
group = project.main_group.find_subpath(NAME, true)
group.set_source_tree('<group>')
group.set_path(NAME)
proto = group.find_subpath('Protocol', true)
proto.set_source_tree('<group>')
proto.set_path('Protocol')

ext_files = %w[SampleHandler.swift H264Encoder.swift].map { |f| group.new_reference(f) }
proto_files = Dir.children(File.join(ROOT, NAME, 'Protocol')).select { |f| f.end_with?('.swift') }.sort.map { |f| proto.new_reference(f) }
group.new_reference('Info.plist')
ext.add_file_references(ext_files + proto_files)

# The app reads/writes the shared config too.
shared = proto_files.find { |f| f.path == 'SharedConfig.swift' }
runner.add_file_references([shared])

# ArgocastNative.swift lives in the Runner group.
runner_group = project.main_group.find_subpath('Runner', false)
unless runner_group.files.any? { |f| f.path == 'ArgocastNative.swift' }
  runner.add_file_references([runner_group.new_reference('ArgocastNative.swift')])
end

# --- build settings -----------------------------------------------------------
app_id = runner.build_configurations.first.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] || 'app.argocast.argocast'
ext.build_configurations.each do |c|
  runner_cfg = runner.build_configurations.find { |r| r.name == c.name } || runner.build_configurations.first
  # Reuse Flutter's xcconfig so FLUTTER_BUILD_NAME/NUMBER match the app version.
  c.base_configuration_reference = runner_cfg.base_configuration_reference
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{app_id}.Broadcast"
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = "#{NAME}/Info.plist"
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = deployment
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['ENABLE_BITCODE'] = 'NO'
  # Keep the team the developer picks for Runner (set in Xcode) in sync.
  s['DEVELOPMENT_TEAM'] = runner_cfg.build_settings['DEVELOPMENT_TEAM'] if runner_cfg.build_settings['DEVELOPMENT_TEAM']
end

%w[ReplayKit VideoToolbox Network].each do |fw|
  ref = project.frameworks_group.new_file("System/Library/Frameworks/#{fw}.framework", :sdk_root)
  ext.frameworks_build_phase.add_file_reference(ref, true)
end

# --- embed in Runner ------------------------------------------------------------
runner.add_dependency(ext)
embed = runner.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } ||
        runner.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
build_file = embed.add_file_reference(ext.product_reference, true)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

# Flutter's "Thin Binary" script must run after embedding, or Xcode reports a
# dependency cycle. Move the embed phase right after Resources.
phases = runner.build_phases
phases.delete(embed)
resources_index = phases.index { |p| p.is_a?(Xcodeproj::Project::Object::PBXResourcesBuildPhase) } || phases.size - 1
phases.insert(resources_index + 1, embed)

project.save
puts "Added #{NAME} (#{app_id}.Broadcast) and embedded it in Runner"
