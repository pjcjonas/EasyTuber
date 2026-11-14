# Third-party code

| File | What | Version | Licence |
|---|---|---|---|
| `ag-psd.js` | [ag-psd](https://github.com/Agamnentzar/ag-psd), reads Photoshop files. `dist/bundle.js` from the npm package, unchanged. | 34.2.0 | MIT (`ag-psd.LICENSE.txt`) |

The bundle contains [pako](https://github.com/nodeca/pako) 2.1.0 (MIT and Zlib) and [base64-js](https://github.com/beatgammit/base64-js) 1.5.1 (MIT).

It is loaded only when a `.psd` is dropped (see `js/psd.js`).
