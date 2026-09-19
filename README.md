# General Construction Co. · Talent acquisition &amp; retention

A five-slide, semi-interactive client proposal. Several people can be on it at once from
anywhere, each browsing on their own. Runs entirely on your machine — no hosting, no
accounts, no build step.

## Run it

```bash
npm install
npm start
```

```
Big screen   http://localhost:4400
```

Change the port with `PORT=5000 npm start`.

## The slides

| | | |
|---|---|---|
| **01** | Overview | The flowchart: hiring and onboarding feed the three goals — training, a KPI system, retention — which hold up revenue growth. Click any step to light it. |
| **02** | Process | Three phases. The process lines fill themselves from whatever you add under each phase in the admin panel. |
| **03** | Capabilities | Empty, waiting for content. |
| **04** | Q&A | Capture what the room raises on the big screen, then answer it live. |
| **05** | About Us | Empty, waiting for content. |

Slides have addresses — `#/overview`, `#/process`, `#/capabilities` — so a link can be sent
to one place in the deck. Arrow keys step through; number keys 1–5 jump.

## Filling it in

Everything on the process slide, and every figure in the budget, comes from the admin
panel at `/admin`. The proposal ships empty: no phases titled, no lines, all rates zero.

```
/           the deck                                              open
/budget     the public board — propose yourself for a line        open
/team       proposals and comments together                       password
/admin      rates, lines, assignment, and the public switches     password
```

`/team` and `/admin` write to the shared board, so they ask for `ADMIN_PASSWORD` and
keep a cookie for twelve hours. The cookie holds a digest, never the password.

Unset behaves differently by where it runs. On a managed host, no password means those
two routes answer **404** — unavailable rather than open, so forgetting the variable
hides the panel instead of publishing it. Locally, unset leaves them open on your own
machine.

## Deploying

The app needs three things in the host's environment:

| Variable | Why |
|---|---|
| `ADMIN_PASSWORD` | Gates `/admin` and `/team`. Without it they 404 in production. |
| `GIST_ID` + `GITHUB_TOKEN` | Durable state. A serverless host never writes the local file, so without a gist every admin and team edit is lost when the function freezes. |
| `GEMINI_API_KEY` *(or OpenAI / Anthropic)* | Live answers on the Q&A slide and "Ask this document". Optional — both fall back gracefully. |

Create the gist once with `gh gist create budget-state.json --desc "budget state"` and
take the id from the URL.

## Live features

Two things call a model. Both work without one — they just aren't live.

| Feature | With a key | Without |
|---|---|---|
| **Ask this document** (nav bar) | Answers your question from the deck's own text | Shows the matching passages, click to jump |
| **Slide 4 answers** | Written with web search, so anything cited is real and current | The offline library in `lib/library.js` — empty for now, so it says so rather than inventing an answer |

**Nothing ever shows an error in front of a client** — if a call fails mid-talk, it falls
back silently and a footnote says which source produced what you're looking at.

```bash
cp .env.example .env      # then paste your key into .env
npm run models            # optional: see which model ids your key can use
npm start
```

Works with **Gemini**, **OpenAI** or **Anthropic** — set whichever key you have and the
provider layer in `lib/llm.js` picks it up. First one found wins, in that order. Web search
is on for slide 4 in all three. The startup banner tells you which provider is live, so you
can confirm before a session.

## Where it can run

| | Deck | Live model calls |
|---|---|---|
| **Local** (`npm start`) | ✅ | ✅ |
| **Deployed** (Vercel, Fly, Render, Docker) | ✅ | ✅ |
| **Static** (`npm run build` → `docs/index.html`) | ✅ | ❌ offline fallbacks |

The static copy carries `noindex`: the link works for anyone who has it, search engines
leave it alone. It drops the budget slide, since that needs a server.

Everyone browses independently — opening a slide moves nobody else's screen. What *is*
shared is the content: budget lines and proposals, and the questions captured on slide 4.
That content refreshes when a tab comes back to the front, and after anything you do to it.
