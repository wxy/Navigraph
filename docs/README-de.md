Navigraph: Visualisierung des Browserverlaufs
===

> Visualisieren Sie intuitiv Ihre Browserpfade und den Verlauf der Webnavigation, um den Informationsfluss zu verstehen und sich an Ihre Browserrouten zu erinnern.

## Hauptfunktionen

- 📊 **Visualisierung des Browserverlaufs** - Anzeigen von Web-Browserpfaden mithilfe von Baum- und Wasserfalldiagrammen
- 🗂️ **Sitzungsverwaltung** - Automatische Organisation von Browseraktivitäten in sinnvolle Sitzungen
- 🔄 **Echtzeit-Updates** - Dynamisches Aktualisieren von Navigationsdiagrammen während des Browsens
- 🛡️ **Datenschutz** - Der Browserverlauf bleibt im lokalen Browserprofil; Einstellungen können über das Browserkonto synchronisiert werden
- 🌙 **Dunkelmodus** - Unterstützt dunkle Themen, um Ihre Augen zu schonen

### Schnellstart

1. Öffnen Sie die Erweiterungsseite (klicken Sie auf das Navigraph-Symbol in der Symbolleiste).
2. Öffnen Sie den Kalender über das Datum in der oberen Leiste. Wählen Sie im Baum einen Tag und im Wasserfall eine Sitzung. Mit den danebenliegenden Tasten wechseln Sie die Ansicht.
3. Öffnen Sie Filter oben rechts. Die Leiste zeigt die Anzahl der Einträge und bietet Zugriff auf ausgeblendete Einträge oder die Wiederherstellung der Filter.
4. Klicken Sie auf Knoten, um detaillierte Informationen anzuzeigen.

## Benutzerhandbuch (Übersicht)

### Installation

#### Aus dem Chrome Web Store

1. Besuchen Sie die [Navigraph-Seite im Chrome Web Store](https://chrome.google.com/webstore/detail/navigraph/jfjgdldpgmnhclffkkcnbhleijeopkhi)
2. Klicken Sie auf "Zu Chrome hinzufügen"

#### Aus dem Microsoft Edge Add-ons Store

1. Besuchen Sie die [Navigraph-Seite im Microsoft Edge Add-ons Store](https://microsoftedge.microsoft.com/addons/detail/ibcpeknflplfaljendadfkhmflhfnhdh)
2. Klicken Sie auf "Abrufen", um die Erweiterung zu installieren

### Symbolleiste

- Öffnen Sie den Kalender über das Datum in der oberen Leiste. Wählen Sie im Baum einen Tag und im Wasserfall eine Sitzung. Mit den danebenliegenden Tasten wechseln Sie die Ansicht.
- Öffnen Sie Filter oben rechts. Die Leiste zeigt die Anzahl der Einträge und bietet Zugriff auf ausgeblendete Einträge oder die Wiederherstellung der Filter.
- Im Baum finden Sie links oben die Funktionen zum Ein- und Ausklappen und rechts unten die Zoomanzeige und die Fensteranpassung. Im Wasserfall stehen Zeitraum und Ansichtsgröße oberhalb der Zeitleiste.

### Ansichtsinteraktionen

Navigraph bietet zwei komplementäre Ansichten: Baumdiagramm und Wasserfalldiagramm.

#### Baumdiagramm

Zweck: Zeigt Seiten-Navigationspfade mithilfe hierarchischer Beziehungen an, um Einstiegspunkte und Verzweigungen leicht analysieren zu können.

- Knoteninteraktion: Bewegen Sie den Mauszeiger, um kurze Informationen anzuzeigen. Klicken Sie, um das Detailfenster zu öffnen (einschließlich Titel, URL, Zugriffszeit, Anzahl der SPA-Anfragen usw.)
- Zoom/Drag: Im Baumdiagramm können Sie die Leinwand mit der Maus ziehen, um sie zu verschieben, und das Mausrad verwenden, um die Ansicht zu skalieren (das spezifische Verhalten kann je nach Browser und Einstellungen variieren)
- SPA-Badge: Baumknoten verfügen über subtile Ring-Badges und Zahlen (falls SPA-Anfragen vorhanden sind), um die Anzahl der in den Knoten zusammengeführten SPA-Anfragen anzuzeigen.

#### Wasserfalldiagramm

Zweck: Zeigt Ereignisse/Anfragen entlang einer Zeitleiste an, um Überlappungen und Dauer leicht zu erkennen.

- Knoteninteraktion: Im Wasserfalldiagramm werden Knoten innerhalb desselben Tabs und Zeitbereichs in zusammenklappbare Gruppen gruppiert. Benutzer können diese Gruppen erweitern, um Elemente darin anzuzeigen. Zusammenklappbare Gruppen werden typischerweise im Schubladenstil angezeigt und unterstützen internes Scrollen
- Zusammenklappbare Gruppen: Gruppiert nach Tab (Knoten im selben Tab und Zeitbereich werden in derselben Gruppe zusammengeführt). Nach dem Erweitern können im Schubladenstil mehr Elemente gescrollt werden
- Rad und Ziehen: In der aktuellen Implementierung wird das Mausrad hauptsächlich verwendet, um vertikal zwischen den Bahnen zu scrollen. Ziehen wird verwendet, um das Zeitfenster zu verschieben oder die Position des Beobachtungsfensters anzupassen
- SPA-Badge: Die Markierung in der oberen rechten Ecke der Knoten zeigt die Anzahl der in den Knoten zusammengeführten SPA-Anfragen an.

### Optionsseite (Einstellungen)

Die Optionsseite enthält mehrere Einstellungen zur Anpassung des Verhaltens der Erweiterung:

- Leerlaufschwelle für die Sitzungsaufteilung (wird verwendet, um Sitzungen automatisch zu teilen)
- Sitzungsmodus-Auswahl (z. B. täglich / manuell / aktivitätsbasiert)
- Sprachauswahl (wird verwendet, um die Lokalisierungssprache der Benutzeroberfläche zu erzwingen)

Erläuterung: Knotenfilterung, Sichtbarkeitssteuerung und detailliertere Filteroperationen werden durch die Filtersteuerungen in der Seitenleiste oder Steuerungen innerhalb der Ansicht bereitgestellt. Die Optionsseite konzentriert sich auf globales Verhalten und Lokalisierungseinstellungen.

### Fehlerbehebung (FAQ)

- Ansicht wird nicht aktualisiert: Aktualisieren Sie die Erweiterungsseite oder versuchen Sie, die Sitzung neu zu laden.
- Probleme bei der Sitzungsaufteilung: Passen Sie die Leerlaufschwelle auf der Optionsseite an, um eine Aufteilung zu erzielen, die besser den Erwartungen entspricht.

## Datenverwaltung und Datenschutz

- Lokaler Speicher: Alle Browserverlaufsdaten werden lokal (IndexedDB / LocalStorage) gespeichert und niemals in die Cloud hochgeladen.

## Neueste Updates

Wesentliche Änderungen seit v1.1.0:

- Entfernen der "Zeitleisten"-Ansicht und Hinzufügen einer neuen "Wasserfall"-Ansicht. Zeigt Ereignisse und Bahnzuweisungen entlang einer Zeitleiste an
- Hinzufügen der SPA-Seitenanforderungsverarbeitung zum Baumdiagramm: Zeigt die Anzahl der SPA-Anfragen in Knotendetails an und verfügt über kleine Ring-Badges auf Knoten, um das Vorhandensein von SPA-Anfragen anzuzeigen

## Entwickler- und technische Informationen

### Lokale Entwicklung und Build

1. Klonen Sie das Repository: `git clone https://github.com/wxy/Navigraph.git`
2. Installieren Sie Abhängigkeiten: `npm install`
3. Build: `npm run build`
4. Laden Sie die nicht gepackte Erweiterung in Chrome (`chrome://extensions/`) und wählen Sie das Verzeichnis `dist`

### Probleme und Kontakt

Reichen Sie Fehler oder Funktionsanforderungen in GitHub Issues ein: https://github.com/wxy/Navigraph/issues

### Beitragsrichtlinien

Wenn Sie beitragen möchten:

1. Forken Sie das Repository und erstellen Sie einen Feature-Branch (`git checkout -b feature/your-feature`)
2. Commiten Sie klare Änderungen und öffnen Sie eine Pull-Request (PR)

Wenn Sie Fehler oder Ungenauigkeiten in den von dieser Erweiterung verwendeten Sprachen finden, reichen Sie eine Pull-Request ein, die Übersetzungsverbesserungen enthält!

### Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert — siehe [LICENSE](LICENSE) für Details.

### Technologiestack

- Frontend: TypeScript, D3.js, CSS3
- Speicher: IndexedDB / LocalStorage
- Browser-API: Chrome Extensions API
- Build-Tool: Webpack