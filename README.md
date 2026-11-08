<p align="center">
  <img src="art/hero-day.webp" alt="A painted reading desk with an open annotated book, tea and flowers" width="100%">
</p>

<h1 align="center">Marginalia</h1>

<p align="center"><em>Every paragraph, explained in the margins.</em></p>

<p align="center">
  Drop in a research paper, journal article or any article, and get a friendly note beside every paragraph.<br>
  Then get real books, courses, videos and papers to learn the topic properly.
</p>

<p align="center">
  <a href="#-paper-explainer">Paper Explainer</a> &nbsp;·&nbsp;
  <a href="#-research-compass">Research Compass</a> &nbsp;·&nbsp;
  <a href="#-get-started">Get started</a> &nbsp;·&nbsp;
  <a href="#-contact">Contact</a>
</p>

---

## 📖 Paper Explainer

<img src="art/card-explain.webp" alt="" width="140" align="right">

Bring a **PDF, Word file (.docx), Markdown, plain text, a link, a DOI or an arXiv link**, or paste the text.

- **A note beside every paragraph**: a one-line gist in handwriting, a plain-language explanation and the key terms.
- **Three levels**: *Simple* (for a curious 14-year-old), *Student*, or *Expert*.
- **Simpler · Go deeper · Ask a question** on any paragraph.
- **The big picture** first: what problem the paper tackles, what they did, what they found and why it matters.
- **A glossary** of every term, plus the paper's own reference list.
- **Resources at the end**: Wikipedia starting points, books (checked against Open Library), courses, videos, websites, related papers, the papers it builds on, classic papers, review articles, the newest research and fresh preprints.
- Download your notes as Markdown, or print them.

<p align="center"><img src="docs/reader.png" alt="Marginalia explaining a paper paragraph by paragraph" width="90%"></p>

## 🧭 Research Compass

<img src="art/card-compass.webp" alt="" width="140" align="right">

Writing your own paper? Type your title and Marginalia maps the territory:

- **Foundational papers** (most cited), **review articles**, **the latest research** and **preprints**, from OpenAlex's 250M+ scholarly works.
- **Ongoing studies** from ClinicalTrials.gov (for health topics).
- **Books**, **encyclopedia pages**, **videos and lectures**, **courses** and **websites**.
- **Research questions** you could ask, **fresh angles and gaps**, **methods that fit**, and **a possible outline**.
- Save anything to a **reading list**, copy citations (APA), and download the list.

<p align="center"><img src="docs/compass.png" alt="Research Compass results for a topic" width="90%"></p>

## 🌙 Two moods

A warm **Parchment** theme for the day and a **Midnight Library** theme for late-night reading. It follows your device, or you can switch with the moon button. Works on phones, tablets and laptops.

<p align="center">
  <img src="docs/phone-day.png" alt="Phone, Parchment theme" width="30%">&nbsp;&nbsp;
  <img src="docs/phone-night.png" alt="Phone, Midnight Library theme" width="30%">
</p>

## ✨ Get started

### 1. Put it online (free, about 2 minutes)

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Go to **[app.netlify.com/drop](https://app.netlify.com/drop)** and log in.
3. Drag the unzipped folder onto the page. You get a link like `something.netlify.app`.

GitHub Pages and Vercel also work: it's a plain folder of HTML, CSS and JavaScript with no build step.
Double-clicking `index.html` won't work, because browsers block this kind of site when it's opened as a file.

### 2. Turn on the AI (free Gemini key)

1. Open **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** and sign in with Google.
2. Click **Create API key** and copy it.
3. On the site, open **Settings**, paste the key and press **Save & test**.

Without a key you can still use the Research Compass searches and the built-in sample explanation.
If one Gemini model is busy, Marginalia automatically switches to another free one.

## 🔒 Privacy

There is no server and no account. Your papers, notes and topics are saved **only in your own browser**, and your Gemini key never leaves your browser except to talk to Google.
Settings → *Delete all my data* wipes everything.

## 📚 Where the resources come from

All papers, studies and books are **real records from open databases**, never invented by the AI:

| Source | Used for |
| --- | --- |
| [OpenAlex](https://openalex.org) | papers, citations, related work, reviews, preprints |
| [ClinicalTrials.gov](https://clinicaltrials.gov) | ongoing studies |
| [Open Library](https://openlibrary.org) / Google Books | books |
| [Wikipedia](https://wikipedia.org) | background concepts, Wikipedia articles |
| [Europe PMC](https://europepmc.org) | free full text for DOIs |
| [Google Gemini](https://ai.google.dev) | explanations, plus Google Search for websites |

Reading PDFs uses [PDF.js](https://mozilla.github.io/pdf.js/) and Word files use [Mammoth](https://github.com/mwilliamson/mammoth.js) (both included in `vendor/`).

> AI explanations can be wrong. Always double-check important details against the original paper.

## 🗂 What's inside

```
index.html        the page shell
css/style.css     all the styling (Parchment + Midnight Library)
js/app.js         pages and buttons
js/explain.js     paragraph explanations
js/compass.js     Research Compass
js/ingest.js      reading PDFs, Word files, links and text
js/sources.js     OpenAlex, ClinicalTrials.gov, Open Library, Wikipedia
js/config.js      contact links
art/              the painted illustrations
vendor/           PDF.js and Mammoth
```

## 💌 Contact

Made with love by **Lyra**.

<p>
  <a href="https://x.com/Lyra_void">X (Twitter)</a> &nbsp;·&nbsp;
  <a href="https://github.com/Lyra-4leafclover">GitHub</a> &nbsp;·&nbsp;
  <a href="https://lyradossier.vercel.app/">Portfolio</a>
</p>
