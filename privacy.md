# Privacy Policy — AMA

**Last updated:** March 25, 2026

## Overview

AMA ("the Extension") is a browser extension that lets you talk to any website. This privacy policy explains what data the Extension accesses, how it is used, and your rights regarding that data.

## Data Collection

**AMA does not collect, store, transmit, or sell any personal data.**

The Extension does not have any servers, analytics, tracking, or telemetry. There is no account system and no sign-up required.

## Data Access

To function, the Extension accesses the content of the web page you are currently viewing in your active tab. This is necessary to provide answers about the site's content. This data is:

- Processed locally in your browser or sent directly to the AI provider you configure in the Extension's settings
- Never stored, logged, or retained by the Extension after the session ends
- Never shared with any third party other than the AI provider you explicitly configure

## Third-Party AI Providers

The Extension allows you to connect your own API key to a third-party AI provider (e.g., Anthropic, OpenAI). When you submit a question, the relevant page content is sent to the provider you configured. The handling of that data is governed by the respective provider's privacy policy:

- Anthropic: https://www.anthropic.com/privacy
- OpenAI: https://openai.com/privacy

**The Extension does not provide or manage these API keys on your behalf.** You supply your own key, and you can revoke it at any time.

## Local Storage

The Extension uses your browser's local storage (`chrome.storage`) solely to save your preferences and API key configuration. This data never leaves your browser.

## Permissions

- **activeTab / host_permissions:** Used to read the content of the page you are viewing when you interact with the Extension.
- **storage:** Used to save your settings and API key locally.
- **scripting:** Used to extract page content for analysis.
- **sidePanel:** Used to display the Extension's interface.

## Children's Privacy

The Extension is not directed at children under 13 and does not knowingly collect data from children.

## Changes

If this policy changes, the updated version will be posted at this URL with a revised date.

## Contact

If you have questions about this privacy policy, please open an issue at the project's GitHub repository.
