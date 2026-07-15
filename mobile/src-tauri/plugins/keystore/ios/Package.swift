// swift-tools-version:5.3

import PackageDescription

let package = Package(
    name: "tauri-plugin-keystore",
    platforms: [
        .macOS(.v10_13),
        .iOS(.v13),
    ],
    products: [
        .library(
            name: "tauri-plugin-keystore",
            type: .static,
            targets: ["tauri-plugin-keystore"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-keystore",
            dependencies: [.byName(name: "Tauri")],
            path: "Sources"),
    ]
)
