name: Update gold prices

on:
  workflow_dispatch:
  schedule:
    - cron: "7 * * * *"

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run updater
        run: node update-prices.mjs

      - name: Commit & push if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/price.json data/history.jsonl
          if git diff --cached --quiet; then
            echo "No changes."
          else
            git commit -m "Update gold prices"
            git push
          fi
