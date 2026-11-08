# Models

Each workspace chooses its models in `.mycelium/models.json`:

```json
{
  "main": { "kind": "eliza", "model": "anthropic/claude-sonnet-4.6" },
  "aux":  { "kind": "eliza", "model": "anthropic/claude-haiku-4.5" }
}
```

- `main` serves the agent's requests; `aux` serves the update-cycle, repair planner and knowledge migration.
  Without `aux`, it uses `main`; without the file, both use Cline's provider.
- `{ "kind": "cline" }` is the provider configured in Cline's own settings (for example the Claude Code
  provider with a Claude subscription, or the OpenAI Codex provider with a ChatGPT subscription). It follows
  later changes to those settings.
- `{ "kind": "eliza", "model": "…" }` is an OpenAI-compatible gateway (`POST <base>/chat/completions`, sent
  through Cline's OpenAI-compatible handler). Model ids are whatever the gateway accepts.

Use the same `models.json` in both experiment workspaces so the `tao` and `improved` runs use identical models.

## Gateway settings

The gateway's address is private, so it is not in this repository. Copy [`mycelium.env.example`](../mycelium.env.example)
to `~/.mycelium/.env` and fill in:

| Key | Meaning | Default |
|---|---|---|
| `ELIZA_BASE_URL` | base URL of the OpenAI-compatible API | none (required) |
| `ELIZA_AUTH_HEADER` | header that carries the token | `Authorization` |
| `ELIZA_AUTH_SCHEME` | word before the token in that header | `Bearer` |

Environment variables with the same names override the file. **Mycelium: Configure Eliza…** asks for the
base URL (saved to `~/.mycelium/.env`, readable by you only) and your token (saved to VS Code SecretStorage,
never to a file). Without `ELIZA_BASE_URL` or a token, a task keeps Cline's provider and says why.
