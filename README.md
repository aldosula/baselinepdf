# PDF Studio

Created this local PDF editor because I was tired of paywalls, registrations, and
"you have processed 1 of 1 free documents this month". It runs in your browser, your
file never leaves your machine, and nothing asks for your email.

## What it does

- **Edits the text that is already in the file**, in place: same baseline, same size,
  and the document's own font, by reusing the font the file already carries. In a
  table you get the cell under the pointer, not the whole row.
- **Pictures that came with the document** can be picked up, moved, resized and
  deleted, not only ones you add.
- **Signatures**: draw one, type one, or drop a photo and the paper behind it is
  removed properly, keeping the pen's soft edge instead of leaving a grey halo.
- Images, highlight, underline, strike, pen and marker, shapes, and a whiteout that
  samples the colour of the paper it covers.
- Pages: rotate, delete, reorder. Undo and redo over everything.
- The last three documents stay in this browser with their edits, so you can close
  the tab and come back.

## Run it

```bash
npm install
npm run dev
```

`npm run build` produces a static `dist/`. There is no server side, so you can host it
anywhere and the work still happens on the machine in front of you.

## Two things worth knowing

**Replaced text keeps the document's font, when the document lets it.** An edited
line is covered with the sampled paper colour and rewritten by referencing the font
resource the file already contains, so the face, the size and the baseline are the
original ones. Fonts are usually embedded as subsets holding only the characters the
document already used; if you type a character that subset does not carry, that line
falls back to the nearest of Helvetica, Times or Courier, and the save tells you which
line and why.

**Covered is not deleted.** The original characters stay in the file underneath the
patch, so copy and paste, or `pdftotext`, can still read them. Good enough for fixing
a draft. Not a redaction tool.

## Built with

pdf.js reads and renders, pdf-lib writes, React and Tailwind for the rest. No backend,
no telemetry, no dependencies at runtime beyond the page itself.

MIT. Take it, fork it, ship it. If you build the paid version with the account wall,
at least make the free tier three documents.
