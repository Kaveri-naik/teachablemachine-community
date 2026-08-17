# Module Image Detector

Browser app that learns **two** photos, then classifies any later image as:

- `Module 1 image detected`
- `Module 2 image detected`
- `not a valid detection`

Training and inference run locally with TensorFlow.js. Images never leave the device.

## Run

```bash
cd webapp
python3 -m http.server 8080
```

Open http://localhost:8080 and:

1. Choose a Module 1 image. The app extracts MobileNet embeddings and trains on augmented copies.
2. Choose a Module 2 image the same way.
3. Upload (or capture) a new photo. The result banner shows one of the three labels above.

## Tests

```bash
cd webapp
npm test
```

## How it works

MobileNet v2 turns each image into a fingerprint. A small dense classifier is trained on those fingerprints. A new photo is accepted only if it is similar enough to one learned module and clearly unlike the other.
