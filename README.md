# Gym Form

A minimal between-set lifting form-check app. Upload a short video of a set, run browser-side pose
detection, and get one-sentence coaching cues plus a rep-by-rep issue breakdown.

## Features

- Upload and preview a short set video.
- Analyze squats with MoveNet pose detection in the browser.
- Track shoulders, hips, knees, and ankles frame by frame.
- Segment reps and flag depth, knee tracking, torso lean, asymmetry, visibility, and tempo issues.
- Save session summaries locally so form scores can be compared over time.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Videos stay on-device; only compact analysis summaries are stored in localStorage.
