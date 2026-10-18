# NOTICE

**hermes-pwa** is an independent, unofficial project. It is not affiliated with,
endorsed by, or sponsored by Nous Research. "Hermes" and product names are used
only to describe interoperability with the self-hosted Hermes Agent's public
HTTP/WebSocket API.

## Vendored code

- `dashboard/voice_live.py` and `dashboard/talk_vendor/` are vendored from the
  **hermes-live-voice** plugin (`talk-desktop`, MIT License) of the same author,
  which itself reuses the `talk_*` modules of the **hermes-talk** plugin (MIT).
  Attribution headers in each file are preserved. The `state.db` session/message
  schema used by `dashboard/voice_history.py` was reconstructed from Hermes
  Agent's public developer documentation, not from proprietary source.
