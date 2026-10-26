# Stadtlichter

**Deutschland bei Nacht: Nenne alle 2.057 Städte. Jede, die du findest, leuchtet auf der Karte auf.**

![Stadtlichter auf dem iPad](docs/screenshot.jpg)

**Spielen:** https://tungtungtunglarpsahur.github.io/deutschland/

## So geht's

- Rechts eine Stadt eintippen und Enter drücken. Oben steht, wie viele der 2.057 Städte du schon hast.
- Jede Stadt zählt genau einmal. Gibt es mehrere Städte mit demselben Namen (zwölfmal Neustadt, zweimal Frankfurt, Halle, Oldenburg …), bekommst du sie nacheinander. Du kannst den Zusatz auch gleich mitschreiben: „Frankfurt (Oder)“, „Halle Westfalen“, „Neustadt an der Aisch“.
- Die Schreibweise ist egal: groß oder klein, ä oder ae, „St.“ oder „Sankt“, mit oder ohne Klammern und Bindestriche.
- Gemeinden ohne Stadtrecht werden erkannt („Unterhaching ist eine Gemeinde, aber keine Stadt.“). Bei Tippfehlern kommt ein Vorschlag.
- Gefundene Städte leuchten weiß, ihr Stadtgebiet wird hell. Beim Fund steht kurz ihr Ortsschild auf der Karte.
- Unter der Eingabe stehen alle gefundenen Städte, sortierbar nach Neueste, A–Z oder Größe. Antippen fliegt zur Stadt.
- „Bundesländer“ zeigt den Fortschritt je Land. „Fehlende zeigen“ deckt die übrigen Städte rot auf.
- Der Spielstand bleibt im Browser gespeichert.

## Auf dem iPad

- Läuft in Safari quer (Eingabe rechts) und hochkant (Eingabe unten), mit Pinch-Zoom, Ziehen und Doppeltippen.
- Teilen → „Zum Home-Bildschirm“ macht daraus eine Vollbild-App, die auch offline läuft.

## Die Karte

Staatsgrenze, Bundesländer, alle 400 Kreise und alle rund 10.800 Gemeinden (beim Hineinzoomen), dazu Flüsse, Seen und die Nachbarländer. Gezeichnet mit Canvas in einer Lambert-Projektion, ohne Kartendienst und ohne Bibliotheken.

## Lokal starten

Kein Build nötig, nur ein kleiner Webserver (die Daten werden per `fetch` geladen):

```sh
python3 -m http.server 8000
```

Dann http://localhost:8000 öffnen.

## Veröffentlichen mit GitHub Pages

Settings → Pages → „Deploy from a branch“ → Branch `main`, Ordner `/ (root)`.

## Daten und Quellen

| Inhalt | Quelle | Lizenz |
| --- | --- | --- |
| Gemeindegrenzen und Einwohner (Stand 31.12.2023) | VG250-EW, © GeoBasis-DE / BKG (2025), bezogen über [dimfalk/vg250](https://github.com/dimfalk/vg250), vereinfacht und projiziert | [Datenlizenz Deutschland – Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0) |
| Städteliste | [pensnarik/german-cities](https://github.com/pensnarik/german-cities) (Wikipedia, 2021), ergänzt um Tamm (2022), Oberderdingen (2023), die Fusion Berga-Wünschendorf (2024) und Haar (2025); abgeglichen mit der [Liste der Städte in Deutschland](https://de.wikipedia.org/wiki/Liste_der_St%C3%A4dte_in_Deutschland) (2.057 Städte, Stand Januar 2025) | CC0 |
| Kreisfreie Städte | [landkreise-deutschland](https://github.com/mojoaxel/landkreise-deutschland), nach Destatis GV-ISys | CC BY 4.0 |
| Nachbarländer, Flüsse, Seen | [Natural Earth](https://www.naturalearthdata.com) | gemeinfrei |
| Schrift | D-DIN-PRO, auf Basis von D-DIN (Datto) | SIL Open Font License 1.1, siehe `fonts/OFL.txt` |

`tools/data/build.sh` baut die Dateien in `data/` aus diesen Quellen neu. `tools/make_icons.py` erzeugt die App-Icons.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `index.html`, `css/app.css` | Oberfläche |
| `js/app.js` | Spielstand, Eingabe, Liste, Ortsschild, Infokarte |
| `js/map.js` | Kartendarstellung mit Zoom, Pinch, Schwung und Lichtern |
| `js/match.js` | Schreibweisen vergleichen, Namensvetter, Tippfehler |
| `js/geo.js` | Kartendaten dekodieren |
| `sw.js`, `manifest.webmanifest` | Offline-Betrieb und Installation als App |
| `data/` | Karte (1,8 MB), 2.057 Städte, Gemeinden ohne Stadtrecht |

## Lizenz

Code: MIT, siehe `LICENSE`. Für Daten und Schrift gelten die Lizenzen in der Tabelle oben.
