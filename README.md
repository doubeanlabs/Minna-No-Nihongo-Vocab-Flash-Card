# Japanese Vocabulary Cards

A static Japanese vocabulary flashcard app that can be hosted on GitHub Pages.

## What is included

- Built-in vocabulary loaded from `minna_no_nihongo_vocab.csv`
- Chapter navigation in CSV order
- Wide landscape flashcards
- Card flip from Japanese to English
- Mastered checkboxes
- All / Mastered / Unmastered filters
- Size slider for card and font size
- Full save export/import
- Reset progress
- Chapter quizzes with 4-choice questions
- Offline support after first load

## Updating vocabulary for everyone

Because this is a GitHub Pages app, the public vocabulary is updated by changing the CSV file in GitHub.

1. Open the repository on GitHub.
2. Open `minna_no_nihongo_vocab.csv`.
3. Choose edit or upload a replacement file.
4. Save/commit the change.
5. Wait a short moment for GitHub Pages to publish.
6. Open the app URL again to see the latest vocabulary.

The app does not include an in-app CSV upload. Vocabulary updates are made by replacing the CSV source file in GitHub.

## CSV format

The CSV must use this header:

```csv
chapter,hiragana,kanji,english
```

Required columns:

- `chapter`
- `hiragana`
- `english`

Optional column:

- `kanji`

Duplicate detection uses `chapter + hiragana`.

## Hosting on GitHub Pages

1. Create a GitHub account.
2. Create a new repository.
3. Upload these files to the repository:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `sw.js`
   - `manifest.json`
   - `icon.svg`
   - `minna_no_nihongo_vocab.csv`
4. Open the repository settings.
5. Go to Pages.
6. Set source to deploy from the main branch.
7. Save.
8. Open the published GitHub Pages URL.
