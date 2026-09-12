# TrackFirst race visualizer

A standalone HTML/CSS/SVG/JavaScript replay inspired by the supplied Haas Melbourne Backtest video. Open `dist/index.html`, or serve `dist` using a local HTTP server.

Includes playback, seeking, four playback rates, two driver selections, dynamic gaps, simulated VSC events, and fullscreen mode. Space toggles playback and left/right arrows seek five seconds when a form control is not focused.

All telemetry is illustrative and generated locally, not extracted from the video or an official timing source. The circuit is a reference-inspired schematic. The 76-second timeline compresses laps 30–40; marker motion, speed and gaps are illustrative rather than a physically consistent reconstruction. To use actual racing data, replace the demo model in `dist/app.js` with timestamped positions, timing, and event records.

No build step or runtime dependencies. Google Fonts is optional; system fallbacks are defined. WebMCP support is feature-detected and optional.
