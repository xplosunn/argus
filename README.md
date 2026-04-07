# Argus

Local-first, declaration-centric code review for `default-branch...HEAD`, or `HEAD...WORKTREE` when you are on the default branch.

## MVP features

- CLI command: `argus review`
- Local web server + web client
- Touched declaration list (top-level first, local declarations shown when expanding a top-level item)
- Unsupported diff files appear as top-level file entries in the left pane
- Usage lookup for each touched declaration
- Full-file viewer with inline added/removed diff lines and declaration jumps
- Shiki-powered syntax highlighting in the file viewer
- On the default branch (for example `main`), reviews use uncommitted working tree changes

## Run

```bash
npx @xplosunn/argus review
```

It starts the local server and opens the review URL in your default browser automatically.

Optional flags:

```bash
argus review --repo /path/to/target/repo --port 4173 --default-branch origin/main
```
