# Privacy

Effective: September 6, 2026

YouTube Digest AI is a GitHub-only, bring-your-own-key Chrome extension. It has no account, developer-operated backend, analytics, advertising, or telemetry.

It is a derivative of [YouTube Digest](https://github.com/zarazhangrui/youtube-digest) by Zara Zhang, used under the MIT License. The original project is not affiliated with this fork and does not support it.

## Data the extension handles

Depending on the feature you use, YouTube Digest AI handles:

- the canonical URL and video ID of the active YouTube video;
- transcript text and timestamps;
- video metadata such as title, channel, description, and duration;
- text you select in the transcript and nearby transcript context;
- transcript context around a timestamped note;
- content you ask to translate;
- notes you save;
- Supadata and AI provider configuration, including API keys; and
- cached transcript, digest, and translation results.

## Where data goes

### Supadata

YouTube Digest AI sends the canonical YouTube video URL to `https://api.supadata.ai` with your Supadata API key. Supadata returns the transcript and timestamps. A Supadata key is required for transcript retrieval.

### The AI provider you select

AI features send content to the provider you choose in Settings. You select one provider at a time and supply that provider's API key. Keys are stored separately per provider, so switching providers does not send a key intended for one service to another.

Supported providers and their endpoints:

| Provider | Endpoint |
| --- | --- |
| DeepSeek (default) | `https://api.deepseek.com` |
| OpenAI | `https://api.openai.com` |
| Zhipu GLM | `https://open.bigmodel.cn` |
| Anthropic Claude | `https://api.anthropic.com` |
| Google Gemini | `https://generativelanguage.googleapis.com` |
| Custom | an OpenAI-compatible endpoint you enter yourself |

The following content is sent to the selected provider:

- transcript plus relevant title, channel, description, or duration for an overview;
- selected text plus nearby transcript context for an explanation;
- small semantic transcript batches for progressive translation, or requested overview or explanation content;
- nearby transcript context and video metadata when polishing a saved note.

If you select **Custom**, content is sent to whatever address you enter. Chrome asks for your permission before that address is contacted for the first time, and you can decline. Only `https` addresses are accepted, so keys and content are not sent in plain text. Verify that you trust an endpoint before entering it: this extension cannot tell whether an address you supply is operated by a service you intend to use.

Requests go directly from the extension to Supadata or the selected AI provider. They are authenticated with the keys you supply. This extension's developer does not proxy or receive these requests.

Those services process data under their own terms, privacy policies, retention practices, and account settings. Do not send confidential, personal, or regulated content unless their terms and your obligations permit it.

## Local storage and retention

YouTube Digest AI uses Chrome's local extension storage, not a cloud service.

- Supadata and AI provider settings and API keys remain on the device in Chrome's extension storage. A separate key is stored for each provider you configure.
- Saved notes remain until you delete them or remove/clear the extension's data. The extension keeps up to 100 notes.
- Recent transcript, digest, and per-segment translation cache entries are stored locally. The cache is limited to 20 videos, and entries older than 30 days are removed when the side panel opens.

Chrome extension storage is not a password vault. Anyone with sufficient access to your browser profile or device may be able to recover locally stored keys or content. Use scoped keys where providers support them, set spending limits, and rotate or revoke a key if the device or browser profile is compromised.

To remove data:

- delete individual saved notes in YouTube Digest AI;
- use the Options page to clear cached digests, delete all notes, or reset all extension data;
- remove the extension or clear its stored data from Chrome to delete all local settings, keys, notes, and cache entries; and
- revoke keys in the Supadata or AI provider dashboard to stop their future use.

Clearing local data does not delete information already processed or retained by Supadata or the AI provider. Use each service's controls for service-side requests.

## Permissions

YouTube Digest AI uses Chrome permissions for these purposes:

- `sidePanel`: display the interface beside YouTube.
- `storage`: store settings, keys, notes, and cached results locally.
- `tabs`: identify and interact with the active YouTube tab.
- `scripting`: coordinate the extension's YouTube page controls.
- YouTube host access: read the active video's URL and metadata and provide timestamp controls.
- Supadata host access: retrieve transcripts.
- AI provider host access: the endpoints listed above, so the provider you select can be reached. Access is declared for every listed provider at install time, but only the one you select is contacted.

`optional_host_permissions` covers the **Custom** provider only. The address is not known in advance, so it cannot be declared at install time. Nothing is granted when you install the extension: Chrome prompts you for that specific address when you save a custom endpoint, and the request fails to save if you decline.

YouTube Digest AI does not use these permissions to monitor general browsing activity.

## No sale or advertising use

YouTube Digest AI does not sell personal information, build advertising profiles, or share data with data brokers. It does not include analytics SDKs.

## Changes

Privacy-relevant changes will be documented in this file and in the repository history. Review updates before installing a new version.

## Questions

This repository does not provide a public support or issue channel. Review this policy, the source code, and each provider's documentation before using the extension. For a vulnerability or accidental secret exposure, follow the private process in [SECURITY.md](SECURITY.md).
