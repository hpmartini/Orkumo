import XCTest

/// End-to-end check for the iOS app (Issue #120) against a running DevOrbit server.
/// Inputs come from the environment (xcodebuild: TEST_RUNNER_<NAME>=…):
/// PAIR_LINK (devorbit://pair?…), TERMINAL_PATH (app route with a shell terminal),
/// MARKER (file the typed shell command creates), ATTACH_ID + ATTACH_PROMPT (agent session to attach and what to send, optional),
/// SCREENSHOT_DIR (where PNGs go).
@available(iOS 16.4, *)
final class PairingFlowTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipIf(env["PAIR_LINK"] == nil, "PAIR_LINK not set")
    }

    func testPairAgentsBoardTerminal() throws {
        app.launch()
        // A leftover system "Open in …?" alert would block every tap.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Cancel", "Abbrechen"] where springboard.buttons[label].exists {
            springboard.buttons[label].tap()
        }
        XCTAssertTrue(app.staticTexts["Mit DevOrbit verbinden"].waitForExistence(timeout: 15))
        shot("01-pairing")

        open(env["PAIR_LINK"]!)
        // The app asks before it pairs with the host named in the link.
        let confirm = app.alerts.firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        shot("01b-confirm")
        confirm.buttons["Ok"].tap()
        XCTAssertTrue(app.webViews.firstMatch.staticTexts["Agents"].waitForExistence(timeout: 20))
        sleep(4)
        shot("02-agents")

        open("devorbit://open?path=/board")
        sleep(6)
        shot("03-board")

        if let path = env["TERMINAL_PATH"], let marker = env["MARKER"] {
            open("devorbit://open?path=\(path)")
            sleep(8)
            // The details view opens on the app log; a new tab runs the default shell.
            let newTab = app.webViews.firstMatch.buttons["New terminal"]
            XCTAssertTrue(newTab.waitForExistence(timeout: 30))
            app.swipeUp()
            newTab.tap()
            sleep(5)
            // Tapping the terminal area focuses xterm's hidden input.
            newTab.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: 60, dy: 150)).tap()
            sleep(1)
            shot("04a-terminal-open")
            app.typeText("touch \(marker) && echo IOS-E2E-OK")
            pressReturn()
            // zsh may still be loading its rc files; give it time before the test ends and the PTY goes away.
            sleep(10)
            shot("04-terminal")
        }

        if let agent = env["ATTACH_ID"], !agent.isEmpty {
            // Attach to a running agent session and send it a prompt through the attached terminal.
            open("devorbit://open?path=%2Fagents%3Fattach%3D\(agent)")
            sleep(10)
            shot("05a-attach-open")
            app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)).tap()
            sleep(1)
            app.typeText(env["ATTACH_PROMPT"] ?? "Antworte nur mit OK")
            pressReturn()
            sleep(25)
            shot("05-attach")
        }
    }

    /// The on-screen Return key, as a person would press it (label depends on the simulator locale).
    private func pressReturn() {
        let keys = app.keyboards.firstMatch
        print("KEYBOARD-BUTTONS: \(keys.buttons.allElementsBoundByIndex.map(\.label))")
        for label in ["Return", "return", "Eingabe", "eingabe", "Zeilenumbruch"] where keys.buttons[label].exists {
            keys.buttons[label].tap()
            return
        }
        app.typeText("\r")
    }

    private func open(_ link: String) {
        app.open(URL(string: link)!)
        // simctl-style "Open in DevOrbit?" confirmation, if iOS asks
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Open", "Öffnen"] where springboard.buttons[label].waitForExistence(timeout: 2) {
            springboard.buttons[label].tap()
        }
    }

    private func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["SCREENSHOT_DIR"] {
            try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}
