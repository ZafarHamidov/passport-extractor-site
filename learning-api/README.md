# Passport Extractor Shared Learning API

This optional API lets the static frontend learn from users across browsers without uploading passport images.

What can be submitted:
- Corrected text fields.
- Corrected raw MRZ text.
- Small context values such as document code, issuing country, nationality, and current raw MRZ.

What is not accepted by design:
- Passport photos or PDF files.
- Base64 images.
- Browser storage dumps.

## Run locally

```bash
cd learning-api
npm start
```

The server starts on `http://127.0.0.1:8787`.

Useful environment variables:

```bash
PORT=8787
ALLOWED_ORIGINS=https://zafarhamidov.github.io,http://127.0.0.1:4173
MIN_RULE_SUPPORT=2
```

## Connect the frontend

Build the site with:

```bash
VITE_SHARED_LEARNING_API_URL=https://your-learning-api.example.com npm run build
```

When that variable is not set, the frontend keeps `Teach AI` local-only.

## API

`POST /corrections`

Stores opt-in correction examples. The frontend sends:

```json
{
  "corrections": [
    {
      "version": 1,
      "profileId": "TJK",
      "profileName": "Tajik passport",
      "field": "nationality",
      "from": "T1K",
      "to": "TJK",
      "rawMrz": "P<TJK...",
      "documentCode": "P",
      "issuingState": "TJK",
      "nationality": "TJK",
      "createdAt": "2026-07-04T12:00:00.000Z",
      "appVersion": "0.1.0"
    }
  ]
}
```

`GET /rules`

Returns shared correction rules for the frontend. To avoid leaking personal data, automatic exact rules are generated only for safe fields: `documentCode`, `issuingState`, `nationality`, and `sex`. Personal fields such as passport number, surname, given names, birth date, and raw MRZ are stored for review but are not served back as exact global replacements.

Manual curated rules can be placed in `learning-api/data/rules.json`:

```json
{
  "corrections": [
    {
      "id": "curated-tjk-nationality",
      "profileId": "TJK",
      "field": "nationality",
      "from": "T1K",
      "to": "TJK",
      "createdAt": 1783147200000,
      "support": 10,
      "source": "shared"
    }
  ]
}
```
