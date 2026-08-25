# Marketing tab — how it works

## For him

`/admin/` → **Marketing** → Poster Creation.

Four questions: what the poster is for, where to get the numbers (a link),
what it should look like, and anything else. Then **Send to ChatGPT** — the
prompt arrives in the composer, he attaches the logo, and hits the arrow.

**Copy the prompt** is the fallback and always works. **See the prompt this
makes** shows exactly what is about to be sent, before it is sent.

Nothing on this card publishes anything to anybody. Every other section in
the admin panel reaches customers the moment you press the button; this one
writes text and puts it on the clipboard.

## For you

The prompt is **not** in the JavaScript. It is a row in `marketing_prompts`,
edited at:

    /admin/?prompts=1

That URL shows an editor under the poster form with three boxes — the
template, the look choices as JSON, and the list of files to attach. Save,
and the next poster he makes uses the new wording. No commit, no deploy.

He never sees that editor without the query string.

### Placeholders

| In the template | Comes from |
|---|---|
| `{{title}}`   | What is the poster for? |
| `{{source}}`  | Where should it get the information? |
| `{{palette}}` | The `instruction` on the chosen look |
| `{{notes}}`   | Anything else? |

A placeholder he left blank takes its whole line out, rather than leaving
`Title:` with nothing after it — a prompt with blanks in it reads as a
question, and ChatGPT will happily invent an answer.

A placeholder the template asks for that the form does not have is left
exactly as written, so a typo like `{{titel}}` shows up in the preview
instead of silently deleting the title.

### Look choices

```json
[{ "id": "gold", "label": "Gold", "instruction": "Deep black background with..." }]
```

`label` is what he picks from the dropdown. `instruction` is the sentence
that lands in the prompt — so "Gold" never reaches ChatGPT, the description
of gold does. Every entry needs an `id` and a `label` or the save is
refused, because a broken dropdown is his problem, not yours.

## The send link

`chatgpt.com/?q=…` prefills the composer. It is undocumented, it has a URL
length ceiling, and OpenAI can remove it at any time — so the clipboard is
loaded **first, every time**. If the deep link ever stops prefilling, he
lands in ChatGPT with the prompt already copied and a line telling him to
paste, rather than a broken button.

Over about 1800 encoded characters it does not try, opens a plain tab, and
says the prompt is on the clipboard.

## Adding a second section

`marketing_prompts` is keyed by slug. A Facebook-post section is a new row
plus a bit of UI — never a schema change.

## Setup

Run `supabase/marketing.sql` on the project once. Safe to re-run; it will
never overwrite a prompt you have edited.
